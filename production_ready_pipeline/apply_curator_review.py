#!/usr/bin/env python3
"""Validate and apply a human review to one immutable trial snapshot.

The tool is dry-run by default. A review is bound to the trial's raw-record hash
and registry version, so it cannot silently migrate to changed protocol text.
Only a clinician review may correct a normalized predicate or enable the
``clinician_reviewed`` hard-exclusion gate.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from .clinical_schema import SCHEMA_VERSION, canonical_token, stable_hash, source_content_hash
except ImportError:
    from clinical_schema import SCHEMA_VERSION, canonical_token, stable_hash, source_content_hash  # type: ignore


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "data" / "trials.json"
ALLOWED_FACT_OPERATORS = {"EQ", "NE", "IN", "NOT_IN", "GT", "GE", "LT", "LE"}
ALLOWED_BOOLEAN_OPERATORS = {"AND", "ALL_OF", "OR", "ANY_OF", "NONE_OF", "NOT"}


class ReviewValidationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ReviewValidationError(message)


def _parse_datetime(value: Any, field: str) -> str:
    token = str(value or "")
    try:
        datetime.fromisoformat(token.replace("Z", "+00:00"))
    except ValueError as error:
        raise ReviewValidationError(f"{field} must be an ISO-8601 date-time") from error
    return token


def _validate_predicate(expression: Any, *, depth: int = 0) -> dict[str, Any]:
    _require(depth <= 8, "normalizedPredicate exceeds maximum Boolean depth")
    _require(isinstance(expression, dict), "normalizedPredicate must be an object")
    op = str(expression.get("op") or "FACT").upper()
    _require(op not in {"ELIGIBLE", "INELIGIBLE", "HARD_EXCLUSION", "DECISION"}, "predicate cannot encode an eligibility decision")
    if op == "FACT":
        _require(bool(canonical_token(expression.get("concept"))), "FACT requires a concept")
        _require(bool(canonical_token(expression.get("predicate") or "has")), "FACT requires a predicate")
        operator = str(expression.get("operator") or "EQ").upper()
        _require(operator in ALLOWED_FACT_OPERATORS, f"unsupported FACT operator: {operator}")
        _require("value" in expression or "assertion" in expression, "FACT requires value or assertion")
        normalized = copy.deepcopy(expression)
        normalized["op"] = "FACT"
        normalized["concept"] = canonical_token(expression["concept"])
        normalized["predicate"] = canonical_token(expression.get("predicate") or "has")
        normalized["operator"] = operator
        return normalized

    _require(op in ALLOWED_BOOLEAN_OPERATORS, f"unsupported Boolean operator: {op}")
    children = expression.get("args")
    if op == "NOT" and children is None and expression.get("arg") is not None:
        children = [expression["arg"]]
    _require(isinstance(children, list) and len(children) > 0, f"{op} requires non-empty args")
    if op == "NOT":
        _require(len(children) == 1, "NOT requires exactly one argument")
    normalized = copy.deepcopy(expression)
    normalized["op"] = op
    normalized["args"] = [_validate_predicate(child, depth=depth + 1) for child in children]
    normalized.pop("arg", None)
    return normalized


def _validate_source_span(trial: dict[str, Any], span: Any, label: str) -> dict[str, Any]:
    _require(isinstance(span, dict), f"{label}.sourceSpan must be an object")
    field = str(span.get("field") or "")
    _require(field in {"inclusionCriteria", "exclusionCriteria"}, f"{label}.sourceSpan.field is invalid")
    start, end = span.get("start"), span.get("end")
    _require(isinstance(start, int) and isinstance(end, int) and 0 <= start < end, f"{label}.sourceSpan offsets are invalid")
    source = str(trial.get(field) or "")
    _require(end <= len(source), f"{label}.sourceSpan exceeds {field}")
    _require(source[start:end] == span.get("text"), f"{label}.sourceSpan text does not match exact offsets")
    return {"field": field, "start": start, "end": end, "text": span["text"]}


def validate_and_apply(payload: dict[str, Any], review: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    _require(review.get("schemaVersion") == SCHEMA_VERSION, f"schemaVersion must be {SCHEMA_VERSION}")
    for field in ("reviewId", "trialId", "trialRawRecordHash", "registryVersion"):
        _require(bool(str(review.get(field) or "").strip()), f"{field} is required")
    reviewed_at = _parse_datetime(review.get("reviewedAt"), "reviewedAt")
    reviewer = review.get("reviewer")
    _require(isinstance(reviewer, dict), "reviewer is required")
    reviewer_id = str(reviewer.get("id") or "").strip()
    reviewer_role = str(reviewer.get("role") or "").strip()
    _require(bool(reviewer_id), "reviewer.id is required")
    _require(reviewer_role in {"curator", "clinician"}, "reviewer.role must be curator or clinician")

    updated = copy.deepcopy(payload)
    trials = updated.get("trials")
    _require(isinstance(trials, list), "catalog.trials must be an array")
    matching = [trial for trial in trials if str(trial.get("nctId") or trial.get("id")) == str(review["trialId"])]
    _require(len(matching) == 1, "review trialId must identify exactly one catalog trial")
    trial = matching[0]
    _require(trial.get("rawRecordHash") == review["trialRawRecordHash"], "trialRawRecordHash is stale or does not match")
    _require(trial.get("sourceContentHash") == source_content_hash(trial), "actual source content changed; migrate the catalog before review")
    _require(str(trial.get("registryVersion") or "") == str(review["registryVersion"]), "registryVersion is stale or does not match")

    criteria = copy.deepcopy(trial.get("criteria") or [])
    criteria_by_id = {criterion.get("criterionId"): criterion for criterion in criteria}
    _require(len(criteria_by_id) == len(criteria), "catalog criterionIds must be unique")
    decisions = review.get("criterionDecisions")
    _require(isinstance(decisions, list), "criterionDecisions must be an array")
    seen_decisions: set[str] = set()
    decision_counts = {"approve": 0, "reject": 0, "correct": 0}

    for item in decisions:
        _require(isinstance(item, dict), "criterion decision must be an object")
        criterion_id = str(item.get("criterionId") or "")
        decision = str(item.get("decision") or "")
        rationale = str(item.get("rationale") or "").strip()
        _require(criterion_id in criteria_by_id, f"unknown criterionId: {criterion_id}")
        _require(criterion_id not in seen_decisions, f"duplicate criterion decision: {criterion_id}")
        _require(decision in decision_counts, f"unsupported criterion decision: {decision}")
        _require(bool(rationale), f"rationale is required for {criterion_id}")
        seen_decisions.add(criterion_id)
        decision_counts[decision] += 1
        criterion = criteria_by_id[criterion_id]
        prior_hash = stable_hash(criterion)

        if decision == "approve":
            _require(criterion.get("modeledStatus") == "modeled", f"cannot approve unmodeled criterion: {criterion_id}")
        elif decision == "reject":
            criterion["modeledStatus"] = "not_modeled"
            criterion["predicate"] = {
                "op": "NOT_MODELED",
                "sourceText": str(criterion.get("sourceSpan", {}).get("text") or ""),
            }
        else:
            _require(reviewer_role == "clinician", "only a clinician may correct a normalized criterion")
            _require("normalizedPredicate" in item, f"normalizedPredicate is required for correction: {criterion_id}")
            criterion["predicate"] = _validate_predicate(item["normalizedPredicate"])
            criterion["modeledStatus"] = "modeled"

        if item.get("criticality"):
            _require(reviewer_role == "clinician", "only a clinician may change criterion criticality")
            _require(item["criticality"] in {"hard", "supporting", "preference"}, "invalid criticality")
            criterion["criticality"] = item["criticality"]
        criterion["reviewStatus"] = "rejected" if decision == "reject" else ("clinician_reviewed" if reviewer_role == "clinician" else "curator_reviewed")
        criterion.setdefault("provenance", {})["humanReview"] = {
            "reviewId": review["reviewId"],
            "reviewerId": reviewer_id,
            "reviewerRole": reviewer_role,
            "reviewedAt": reviewed_at,
            "decision": decision,
            "rationale": rationale,
            "priorCriterionHash": prior_hash,
        }

    cohort_specs = review.get("cohorts")
    _require(isinstance(cohort_specs, list) and cohort_specs, "cohorts must be a non-empty array")
    cohort_ids: set[str] = set()
    cohorts: list[dict[str, Any]] = []
    for spec in cohort_specs:
        _require(isinstance(spec, dict), "cohort review entry must be an object")
        cohort_id = str(spec.get("cohortId") or "").strip()
        label = str(spec.get("label") or "").strip()
        _require(bool(cohort_id) and cohort_id not in cohort_ids, "cohortIds must be non-empty and unique")
        _require(bool(label), f"label is required for cohort {cohort_id}")
        cohort_ids.add(cohort_id)
        shared_ids = spec.get("sharedCriterionIds")
        specific_ids = spec.get("cohortSpecificCriterionIds")
        _require(isinstance(shared_ids, list) and isinstance(specific_ids, list), f"criterion ID lists are required for {cohort_id}")
        _require(not (set(shared_ids) & set(specific_ids)), f"shared and cohort-specific criteria overlap for {cohort_id}")
        unknown_ids = (set(shared_ids) | set(specific_ids)) - set(criteria_by_id)
        _require(not unknown_ids, f"unknown criterionIds for {cohort_id}: {sorted(unknown_ids)}")
        _require(len(shared_ids) == len(set(shared_ids)) and len(specific_ids) == len(set(specific_ids)), "duplicate criterion assignment")
        dispositions = spec.get("inapplicableCriteria") or []
        _require(all(isinstance(item, dict) and item.get("criterionId") in criteria_by_id and str(item.get("rationale") or "").strip() for item in dispositions), "inapplicable criteria require a known ID and rationale")
        inapplicable_ids = {item["criterionId"] for item in dispositions}
        _require(not (inapplicable_ids & (set(shared_ids) | set(specific_ids))), "inapplicable and evaluated criteria overlap")
        _require(set(shared_ids) | set(specific_ids) | inapplicable_ids == set(criteria_by_id), f"every source criterion must be assigned or explicitly inapplicable for {cohort_id}")
        source_span = _validate_source_span(trial, spec.get("sourceSpan"), f"cohort {cohort_id}")
        cohorts.append({
            "schemaVersion": SCHEMA_VERSION,
            "cohortId": cohort_id,
            "label": label,
            "inapplicableCriteria": copy.deepcopy(dispositions),
            "inapplicableCriterionIds": sorted(inapplicable_ids),
            "armIds": [str(value) for value in spec.get("armIds") or []],
            "enrollmentStatus": str(spec.get("enrollmentStatus") or trial.get("status") or "unknown"),
            "statusProvenance": {
                "source": "ClinicalTrials.gov",
                "registryVersion": trial.get("registryVersion"),
            },
            "diseaseConcepts": [canonical_token(value) for value in spec.get("diseaseConcepts") or trial.get("diseaseSettingAllIds") or []],
            "interventions": copy.deepcopy(trial.get("interventions") or []),
            "sites": copy.deepcopy(trial.get("sites") or []),
            "sharedCriteria": [copy.deepcopy(criteria_by_id[value]) for value in shared_ids],
            "cohortSpecificCriteria": [copy.deepcopy(criteria_by_id[value]) for value in specific_ids],
            "cohortExtraction": {
                "method": "human_curated",
                "confidence": 1.0,
                "reviewedBy": reviewer_id,
                "reviewerRole": reviewer_role,
                "reviewedAt": reviewed_at,
                "reviewId": review["reviewId"],
                "sourceSpan": source_span,
                "ambiguity": None,
                "rationale": str(spec.get("rationale") or ""),
            },
        })

    trial["criteria"] = criteria
    trial["cohorts"] = cohorts
    hard = [criterion for criterion in criteria if criterion.get("criticality") == "hard"]
    modeled = [criterion for criterion in hard if criterion.get("modeledStatus") == "modeled"]
    clinician_reviewed = [criterion for criterion in hard if criterion.get("reviewStatus") == "clinician_reviewed"]
    quality = copy.deepcopy(trial.get("dataQuality") or {})
    quality.update({
        "schemaVersion": SCHEMA_VERSION,
        "cohortStructure": "curator_reviewed",
        "cohortReviewed": True,
        "criticalCriterionCount": len(hard),
        "criticalCriteriaModeled": len(modeled) / len(hard) if hard else 0,
        "criticalCriteriaReviewed": len(clinician_reviewed) / len(hard) if hard else 0,
        "lastHumanReviewId": review["reviewId"],
        "lastHumanReviewedAt": reviewed_at,
    })
    trial["dataQuality"] = quality
    trial.setdefault("curationHistory", []).append({
        "reviewId": review["reviewId"],
        "reviewerId": reviewer_id,
        "reviewerRole": reviewer_role,
        "reviewedAt": reviewed_at,
        "trialRawRecordHash": review["trialRawRecordHash"],
        "registryVersion": review["registryVersion"],
        "reviewArtifactHash": stable_hash(review),
        "criterionDecisionCounts": decision_counts,
        "cohortCount": len(cohorts),
    })

    metadata = updated.setdefault("metadata", {})
    metadata["lastCurationReviewAt"] = reviewed_at
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "reviewId": review["reviewId"],
        "trialId": review["trialId"],
        "reviewerRole": reviewer_role,
        "criterionDecisionCounts": decision_counts,
        "cohortCount": len(cohorts),
        "criticalCriteriaModeled": quality["criticalCriteriaModeled"],
        "criticalCriteriaClinicianReviewed": quality["criticalCriteriaReviewed"],
        "reviewArtifactHash": stable_hash(review),
    }
    return updated, report


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and apply a hash-bound human trial/cohort review.")
    parser.add_argument("review", type=Path, help="Review artifact conforming to schemas/cohort-review.schema.json")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--write", action="store_true", help="Write the updated catalog; default is validation-only dry run")
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    review = json.loads(args.review.read_text(encoding="utf-8"))
    updated, report = validate_and_apply(catalog, review)
    report["written"] = bool(args.write)
    report["output"] = str(args.output or args.catalog)
    if args.write:
        _atomic_write(args.output or args.catalog, updated)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReviewValidationError as error:
        print(json.dumps({"valid": False, "error": str(error)}, indent=2))
        raise SystemExit(2)
