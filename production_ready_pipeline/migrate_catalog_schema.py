#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from .clinical_schema import (
        SCHEMA_VERSION,
        build_cohorts,
        canonical_axis_value,
        extract_criteria,
        stable_hash,
        source_content_hash,
    )
    from .nccn_classifier import classify_trial
except ImportError:
    from clinical_schema import (  # type: ignore
        SCHEMA_VERSION,
        build_cohorts,
        canonical_axis_value,
        extract_criteria,
        stable_hash,
        source_content_hash,
    )
    from nccn_classifier import classify_trial  # type: ignore


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "data" / "trials.json"

CANCER_TYPE_MAP = {
    "Bladder": "Bladder/Urothelial",
    "Prostate": "Prostate",
    "Kidney": "Kidney/RCC",
    "Testicular": "Testicular/GCT",
}

AXIS_MAP = {
    "bcgStatus": "bcg_status",
    "cisplatinStatus": "cisplatin_status",
    "cisPapillaryPattern": "cis_papillary_pattern",
    "fgfr3Status": "fgfr3_status",
    "her2Status": "her2_status",
    "castrationStatus": "castration_status",
    "metastaticStatus": "metastatic_status",
    "diseaseVolume": "disease_volume",
    "priorArpi": "prior_arpi",
    "priorDocetaxel": "prior_docetaxel",
    "biomarkerHrr": "biomarker_hrr",
    "psmaStatus": "psma_status",
    "genomicClassifier": "genomic_classifier",
    "histology": "histology",
    "imdcRisk": "imdc_risk",
    "priorSystemicLines": "prior_systemic_lines",
    "priorIo": "prior_io",
    "priorVegfTki": "prior_vegf_tki",
    "nephrectomyStatus": "nephrectomy_status",
    "vhlStatus": "vhl_status",
    "metAlteration": "met_alteration",
    "sarcomatoid": "sarcomatoid",
    "clinicalStage": "clinical_stage",
    "igcccgRisk": "igcccg_risk",
    "primarySite": "primary_site",
    "priorChemoLines": "prior_chemo_lines",
    "priorHdct": "prior_hdct",
    "rplndStatus": "rplnd_status",
    "markerStatus": "marker_status",
    "stage1RiskFactors": "stage1_risk_factors",
}

CANCER_AXIS_TARGETS = {
    "Bladder": {"bcgStatus", "cisplatinStatus", "cisPapillaryPattern", "fgfr3Status", "her2Status"},
    "Prostate": {"castrationStatus", "metastaticStatus", "diseaseVolume", "priorArpi", "priorDocetaxel", "biomarkerHrr", "psmaStatus", "genomicClassifier"},
    "Kidney": {"histology", "imdcRisk", "priorSystemicLines", "priorIo", "priorVegfTki", "nephrectomyStatus", "vhlStatus", "metAlteration", "sarcomatoid"},
    "Testicular": {"histology", "clinicalStage", "igcccgRisk", "primarySite", "priorChemoLines", "priorHdct", "rplndStatus", "markerStatus", "stage1RiskFactors"},
}


def _text(value: Any) -> str:
    if isinstance(value, list):
        return " | ".join(str(item) for item in value if item)
    return str(value or "")


def _canonical_axis(axis_name: str, value: Any) -> str:
    token = str(value or "").strip()
    if token.lower() in {"", "not specified", "unclassified", "n/a"}:
        return "unknown"
    if token.lower() == "not applicable":
        return "not_applicable"
    return canonical_axis_value(AXIS_MAP.get(axis_name, axis_name), token)


def _site_records(trial: dict[str, Any], ingested_at: str) -> list[dict[str, Any]]:
    sites: list[dict[str, Any]] = []
    for source in trial.get("sites") or []:
        site = copy.deepcopy(source)
        explicit_status = site.get("locationStatus") or site.get("status")
        site["locationStatus"] = str(explicit_status or "unknown").strip().lower().replace(" ", "_")
        site["statusSource"] = "registry_location" if explicit_status else "not_available"
        site["sourceVerifiedDate"] = site.get("sourceVerifiedDate") or site.get("verifiedAt")
        site["ingestedAt"] = site.get("ingestedAt") or ingested_at
        site["manualStatus"] = site.get("manualStatus")
        site["statusStale"] = not bool(site["sourceVerifiedDate"])
        sites.append(site)
    return sites


def migrate_trial(trial: dict[str, Any], metadata: dict[str, Any], generated_at: str) -> dict[str, Any]:
    original = copy.deepcopy(trial)
    migrated = copy.deepcopy(trial)
    nct_id = _text(trial.get("nctId") or trial.get("id") or "UNKNOWN")
    registry_version = _text(
        trial.get("lastSyncAt")
        or trial.get("registryVersion")
        or metadata.get("lastSyncAt")
        or trial.get("lastUpdatePosted")
        or "unknown"
    )
    classifier_cancer_type = CANCER_TYPE_MAP.get(_text(trial.get("cancerType")), _text(trial.get("cancerType")))
    classification = classify_trial(
        cancer_type=classifier_cancer_type,
        title=_text(trial.get("title")),
        eligibility_incl=_text(trial.get("inclusionCriteria")),
        eligibility_excl=_text(trial.get("exclusionCriteria")),
        conditions=_text(trial.get("conditions")),
        interventions=_text(trial.get("interventions")),
        brief_summary=_text(trial.get("description")),
    )
    classification_dict = asdict(classification)

    migrated["schemaVersion"] = SCHEMA_VERSION
    migrated["registry"] = "ClinicalTrials.gov"
    migrated["registryVersion"] = registry_version
    migrated["retrievedAt"] = registry_version
    # Recompute source identity rather than trusting a cached hash.
    migrated["rawRecordHash"] = source_content_hash(trial)
    migrated["sourceContentHash"] = migrated["rawRecordHash"]
    migrated["diseaseSettingPrimary"] = classification.disease_setting_primary
    migrated["diseaseSettingPrimaryId"] = classification.disease_setting_primary_id
    migrated["diseaseSettingAll"] = classification.disease_setting_all
    migrated["diseaseSettingAllIds"] = classification.disease_setting_ids
    migrated["classificationConfidence"] = classification.classification_evidence_strength
    migrated["classificationEvidenceStrength"] = classification.classification_evidence_strength
    migrated["classificationIsProbability"] = False
    migrated["classificationMethod"] = classification.classification_method
    migrated["classificationEvidence"] = classification.classification_evidence
    migrated["classificationFieldEvidence"] = classification.classification_field_evidence
    migrated["nccnTaxonomyVersion"] = classification.nccn_version
    migrated["treatmentModality"] = classification.treatment_modality_str
    migrated["delivery"] = classification.delivery
    allowed_axes = CANCER_AXIS_TARGETS.get(_text(trial.get("cancerType")), set())
    migrated["clinicalAxes"] = {
        target: _canonical_axis(target, classification_dict.get(source))
        for target, source in AXIS_MAP.items()
        if target in allowed_axes and _canonical_axis(target, classification_dict.get(source)) != "not_applicable"
    }

    sites = _site_records(trial, generated_at)
    migrated["sites"] = sites
    migrated["rawRecordHash"] = source_content_hash(migrated)
    migrated["sourceContentHash"] = migrated["rawRecordHash"]
    migrated["siteCount"] = len(sites)
    criteria = extract_criteria(
        nct_id=nct_id,
        inclusion_text=_text(trial.get("inclusionCriteria")),
        exclusion_text=_text(trial.get("exclusionCriteria")),
        min_age=_text(trial.get("minimumAge") or trial.get("minAge")),
        max_age=_text(trial.get("maximumAge") or trial.get("maxAge")),
        sex=_text(trial.get("sex")),
        registry_version=registry_version,
    )
    prior_registry_version = _text(trial.get("registryVersion"))
    review_still_current = trial.get("sourceContentHash") == source_content_hash(trial) and prior_registry_version == registry_version
    if review_still_current:
        prior_criteria = {
            item.get("criterionId"): item
            for item in trial.get("criteria") or []
            if item.get("reviewStatus") in {"curator_reviewed", "clinician_reviewed", "rejected"}
        }
        for index, criterion in enumerate(criteria):
            prior = prior_criteria.get(criterion.get("criterionId"))
            if prior and prior.get("sourceSpan") == criterion.get("sourceSpan"):
                criteria[index] = copy.deepcopy(prior)
                criteria[index]["schemaVersion"] = SCHEMA_VERSION
                criteria[index].setdefault("provenance", {})["registryVersion"] = registry_version
    migrated["criteria"] = criteria
    cohorts = build_cohorts(
        nct_id=nct_id,
        title=_text(trial.get("title")),
        status=_text(trial.get("status") or "unknown"),
        disease_setting_ids=classification.disease_setting_ids,
        criteria=criteria,
        inclusion_text=_text(trial.get("inclusionCriteria")),
        sites=sites,
        registry_version=registry_version,
    )
    if review_still_current:
        reviewed_cohorts = [
            copy.deepcopy(cohort)
            for cohort in trial.get("cohorts") or []
            if cohort.get("cohortExtraction", {}).get("reviewedBy")
        ]
        if reviewed_cohorts:
            criteria_by_id = {item.get("criterionId"): item for item in criteria}
            valid_review = True
            for cohort in reviewed_cohorts:
                for key in ("sharedCriteria", "cohortSpecificCriteria"):
                    reviewed_ids = [item.get("criterionId") for item in cohort.get(key) or []]
                    if any(criterion_id not in criteria_by_id for criterion_id in reviewed_ids):
                        valid_review = False
                        break
                    cohort[key] = [copy.deepcopy(criteria_by_id[criterion_id]) for criterion_id in reviewed_ids]
                cohort["schemaVersion"] = SCHEMA_VERSION
                # Cohort closure is independent of the parent trial status.
                cohort["sites"] = sites
            for cohort in reviewed_cohorts:
                assigned_ids = {item.get("criterionId") for key in ("sharedCriteria", "cohortSpecificCriteria") for item in cohort.get(key) or []}
                assigned_ids.update(cohort.get("inapplicableCriterionIds") or [])
                if assigned_ids != set(criteria_by_id):
                    valid_review = False
            if valid_review:
                cohorts = reviewed_cohorts
    migrated["cohorts"] = cohorts
    hard_criteria = [item for item in criteria if item.get("criticality") == "hard"]
    modeled_hard = [item for item in hard_criteria if item.get("modeledStatus") == "modeled"]
    reviewed_hard = [item for item in hard_criteria if item.get("reviewStatus") == "clinician_reviewed"]
    cohort_reviewed = bool(cohorts) and all(cohort.get("cohortExtraction", {}).get("reviewedBy") for cohort in cohorts)
    migrated["dataQuality"] = {
        "schemaVersion": SCHEMA_VERSION,
        "cohortStructure": "curator_reviewed" if cohort_reviewed else "unsegmented_review_required",
        "cohortReviewed": cohort_reviewed,
        "criticalCriterionCount": len(hard_criteria),
        "criticalCriteriaModeled": len(modeled_hard) / len(hard_criteria) if hard_criteria else 0,
        "criticalCriteriaReviewed": len(reviewed_hard) / len(hard_criteria) if hard_criteria else 0,
        "siteStatusCurrent": False,
        "registrySnapshot": registry_version,
        "rawRecordHash": migrated["rawRecordHash"],
    }
    migrated["provenance"] = {
        "schemaVersion": SCHEMA_VERSION,
        "registry": "ClinicalTrials.gov",
        "registryVersion": registry_version,
        "retrievedAt": registry_version,
        "rawRecordHash": migrated["rawRecordHash"],
        "classification": {
            "method": classification.classification_method,
            "evidenceStrength": classification.classification_evidence_strength,
            "isCalibratedProbability": False,
            "fieldEvidence": classification.classification_field_evidence,
            "taxonomyVersion": classification.nccn_version,
        },
        "migration": {
            "method": "catalog-schema-migration-1.0.0",
            "generatedAt": generated_at,
            "limitations": [
                "Historical catalog lacks per-location recruitment timestamps.",
                "Cohort boundaries remain unsegmented until curator review.",
            ],
        },
    }
    source_tags = copy.deepcopy(trial.get("sourceTags") or {})
    source_tags.update({
        "diseaseSettingPrimary": "Deterministic taxonomy rule-inferred",
        "diseaseSettingAll": "Deterministic taxonomy rule-inferred",
        "classificationConfidence": "Deterministic evidence-strength label (not probability)",
        "classificationEvidence": "Deterministic taxonomy rule evidence",
        "treatmentModality": "Deterministic rule-inferred",
        "delivery": "Deterministic rule-inferred",
        "criteria": "Deterministic source-spanned extraction; unreviewed",
        "cohorts": "Deterministic unsegmented fallback; review required",
        "clinicalAxes": {key: "Deterministic rule-inferred" for key in migrated["clinicalAxes"]},
    })
    migrated["sourceTags"] = source_tags
    return migrated


def migrate_catalog(payload: dict[str, Any]) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).isoformat()
    metadata = copy.deepcopy(payload.get("metadata") or {})
    trials = [migrate_trial(trial, metadata, generated_at) for trial in payload.get("trials") or []]
    metadata.update({
        "schemaVersion": SCHEMA_VERSION,
        "schemaMigratedAt": generated_at,
        "schemaMigration": "catalog-schema-migration-1.0.0",
        "trialCount": len(trials),
        "criterionCount": sum(len(trial.get("criteria") or []) for trial in trials),
        "cohortCount": sum(len(trial.get("cohorts") or []) for trial in trials),
        "rawPatientNarrativePersisted": False,
    })
    return {"metadata": metadata, "trials": trials}


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate the website trial catalog to the auditable cohort/criterion schema.")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--write", action="store_true", help="Write migrated JSON. Without this flag, only validate and report counts.")
    args = parser.parse_args()

    payload = json.loads(args.catalog.read_text(encoding="utf-8"))
    migrated = migrate_catalog(payload)
    report = {
        "schemaVersion": migrated["metadata"]["schemaVersion"],
        "trialCount": len(migrated["trials"]),
        "criterionCount": migrated["metadata"]["criterionCount"],
        "cohortCount": migrated["metadata"]["cohortCount"],
        "output": str(args.output or args.catalog),
        "written": bool(args.write),
    }
    if args.write:
        output = args.output or args.catalog
        output.write_text(json.dumps(migrated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
