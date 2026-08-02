#!/usr/bin/env python3
"""Deterministic safety-contract checks for protocol normalization."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "production_ready_pipeline"
if str(PIPELINE) not in sys.path:
    sys.path.insert(0, str(PIPELINE))

from clinical_schema import _recognized_predicate, canonical_token, extract_criteria  # noqa: E402


def main() -> None:
    assert canonical_token("ageYears") == "age_years"
    assert canonical_token("sinceLastSystemicTherapyDays") == "since_last_systemic_therapy_days"

    predicate, confidence = _recognized_predicate("Participants must be 18 years of age or older.")
    assert confidence == 0.99
    assert predicate == {
        "op": "FACT",
        "concept": "ageYears",
        "predicate": "has",
        "operator": "GE",
        "value": 18,
        "label": "Minimum age",
    }

    predicate, _ = _recognized_predicate("Age 18 to 80 years.")
    assert predicate and predicate["op"] == "AND"
    assert [(child["operator"], child["value"]) for child in predicate["args"]] == [("GE", 18), ("LE", 80)]

    predicate, _ = _recognized_predicate("Male participants only, age at least 18 years.")
    assert predicate and predicate["op"] == "AND"
    assert {child["concept"] for child in predicate["args"]} == {"ageYears", "administrativeSex"}

    assert _recognized_predicate("Systemic antibiotics within 7 days.") == (None, None)
    assert _recognized_predicate("Chemotherapy within 4 weeks or 5 half-lives, whichever is shorter.") == (None, None)

    surgery, _ = _recognized_predicate("Major surgery within 30 days.")
    assert surgery and surgery["concept"] == "sinceLastSurgeryDays" and surgery["value"] == 30
    therapy, _ = _recognized_predicate("Anticancer therapy within 4 weeks.")
    assert therapy and therapy["concept"] == "sinceLastSystemicTherapyDays" and therapy["value"] == 28

    criteria = extract_criteria(
        nct_id="NCT-SCHEMA",
        inclusion_text="18 years of age or older.",
        exclusion_text="Female participants only.",
        min_age="",
        max_age="",
        sex="",
        registry_version="2026-08-02T00:00:00Z",
    )
    inclusion, exclusion = criteria
    assert inclusion["modeledStatus"] == "modeled"
    assert inclusion["predicate"]["concept"] == "age_years"
    assert exclusion["modeledStatus"] == "not_modeled"
    assert exclusion["predicate"]["op"] == "NOT_MODELED"

    segmented = extract_criteria(
        nct_id="NCT-COMPLEX",
        inclusion_text="ECOG 0 or 1. * Any of several other conditions. * Another condition.",
        exclusion_text="",
        min_age="",
        max_age="",
        sex="",
        registry_version="2026-08-02T00:00:00Z",
    )
    assert segmented[0]["modeledStatus"] == "modeled"
    assert all(item["predicate"]["op"] == "NOT_MODELED" for item in segmented[1:])

    print("Clinical schema safety tests passed.")


if __name__ == "__main__":
    main()
