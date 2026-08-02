#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import json
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE.parent))

from production_ready_pipeline.excel_export import build_cancer_type_excel, build_updates_excel, save_flat_csv
from production_ready_pipeline.website_export import write_website_catalog


PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
_results: list[tuple[bool, str]] = []


def check(condition: bool, description: str) -> None:
    status = PASS if condition else FAIL
    print(f"  [{status}] {description}")
    _results.append((condition, description))


def _sample_records() -> tuple[list[dict], list[dict]]:
    study_records = [
        {
            "NCT ID": "NCT00000001",
            "Study title": "Sample Prostate Trial",
            "Phase": "PHASE2",
            "Status": "RECRUITING",
            "Cancer type": "Prostate",
            "Disease setting (primary)": "mCRPC",
            "Disease setting ID (primary)": "crpc_metastatic_postarpi",
            "Disease setting (all)": "mCRPC",
            "Disease setting IDs (all)": "crpc_metastatic_postarpi | crpc_general",
            "Classification confidence": "HIGH",
            "Classification evidence": "mCRPC | BRCA2 | post-enzalutamide",
            "BCG status": "Not applicable",
            "Cisplatin status": "Not specified",
            "CIS / papillary pattern": "Not applicable",
            "Castration status": "castration_resistant",
            "Metastatic status": "metastatic",
            "Disease volume": "unknown",
            "Prior ARPI": "yes",
            "Prior docetaxel": "no",
            "FGFR3 status": "Not applicable",
            "HER2 status": "Not applicable",
            "HRR biomarker": "positive",
            "PSMA status": "required",
            "Genomic classifier": "Not applicable",
            "Treatment modality": "HORMONAL · TARGETED",
            "Is combination": True,
            "Delivery": "SYSTEMIC",
            "NCCN taxonomy version": "NCCN v5.2026 (2026-01-23)",
            "Conditions": "prostate cancer",
            "Lead sponsor": "Example Sponsor",
            "Additional sponsors": "",
            "Information provided by": "Example Sponsor",
            "Intervention(s)": "DRUG: olaparib",
            "Study design": "Allocation: RANDOMIZED",
            "Enrollment (estimated)": "120",
            "Enrollment (actual)": "",
            "Other study IDs": "ABC-123",
            "Start date": "2026-01-01",
            "Primary completion": "2027-06-01",
            "Last update posted": "2026-04-01",
            "Study first posted": "2026-01-15",
            "Last pulled by": "Test Suite",
            "ClinicalTrials URL": "https://clinicaltrials.gov/study/NCT00000001",
            "Min age": "18 Years",
            "Max age": "",
            "Sex": "Male",
            "Inclusion criteria": "Metastatic castration-resistant prostate cancer",
            "Exclusion criteria": "Prior platinum chemotherapy",
            "Primary outcomes": "• PSA response",
            "Secondary outcomes": "• Overall survival",
            "Brief summary": "Synthetic record for export smoke testing.",
        }
    ]
    site_rows = [
        {
            "NCT ID": "NCT00000001",
            "Trial title": "Sample Prostate Trial",
            "Phase": "PHASE2",
            "Status": "RECRUITING",
            "Cancer type": "Prostate",
            "Disease setting (primary)": "mCRPC",
            "Classification confidence": "HIGH",
            "Treatment modality": "HORMONAL · TARGETED",
            "Delivery": "SYSTEMIC",
            "Institution": "UCLA",
            "PI name": "Smith, Jane",
            "PI email": "jane.smith@example.org",
            "PI phone": "555-111-2222",
            "PI affiliation": "UCLA",
            "Site city": "Los Angeles",
            "Lead sponsor": "Example Sponsor",
        }
    ]
    return study_records, site_rows


def test_exports() -> None:
    print("\n[Step 4] Export smoke test")
    study_records, site_rows = _sample_records()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        csv_path = tmpdir_path / "all_trials_2026-04-16.csv"
        workbook_path = tmpdir_path / "prostate_trials_2026-04-16.xlsx"
        updates_path = tmpdir_path / "updates_2026-04-16.xlsx"
        website_catalog_path = tmpdir_path / "website_trials.json"

        save_flat_csv(study_records, csv_path)
        build_cancer_type_excel(
            cancer_type="Prostate",
            cancer_type_filters=["Prostate"],
            study_records=study_records,
            site_rows=site_rows,
            out_path=workbook_path,
        )
        build_updates_excel(
            study_records=study_records,
            site_rows=site_rows,
            run_ts="2026-04-16_1200",
            prev_csv=None,
            out_path=updates_path,
            client=None,
            api_base_url="https://clinicaltrials.gov/api/v2/studies",
            conditions=["prostate cancer"],
            target_institutions=["UCLA"],
            version="3.0.0",
            pulled_by="Test Suite",
        )
        write_website_catalog(
            study_records=study_records,
            site_rows=site_rows,
            out_path=website_catalog_path,
            run_ts="2026-04-16_1200",
            pipeline_version="3.0.0",
            source_run_dir=str(tmpdir_path),
        )

        check(csv_path.exists() and csv_path.stat().st_size > 0, "Flat CSV written")
        check(workbook_path.exists() and workbook_path.stat().st_size > 0, "Cancer-type workbook written")
        check(updates_path.exists() and updates_path.stat().st_size > 0, "Updates workbook written")
        check(website_catalog_path.exists() and website_catalog_path.stat().st_size > 0, "Website catalog written")

        payload = json.loads(website_catalog_path.read_text(encoding="utf-8"))
        metadata = payload.get("metadata", {})
        trials = payload.get("trials", [])
        first_trial = trials[0] if trials else {}

        check(metadata.get("trialCount") == 1, "Website catalog metadata includes trial count")
        check(metadata.get("institutionCount") == 1, "Website catalog metadata includes institution count")
        check(first_trial.get("phase") == "Phase II", "Website catalog normalizes display phase")
        check(first_trial.get("availableInstitutions") == ["UCLA"], "Website catalog preserves institution list")
        check(first_trial.get("sites", [{}])[0].get("email") == "jane.smith@example.org", "Website catalog preserves site contacts")
        check(first_trial.get("diseaseSettingPrimaryId") == "crpc_metastatic_postarpi", "Website catalog preserves primary disease-setting id")
        check(first_trial.get("diseaseSettingAllIds") == ["crpc_metastatic_postarpi", "crpc_general"], "Website catalog preserves disease-setting ids")
        check(first_trial.get("classificationEvidence") == ["mCRPC", "BRCA2", "post-enzalutamide"], "Website catalog preserves classification evidence")
        check(first_trial.get("clinicalAxes", {}).get("priorArpi") == "yes", "Website catalog preserves clinical axes")
        check(first_trial.get("clinicalAxes", {}).get("fgfr3Status") is None, "Website catalog omits empty bladder biomarker axes")
        check(first_trial.get("sourceTags", {}).get("diseaseSettingPrimary") == "NCCN-inferred", "Website catalog emits source tags")

        invalid_catalog_path = tmpdir_path / "website_trials_invalid_email.json"
        invalid_site_rows = [dict(site_rows[0], **{"PI email": "clinicaltrials.@hoag.org"})]
        write_website_catalog(
            study_records=study_records,
            site_rows=invalid_site_rows,
            out_path=invalid_catalog_path,
            run_ts="2026-04-16_1200",
            pipeline_version="3.0.0",
            source_run_dir=str(tmpdir_path),
        )
        invalid_payload = json.loads(invalid_catalog_path.read_text(encoding="utf-8"))
        invalid_trial = invalid_payload.get("trials", [{}])[0]
        check(invalid_trial.get("contactEmail") == "", "Website catalog drops invalid contact email")
        check(invalid_trial.get("sites", [{}])[0].get("email") == "", "Website catalog drops invalid site email")


if __name__ == "__main__":
    test_exports()

    passed = sum(1 for ok, _ in _results if ok)
    total = len(_results)
    print(f"\n{'=' * 50}")
    print(f"Step 4 results: {passed}/{total} checks passed")
    if passed < total:
        print("Failed checks:")
        for ok, description in _results:
            if not ok:
                print(f"  - {description}")
        sys.exit(1)
    print("All Step 4 export checks passed.")
