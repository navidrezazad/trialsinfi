#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
REPO_ROOT = PACKAGE.parent
sys.path.insert(0, str(REPO_ROOT))

from production_ready_pipeline.tests.test_step4_exports import _sample_records
from production_ready_pipeline.website_export import write_website_catalog


PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
_results: list[tuple[bool, str]] = []


def check(condition: bool, description: str) -> None:
    status = PASS if condition else FAIL
    print(f"  [{status}] {description}")
    _results.append((condition, description))


def test_php_import_roundtrip() -> None:
    print("\n[Step 5] PHP importer schema smoke test")
    study_records, site_rows = _sample_records()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        website_catalog_path = tmpdir_path / "website_trials.json"
        imported_catalog_path = tmpdir_path / "imported_trials.json"

        write_website_catalog(
            study_records=study_records,
            site_rows=site_rows,
            out_path=website_catalog_path,
            run_ts="2026-04-16_1200",
            pipeline_version="3.0.0",
            source_run_dir=str(tmpdir_path),
        )

        result = subprocess.run(
            [
                "php",
                str(REPO_ROOT / "scripts" / "import_website_catalog.php"),
                str(website_catalog_path),
                f"--catalog-path={imported_catalog_path}",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        check(
            result.returncode == 0,
            "PHP importer exits successfully"
            + (f" ({result.stderr.strip()})" if result.returncode else ""),
        )
        if result.returncode != 0:
            return

        check(imported_catalog_path.exists(), "PHP importer writes the catalog file")
        check("Imported website catalog into" in result.stdout, "PHP importer reports success")

        payload = json.loads(imported_catalog_path.read_text(encoding="utf-8"))
        metadata = payload.get("metadata", {})
        trials = payload.get("trials", [])
        first_trial = trials[0] if trials else {}

        check(metadata.get("trialCount") == 1, "Imported catalog metadata preserves trial count")
        check(first_trial.get("diseaseSettingPrimaryId") == "crpc_metastatic_postarpi", "PHP importer preserves primary disease-setting id")
        check(first_trial.get("diseaseSettingAllIds") == ["crpc_metastatic_postarpi", "crpc_general"], "PHP importer preserves disease-setting ids")
        check(first_trial.get("classificationEvidence") == ["mCRPC", "BRCA2", "post-enzalutamide"], "PHP importer preserves classification evidence")
        check(first_trial.get("clinicalAxes", {}).get("priorArpi") == "yes", "PHP importer preserves clinical axes")
        check(first_trial.get("sourceTags", {}).get("diseaseSettingPrimary") == "NCCN-inferred", "PHP importer preserves source tags")


if __name__ == "__main__":
    test_php_import_roundtrip()

    passed = sum(1 for ok, _ in _results if ok)
    total = len(_results)
    print(f"\n{'=' * 50}")
    print(f"Step 5 results: {passed}/{total} checks passed")
    if passed < total:
        print("Failed checks:")
        for ok, description in _results:
            if not ok:
                print(f"  - {description}")
        sys.exit(1)
    print("All Step 5 PHP import checks passed.")
