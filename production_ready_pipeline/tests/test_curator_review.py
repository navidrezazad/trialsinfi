#!/usr/bin/env python3
"""Safety checks for hash-bound human cohort review application."""

from __future__ import annotations

import copy
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "production_ready_pipeline"
if str(PIPELINE) not in sys.path:
    sys.path.insert(0, str(PIPELINE))

from apply_curator_review import ReviewValidationError, validate_and_apply  # noqa: E402


def fixture() -> tuple[dict, dict]:
    source = "Participants must be 18 years of age or older."
    criterion = {
        "schemaVersion": "1.0.0",
        "criterionId": "NCT-REVIEW:I1",
        "scope": "cohort",
        "kind": "inclusion",
        "criticality": "hard",
        "predicate": {"op": "FACT", "concept": "age_years", "predicate": "has", "operator": "GE", "value": 18},
        "sourceSpan": {"field": "inclusionCriteria", "text": source, "start": 0, "end": len(source)},
        "provenance": {"source": "ClinicalTrials.gov", "registryVersion": "2026-08-01T00:00:00Z"},
        "reviewStatus": "unreviewed",
        "modeledStatus": "modeled",
    }
    catalog = {
        "metadata": {"schemaVersion": "1.0.0"},
        "trials": [{
            "schemaVersion": "1.0.0",
            "id": "NCT-REVIEW",
            "nctId": "NCT-REVIEW",
            "status": "recruiting",
            "registryVersion": "2026-08-01T00:00:00Z",
            "rawRecordHash": "sha256:" + "a" * 64,
            "inclusionCriteria": source,
            "exclusionCriteria": "",
            "diseaseSettingAllIds": ["crpc_general"],
            "criteria": [criterion],
            "cohorts": [],
            "sites": [],
            "dataQuality": {},
        }],
    }
    review = {
        "schemaVersion": "1.0.0",
        "reviewId": "review-001",
        "trialId": "NCT-REVIEW",
        "trialRawRecordHash": "sha256:" + "a" * 64,
        "registryVersion": "2026-08-01T00:00:00Z",
        "reviewer": {"id": "clinician-test", "role": "clinician"},
        "reviewedAt": "2026-08-02T12:00:00Z",
        "criterionDecisions": [{
            "criterionId": "NCT-REVIEW:I1",
            "decision": "approve",
            "rationale": "Exact registry age threshold.",
        }],
        "cohorts": [{
            "cohortId": "NCT-REVIEW:adult",
            "label": "Adult cohort",
            "sharedCriterionIds": ["NCT-REVIEW:I1"],
            "cohortSpecificCriterionIds": [],
            "sourceSpan": {"field": "inclusionCriteria", "start": 0, "end": len(source), "text": source},
            "rationale": "The registry describes one enrollment pathway.",
        }],
    }
    return catalog, review


def expect_failure(catalog: dict, review: dict, expected: str) -> None:
    try:
        validate_and_apply(catalog, review)
    except ReviewValidationError as error:
        assert expected in str(error), (expected, str(error))
        return
    raise AssertionError(f"Expected ReviewValidationError containing {expected!r}")


def main() -> None:
    catalog, review = fixture()
    updated, report = validate_and_apply(catalog, review)
    trial = updated["trials"][0]
    assert report["cohortCount"] == 1
    assert trial["criteria"][0]["reviewStatus"] == "clinician_reviewed"
    assert trial["cohorts"][0]["cohortExtraction"]["method"] == "human_curated"
    assert trial["dataQuality"]["criticalCriteriaReviewed"] == 1
    assert len(trial["curationHistory"]) == 1
    assert catalog["trials"][0]["cohorts"] == [], "Input catalog must not be mutated"

    stale = copy.deepcopy(review)
    stale["trialRawRecordHash"] = "sha256:" + "b" * 64
    expect_failure(catalog, stale, "stale")

    bad_span = copy.deepcopy(review)
    bad_span["cohorts"][0]["sourceSpan"]["text"] = "wrong"
    expect_failure(catalog, bad_span, "does not match")

    curator_correction = copy.deepcopy(review)
    curator_correction["reviewer"]["role"] = "curator"
    curator_correction["criterionDecisions"][0].update({
        "decision": "correct",
        "normalizedPredicate": {"op": "FACT", "concept": "age_years", "predicate": "has", "operator": "GE", "value": 21},
    })
    expect_failure(catalog, curator_correction, "only a clinician")

    direct_decision = copy.deepcopy(review)
    direct_decision["criterionDecisions"][0].update({
        "decision": "correct",
        "normalizedPredicate": {"op": "ELIGIBLE", "args": []},
    })
    expect_failure(catalog, direct_decision, "eligibility decision")

    print("Curator review safety tests passed.")


if __name__ == "__main__":
    main()
