#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

try:
    from .generated_clinical_vocabulary import CLINICAL_VOCABULARY
except ImportError:
    from generated_clinical_vocabulary import CLINICAL_VOCABULARY  # type: ignore


SCHEMA_VERSION = CLINICAL_VOCABULARY["schemaVersion"]
CANONICAL_ALIASES = CLINICAL_VOCABULARY["globalAliases"]
AXIS_VALUE_ALIASES = CLINICAL_VOCABULARY["axisValueAliases"]


def canonical_token(value: Any) -> str:
    expanded = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(value or "").strip())
    token = re.sub(r"[^a-z0-9+]+", "_", expanded.lower()).strip("_")
    return CANONICAL_ALIASES.get(token, token)


def canonical_axis_value(axis: Any, value: Any) -> str:
    axis_expanded = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(axis or "").strip())
    axis_token = re.sub(r"[^a-z0-9]+", "_", axis_expanded.lower()).strip("_")
    value_token = re.sub(r"[^a-z0-9+]+", "_", str(value or "").strip().lower()).strip("_")
    return AXIS_VALUE_ALIASES.get(axis_token, {}).get(value_token, CANONICAL_ALIASES.get(value_token, value_token))


def stable_hash(value: Any) -> str:
    serialized = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(serialized.encode('utf-8')).hexdigest()}"


def _parse_age_years(value: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(years?|months?|weeks?|days?)?", value or "", re.I)
    if not match:
        return None
    amount = float(match.group(1))
    unit = (match.group(2) or "years").lower()
    if unit.startswith("month"):
        return amount / 12
    if unit.startswith("week"):
        return amount / 52.1429
    if unit.startswith("day"):
        return amount / 365.25
    return amount


def _source_span(field: str, source: str, start: int, end: int) -> dict[str, Any]:
    return {
        "field": field,
        "text": source[start:end],
        "start": start,
        "end": end,
    }


def _criterion(
    *,
    criterion_id: str,
    kind: str,
    criticality: str,
    predicate: dict[str, Any],
    field: str,
    source: str,
    start: int,
    end: int,
    registry_version: str,
    modeled_status: str = "modeled",
    review_status: str = "unreviewed",
    extractor: str = "deterministic-criterion-parser-1.0.0",
    confidence: float | None = None,
) -> dict[str, Any]:
    def canonical_predicate(expression: Any) -> Any:
        if isinstance(expression, list):
            return [canonical_predicate(item) for item in expression]
        if not isinstance(expression, dict):
            return expression
        normalized = {key: canonical_predicate(value) for key, value in expression.items()}
        if "concept" in normalized:
            normalized["concept"] = canonical_token(normalized["concept"])
        return normalized

    return {
        "schemaVersion": SCHEMA_VERSION,
        "criterionId": criterion_id,
        "scope": "cohort",
        "kind": kind,
        "criticality": criticality,
        "predicate": canonical_predicate(predicate),
        "sourceSpan": _source_span(field, source, start, end),
        "provenance": {
            "source": "ClinicalTrials.gov",
            "registryVersion": registry_version,
            "extractor": extractor,
            "extractorType": "deterministic",
            "extractorConfidence": confidence,
        },
        "reviewStatus": review_status,
        "modeledStatus": modeled_status,
    }


def exact_trial_anchor(field_name: str, text: str) -> list[str]:
    """Return exact named-trial anchors only from title/acronym fields."""
    if field_name not in {"brief_title", "official_title", "acronym"}:
        return []
    anchors = {
        "TheraP": re.compile(r"(?<![A-Za-z])TheraP(?![A-Za-z])"),
        "ARANOTE": re.compile(r"(?<![A-Za-z])ARANOTE(?![A-Za-z])"),
        "ARASENS": re.compile(r"(?<![A-Za-z])ARASENS(?![A-Za-z])"),
    }
    return [name for name, pattern in anchors.items() if pattern.search(text or "")]


def _iter_criterion_segments(text: str) -> Iterable[tuple[int, int, str]]:
    """Yield conservative source segments without claiming Boolean interpretation."""
    source = text or ""
    if not source.strip():
        return
    pattern = re.compile(r"(?:^|\n|(?<=\.)\s+|(?<=;)\s+)(?:[-*•]\s*|\d+[.)]\s*)?")
    boundaries = [match.end() for match in pattern.finditer(source)]
    if not boundaries or boundaries[0] != 0:
        boundaries.insert(0, 0)
    boundaries.append(len(source))
    for index in range(len(boundaries) - 1):
        start = boundaries[index]
        end = boundaries[index + 1]
        raw = source[start:end]
        leading = len(raw) - len(raw.lstrip())
        trailing = len(raw.rstrip())
        start += leading
        end = boundaries[index] + trailing
        segment = source[start:end].strip(" ;\n")
        end = start + len(segment)
        if segment:
            yield start, end, segment


def _comparison_operator(value: str) -> str | None:
    token = re.sub(r"\s+", " ", value.strip().lower())
    return {
        ">=": "GE", "≥": "GE", "=>": "GE", "at least": "GE", "no less than": "GE",
        ">": "GT", "greater than": "GT", "above": "GT",
        "<=": "LE", "≤": "LE", "=<": "LE", "at most": "LE", "no more than": "LE",
        "<": "LT", "less than": "LT", "below": "LT",
        "=": "EQ", "equals": "EQ",
    }.get(token)


def _lab_predicates(segment: str) -> tuple[list[dict[str, Any]], bool]:
    name_pattern = r"absolute\s+neutrophil\s+count|anc|platelet(?:s|\s+count)?|hemoglobin|hgb|total\s+bilirubin|bilirubin|aspartate\s+aminotransferase|ast|alanine\s+aminotransferase|alt|creatinine\s+clearance|crcl|egfr|estimated\s+glomerular\s+filtration\s+rate|serum\s+creatinine"
    lab_mentions = list(re.finditer(rf"\b(?:{name_pattern})\b", segment, re.I))
    if not lab_mentions:
        return [], False
    threshold_pattern = re.compile(
        rf"\b(?P<name>{name_pattern})\b\s*(?P<operator>>=|=>|≥|<=|=<|≤|>|<|=|at\s+least|at\s+most|no\s+less\s+than|no\s+more\s+than|greater\s+than|less\s+than|above|below|equals)\s*(?P<amount>\d+(?:,\d{{3}})*(?:\.\d+)?)\s*(?P<unit>g\s*/\s*dL|mg\s*/\s*dL|U\s*/\s*L|mL\s*/\s*min(?:\s*/\s*1\.73\s*m2)?|cells?\s*/\s*(?:uL|µL|mm3|mm\^3)|/\s*(?:uL|µL|mm3|mm\^3)|[Kk]\s*/\s*(?:uL|µL)|(?:x|×)\s*10\s*(?:\^?9|⁹)\s*/\s*L|(?:x|×)\s*(?:the\s+)?ULN)\b",
        re.I,
    )
    matches = list(threshold_pattern.finditer(segment))
    # Partial modeling is unsafe: if any mentioned lab lacks a complete
    # operator/value/unit tuple, abstain on the whole compound clause.
    if len(matches) != len(lab_mentions):
        return [], True

    predicates: list[dict[str, Any]] = []
    for match in matches:
        name = re.sub(r"\s+", " ", match.group("name").strip().lower())
        unit_text = match.group("unit")
        unit_token = re.sub(r"\s+", "", unit_text.lower())
        amount = float(match.group("amount").replace(",", ""))
        operator = _comparison_operator(match.group("operator"))
        if operator is None:
            return [], True

        if name in {"anc", "absolute neutrophil count"}:
            concept, label = "absoluteNeutrophilCount", "Absolute neutrophil count"
        elif name.startswith("platelet"):
            concept, label = "plateletCount", "Platelet count"
        elif name in {"hemoglobin", "hgb"}:
            concept, label = "hemoglobinGdl", "Hemoglobin"
        elif name in {"total bilirubin", "bilirubin"}:
            concept, label = ("totalBilirubinUlnRatio", "Total bilirubin (ULN ratio)") if "uln" in unit_token else ("totalBilirubinMgDl", "Total bilirubin")
        elif name in {"ast", "aspartate aminotransferase"}:
            concept, label = ("astUlnRatio", "AST (ULN ratio)") if "uln" in unit_token else ("astUnitsL", "AST")
        elif name in {"alt", "alanine aminotransferase"}:
            concept, label = ("altUlnRatio", "ALT (ULN ratio)") if "uln" in unit_token else ("altUnitsL", "ALT")
        elif name in {"creatinine clearance", "crcl"}:
            concept, label = "creatinineClearanceMlMin", "Creatinine clearance"
        elif name in {"egfr", "estimated glomerular filtration rate"}:
            concept, label = "egfrMlMin", "eGFR"
        else:
            concept, label = "serumCreatinineMgDl", "Serum creatinine"

        if concept in {"absoluteNeutrophilCount", "plateletCount"}:
            if re.search(r"10(?:\^?9|⁹)|(?:x|×)10|^k/", unit_token, re.I):
                amount *= 1000
            canonical_unit = "cells/uL"
        elif "uln" in unit_token:
            canonical_unit = "xULN"
        elif "g/dl" in unit_token and "mg/dl" not in unit_token:
            canonical_unit = "g/dL"
        elif "mg/dl" in unit_token:
            canonical_unit = "mg/dL"
        elif "u/l" in unit_token:
            canonical_unit = "U/L"
        else:
            canonical_unit = "mL/min"

        predicates.append({
            "op": "FACT",
            "concept": concept,
            "predicate": "has",
            "operator": operator,
            "value": int(amount) if amount.is_integer() else amount,
            "unit": canonical_unit,
            "label": label,
            "question": f"What is the current {label.lower()} with units and collection date?",
            "sourceOffset": {"start": match.start(), "end": match.end(), "text": match.group(0)},
        })
    return predicates, False


def _washout_predicates(segment: str) -> tuple[list[dict[str, Any]], bool]:
    modality_specs = (
        (
            "sinceLastSystemicTherapyDays",
            "Systemic-therapy washout",
            r"systemic\s+(?:anti[- ]?cancer|anticancer)?\s*(?:therapy|treatment)|anti[- ]?cancer\s+(?:therapy|treatment)|chemotherapy|investigational\s+(?:agent|drug|therapy)|study\s+drug",
            "What is the exact date of the last systemic anticancer therapy?",
        ),
        (
            "sinceLastRadiationDays",
            "Radiation washout",
            r"radiation\s+therapy|radiotherapy",
            "What is the exact date of the last radiation treatment?",
        ),
        (
            "sinceLastSurgeryDays",
            "Surgery washout",
            r"major\s+surgery|surgical\s+procedure",
            "What is the exact date of the last major surgery?",
        ),
    )
    combined = "|".join(f"(?:{pattern})" for _, _, pattern, _ in modality_specs)
    target_mentions = list(re.finditer(rf"\b(?:{combined})\b", segment, re.I))
    if not target_mentions:
        return [], False

    # Half-life exceptions, alternate windows, and long Boolean lists require a
    # curator-authored AST; selecting one number would silently change meaning.
    if re.search(r"\b(?:half[- ]?lives?|whichever|and/or|either|except|unless)\b", segment, re.I):
        return [], True

    window_pattern = re.compile(
        rf"(?P<modality>{combined})[^.;]{{0,45}}?\b(?:within|washout(?:\s+of)?|at\s+least)\s*(?P<amount>\d+(?:\.\d+)?)\s*(?P<unit>days?|weeks?)\b"
        rf"|\b(?:within|washout(?:\s+of)?|at\s+least)\s*(?P<amount2>\d+(?:\.\d+)?)\s*(?P<unit2>days?|weeks?)\b[^.;]{{0,45}}?(?P<modality2>{combined})",
        re.I,
    )
    matches = list(window_pattern.finditer(segment))
    if not matches:
        return [], True

    predicates: list[dict[str, Any]] = []
    covered_modalities: set[str] = set()
    for match in matches:
        modality_text = match.group("modality") or match.group("modality2") or ""
        amount = float(match.group("amount") or match.group("amount2"))
        unit = (match.group("unit") or match.group("unit2") or "days").lower()
        days = int(amount * 7 if unit.startswith("week") else amount)
        selected = next((spec for spec in modality_specs if re.fullmatch(spec[2], modality_text, re.I)), None)
        if selected is None:
            return [], True
        concept, label, _, question = selected
        covered_modalities.add(concept)
        predicates.append({
            "op": "FACT",
            "concept": concept,
            "predicate": "has",
            "operator": "GE",
            "value": days,
            "label": label,
            "question": question,
            "sourceOffset": {"start": match.start(), "end": match.end(), "text": match.group(0)},
        })

    mentioned_modalities = {
        spec[0]
        for mention in target_mentions
        for spec in modality_specs
        if re.fullmatch(spec[2], mention.group(0), re.I)
    }
    if mentioned_modalities - covered_modalities:
        return [], True
    unique: dict[tuple[str, int], dict[str, Any]] = {}
    for predicate in predicates:
        unique[(predicate["concept"], predicate["value"])] = predicate
    return list(unique.values()), False


def _demographic_predicates(segment: str) -> list[dict[str, Any]]:
    predicates: list[dict[str, Any]] = []
    range_match = re.search(
        r"\b(?:age(?:d)?\s*)?(?:between\s+)?(\d{1,3})\s*(?:-|to|through)\s*(\d{1,3})\s*(?:years?|yrs?)(?:\s+of\s+age)?\b",
        segment,
        re.I,
    )
    if range_match:
        minimum, maximum = int(range_match.group(1)), int(range_match.group(2))
        if 0 <= minimum <= maximum <= 120:
            predicates.extend([
                {"op": "FACT", "concept": "ageYears", "predicate": "has", "operator": "GE", "value": minimum, "label": "Minimum age"},
                {"op": "FACT", "concept": "ageYears", "predicate": "has", "operator": "LE", "value": maximum, "label": "Maximum age"},
            ])
    else:
        minimum_match = re.search(
            r"(?:\bage(?:d)?\s*(?:>=|=>|≥|at\s+least|minimum(?:\s+age)?(?:\s+of)?)[ :]*|\b)(\d{1,3})\s*(?:years?|yrs?)(?:\s+of\s+age)?\s*(?:or\s+older|and\s+older|minimum)?\b",
            segment,
            re.I,
        )
        maximum_match = re.search(
            r"(?:\bage(?:d)?\s*(?:<=|=<|≤|at\s+most|maximum(?:\s+age)?(?:\s+of)?)[ :]*|\b)(\d{1,3})\s*(?:years?|yrs?)(?:\s+of\s+age)?\s*(?:or\s+younger|and\s+younger|maximum)?\b",
            segment,
            re.I,
        )
        if minimum_match and re.search(r"(?:>=|=>|≥|at\s+least|minimum|or\s+older|and\s+older)", minimum_match.group(0), re.I):
            minimum = int(minimum_match.group(1))
            if 0 <= minimum <= 120:
                predicates.append({"op": "FACT", "concept": "ageYears", "predicate": "has", "operator": "GE", "value": minimum, "label": "Minimum age"})
        if maximum_match and re.search(r"(?:<=|=<|≤|at\s+most|maximum|or\s+younger|and\s+younger)", maximum_match.group(0), re.I):
            maximum = int(maximum_match.group(1))
            if 0 <= maximum <= 120:
                predicates.append({"op": "FACT", "concept": "ageYears", "predicate": "has", "operator": "LE", "value": maximum, "label": "Maximum age"})

    sex_match = re.search(
        r"\b(?:sex|gender)\s*[:=-]\s*(male|female)\b|\b(male|female|men|women)\s+(?:participants?|patients?|subjects?)\s+only\b|\b(?:participants?|patients?|subjects?)\s+(?:must\s+be\s+)?(male|female)\s+only\b",
        segment,
        re.I,
    )
    if sex_match:
        token = next((value for value in sex_match.groups() if value), "").lower()
        value = "male" if token in {"male", "men"} else "female"
        predicates.append({"op": "FACT", "concept": "administrativeSex", "predicate": "has", "operator": "EQ", "value": value, "label": "Administrative sex"})
    return predicates


def _recognized_predicate(segment: str, *, allow_demographics: bool = True) -> tuple[dict[str, Any] | None, float | None]:
    predicates: list[dict[str, Any]] = []
    confidences: list[float] = []

    ecog = re.search(
        r"(?:ecog|eastern cooperative oncology group|performance status)[^.;]{0,50}(?:0\s*(?:-|to|or|/)\s*([12])|(?:<=?|≤)\s*([12])|less than\s*([23]))",
        segment,
        re.I,
    )
    if ecog:
        if ecog.group(1):
            maximum = int(ecog.group(1))
        elif ecog.group(2):
            maximum = int(ecog.group(2))
        else:
            maximum = int(ecog.group(3)) - 1
        predicates.append({"op": "FACT", "concept": "ecogStatus", "predicate": "has", "operator": "LE", "value": maximum, "label": "ECOG performance status"})
        confidences.append(0.99)

    washout_predicates, incomplete_washout_clause = _washout_predicates(segment)
    if incomplete_washout_clause:
        return None, None
    predicates.extend(washout_predicates)
    confidences.extend([0.98] * len(washout_predicates))

    demographic_predicates = _demographic_predicates(segment) if allow_demographics else []
    predicates.extend(demographic_predicates)
    confidences.extend([0.99] * len(demographic_predicates))

    lab_predicates, incomplete_lab_clause = _lab_predicates(segment)
    if incomplete_lab_clause:
        return None, None
    predicates.extend(lab_predicates)
    confidences.extend([0.99] * len(lab_predicates))
    if not predicates:
        return None, None
    if len(predicates) == 1:
        return predicates[0], confidences[0]
    return {"op": "AND", "args": predicates, "label": "Compound protocol criterion"}, min(confidences)


def extract_criteria(
    *,
    nct_id: str,
    inclusion_text: str,
    exclusion_text: str,
    min_age: str,
    max_age: str,
    sex: str,
    registry_version: str,
) -> list[dict[str, Any]]:
    criteria: list[dict[str, Any]] = []

    min_years = _parse_age_years(min_age)
    if min_years is not None:
        source = str(min_age)
        criteria.append(_criterion(
            criterion_id=f"{nct_id}:structured:min-age",
            kind="inclusion",
            criticality="hard",
            predicate={"op": "FACT", "concept": "ageYears", "predicate": "has", "operator": "GE", "value": min_years, "label": "Minimum age"},
            field="minimumAge",
            source=source,
            start=0,
            end=len(source),
            registry_version=registry_version,
            review_status="registry_explicit",
            extractor="registry-structured-field",
            confidence=1.0,
        ))

    max_years = _parse_age_years(max_age)
    if max_years is not None:
        source = str(max_age)
        criteria.append(_criterion(
            criterion_id=f"{nct_id}:structured:max-age",
            kind="inclusion",
            criticality="hard",
            predicate={"op": "FACT", "concept": "ageYears", "predicate": "has", "operator": "LE", "value": max_years, "label": "Maximum age"},
            field="maximumAge",
            source=source,
            start=0,
            end=len(source),
            registry_version=registry_version,
            review_status="registry_explicit",
            extractor="registry-structured-field",
            confidence=1.0,
        ))

    sex_token = canonical_token(sex)
    if sex_token and sex_token not in {"all", "unknown", "not_applicable"}:
        source = str(sex)
        criteria.append(_criterion(
            criterion_id=f"{nct_id}:structured:sex",
            kind="inclusion",
            criticality="hard",
            predicate={"op": "FACT", "concept": "administrativeSex", "predicate": "has", "operator": "EQ", "value": sex_token, "label": "Administrative sex"},
            field="sex",
            source=source,
            start=0,
            end=len(source),
            registry_version=registry_version,
            review_status="registry_explicit",
            extractor="registry-structured-field",
            confidence=1.0,
        ))

    for kind, field, source in (
        ("inclusion", "inclusionCriteria", inclusion_text or ""),
        ("exclusion", "exclusionCriteria", exclusion_text or ""),
    ):
        for index, (start, end, segment) in enumerate(_iter_criterion_segments(source), start=1):
            predicate, confidence = _recognized_predicate(segment, allow_demographics=kind == "inclusion")

            def leaf_concepts(expression: dict[str, Any] | None) -> set[str]:
                if not expression:
                    return set()
                if expression.get("op") == "FACT":
                    return {canonical_token(expression.get("concept"))}
                return {
                    concept
                    for child in expression.get("args", [])
                    for concept in leaf_concepts(child)
                }

            # Automatic exclusion parsing is intentionally limited to predicates
            # already normalized as a minimum elapsed-time requirement. Other
            # exclusion clauses need an explicit curator-authored negation AST.
            safe_exclusion_concepts = {
                "since_last_systemic_therapy_days",
                "since_last_radiation_days",
                "since_last_surgery_days",
            }
            if kind == "exclusion" and predicate and not leaf_concepts(predicate).issubset(safe_exclusion_concepts):
                predicate, confidence = None, None

            contains_boolean = bool(re.search(r"\b(?:and/or|either|unless|except|whichever|at least \d+ of|any of|all of)\b", segment, re.I))
            source_too_complex = segment.count("*") > 1 or len(segment) > 500
            modeled = predicate is not None and not contains_boolean and not source_too_complex
            criteria.append(_criterion(
                criterion_id=f"{nct_id}:{kind[0].upper()}{index}",
                kind=kind,
                criticality="hard",
                predicate=predicate if modeled else {"op": "NOT_MODELED", "sourceText": segment},
                field=field,
                source=source,
                start=start,
                end=end,
                registry_version=registry_version,
                modeled_status="modeled" if modeled else "not_modeled",
                review_status="unreviewed",
                confidence=confidence,
            ))
    return criteria


def build_cohorts(
    *,
    nct_id: str,
    title: str,
    status: str,
    disease_setting_ids: list[str],
    criteria: list[dict[str, Any]],
    inclusion_text: str,
    sites: list[dict[str, Any]],
    registry_version: str,
) -> list[dict[str, Any]]:
    labels = []
    for match in re.finditer(r"\b(?:cohort|arm)\s*([a-z0-9][a-z0-9_-]*)\b", inclusion_text or "", re.I):
        label = match.group(0).strip()
        if canonical_token(label) not in {canonical_token(existing) for existing in labels}:
            labels.append(label)

    # Automatic detection never pretends it has mapped criteria to a cohort. Until
    # curator review, a single explicit unsegmented enrollment pathway preserves all
    # text and prevents trial-wide eligibility claims.
    ambiguity = None
    if labels:
        ambiguity = f"Detected possible cohort labels ({', '.join(labels)}), but criterion scope is not curated."
    return [{
        "schemaVersion": SCHEMA_VERSION,
        "cohortId": f"{nct_id}:unsegmented",
        "label": "Unsegmented enrollment pathway",
        "armIds": [],
        "enrollmentStatus": status,
        "statusProvenance": {
            "source": "ClinicalTrials.gov",
            "registryVersion": registry_version,
        },
        "diseaseConcepts": disease_setting_ids,
        "interventions": [],
        "sites": sites,
        "sharedCriteria": criteria,
        "cohortSpecificCriteria": [],
        "cohortExtraction": {
            "method": "deterministic_unsegmented_fallback",
            "confidence": 1.0 if not labels else 0.25,
            "reviewedBy": None,
            "reviewedAt": None,
            "detectedLabels": labels,
            "ambiguity": ambiguity,
        },
    }]


def build_trial_provenance(record: dict[str, Any], registry_version: str) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "registry": "ClinicalTrials.gov",
        "registryVersion": registry_version,
        "retrievedAt": registry_version,
        "rawRecordHash": stable_hash(record),
        "classification": {
            "method": "deterministic_taxonomy_rules",
            "evidenceStrength": record.get("Classification confidence", "UNCLASSIFIED"),
            "isCalibratedProbability": False,
            "taxonomyVersion": record.get("NCCN taxonomy version", ""),
        },
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


@dataclass(frozen=True)
class ModelProposalValidation:
    valid: bool
    errors: tuple[str, ...]


def validate_model_proposal(proposal: dict[str, Any], source_text: str) -> ModelProposalValidation:
    errors: list[str] = []
    predicate = proposal.get("normalizedPredicate")
    span = proposal.get("sourceSpan") or {}
    if not isinstance(predicate, dict):
        errors.append("normalizedPredicate is required")
    else:
        def validate_predicate(expression: Any, path: str, depth: int) -> None:
            if not isinstance(expression, dict):
                errors.append(f"{path} must be an object")
                return
            if depth > 8:
                errors.append(f"{path} exceeds maximum Boolean depth")
                return
            op = str(expression.get("op") or "").upper()
            if op == "FACT":
                if not canonical_token(expression.get("concept")):
                    errors.append(f"{path}.concept is required")
                if not canonical_token(expression.get("predicate")):
                    errors.append(f"{path}.predicate is required")
                if str(expression.get("operator") or "EQ").upper() not in {"EQ", "NE", "IN", "NOT_IN", "GT", "GE", "LT", "LE"}:
                    errors.append(f"{path}.operator is unsupported")
                if "value" not in expression and "assertion" not in expression:
                    errors.append(f"{path} requires value or assertion")
                return
            if op not in {"AND", "ALL_OF", "OR", "ANY_OF", "NONE_OF", "NOT"}:
                errors.append(f"{path}.op is unsupported")
                return
            args = expression.get("args")
            if not isinstance(args, list) or not args:
                errors.append(f"{path}.args must be non-empty")
                return
            if op == "NOT" and len(args) != 1:
                errors.append(f"{path}.args must contain exactly one item for NOT")
            for index, child in enumerate(args):
                validate_predicate(child, f"{path}.args[{index}]", depth + 1)

        validate_predicate(predicate, "normalizedPredicate", 0)
    if not isinstance(span.get("start"), int) or not isinstance(span.get("end"), int):
        errors.append("integer source offsets are required")
    elif span["start"] < 0 or span["end"] <= span["start"] or span["end"] > len(source_text or ""):
        errors.append("source offsets are outside the source text")
    else:
        actual = (source_text or "")[span["start"]:span["end"]]
        if actual != span.get("text"):
            errors.append("source text does not match offsets")
    confidence = proposal.get("confidence")
    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        errors.append("confidence must be between 0 and 1")
    if not proposal.get("modelVersion"):
        errors.append("modelVersion is required")
    if not isinstance(proposal.get("ambiguities"), list):
        errors.append("ambiguities must be an array")
    if not isinstance(proposal.get("criterionType"), str) or not proposal.get("criterionType"):
        errors.append("criterionType is required")
    allowed_keys = {"criterionType", "normalizedPredicate", "sourceSpan", "confidence", "ambiguities", "modelVersion"}
    for key in set(proposal) - allowed_keys:
        errors.append(f"unexpected proposal field: {key}")
    if "decision" in proposal:
        errors.append("models may not directly decide eligibility or hard exclusion")
    return ModelProposalValidation(not errors, tuple(errors))
