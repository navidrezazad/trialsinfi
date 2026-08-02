#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
import time
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from production_ready_pipeline.api_client import ClinicalTrialsGovClient
from production_ready_pipeline.app_config import load_pipeline_config
from production_ready_pipeline.excel_export import (
    build_cancer_type_excel,
    build_updates_excel,
    find_prev_csv,
    save_flat_csv,
)
from production_ready_pipeline.nccn_classifier import classify_trial
from production_ready_pipeline.site_normalization import SiteNormalizer
from production_ready_pipeline.study_parser import parse_study_extended
from production_ready_pipeline.website_export import write_website_catalog


VERSION = "3.0.0"
PULLED_BY = "Production Ready Pipeline"
CANCER_TYPE_DEFS = [
    ("prostate", "Prostate", ["Prostate"]),
    ("bladder", "Bladder/Urothelial", ["Bladder/Urothelial"]),
    ("kidney_adrenal", "Kidney/RCC", ["Kidney/RCC", "Adrenal"]),
    ("testicular", "Testicular/GCT", ["Testicular/GCT"]),
]


def _classify_records(study_records: list[dict], site_rows: list[dict]) -> None:
    classifications: dict[str, dict[str, object]] = {}

    for record in study_records:
        cancer_types = record.get("Cancer type", "")
        primary_cancer_type = cancer_types.split(" | ")[0] if " | " in cancer_types else cancer_types
        classification = classify_trial(
            cancer_type=primary_cancer_type,
            title=record.get("Study title", ""),
            eligibility_incl=record.get("_inclusion_raw", ""),
            eligibility_excl=record.get("_exclusion_raw", ""),
            conditions=record.get("Conditions", ""),
            interventions=record.get("_interventions_raw", ""),
            brief_summary=record.get("Brief summary", ""),
        )

        record["Disease setting (primary)"] = classification.disease_setting_primary
        record["Disease setting ID (primary)"] = classification.disease_setting_primary_id
        record["Disease setting (all)"] = classification.disease_setting_all
        record["Disease setting IDs (all)"] = " | ".join(classification.disease_setting_ids)
        record["Classification confidence"] = classification.classification_confidence
        record["Classification evidence strength"] = classification.classification_evidence_strength
        record["Classification is probability"] = classification.classification_is_probability
        record["Classification method"] = classification.classification_method
        record["Classification field evidence"] = classification.classification_field_evidence
        record["Classification evidence"] = " | ".join(classification.classification_evidence)
        record["BCG status"] = classification.bcg_status
        record["Cisplatin status"] = classification.cisplatin_status
        record["CIS / papillary pattern"] = classification.cis_papillary_pattern
        record["Castration status"] = classification.castration_status
        record["Metastatic status"] = classification.metastatic_status
        record["Disease volume"] = classification.disease_volume
        record["Prior ARPI"] = classification.prior_arpi
        record["Prior docetaxel"] = classification.prior_docetaxel
        record["FGFR3 status"] = classification.fgfr3_status
        record["HER2 status"] = classification.her2_status
        record["HRR biomarker"] = classification.biomarker_hrr
        record["PSMA status"] = classification.psma_status
        record["Genomic classifier"] = classification.genomic_classifier
        record["Histology"] = classification.histology
        record["IMDC risk"] = classification.imdc_risk
        record["Prior systemic lines"] = classification.prior_systemic_lines
        record["Prior IO"] = classification.prior_io
        record["Prior VEGF/TKI"] = classification.prior_vegf_tki
        record["Nephrectomy status"] = classification.nephrectomy_status
        record["VHL status"] = classification.vhl_status
        record["MET alteration"] = classification.met_alteration
        record["Sarcomatoid"] = classification.sarcomatoid
        record["Clinical stage"] = classification.clinical_stage
        record["IGCCCG risk"] = classification.igcccg_risk
        record["Primary site"] = classification.primary_site
        record["Prior chemo lines"] = classification.prior_chemo_lines
        record["Prior HDCT"] = classification.prior_hdct
        record["RPLND status"] = classification.rplnd_status
        record["Marker status"] = classification.marker_status
        record["Stage I risk factors"] = classification.stage1_risk_factors
        record["Treatment modality"] = classification.treatment_modality_str
        record["Treatment modalities"] = " | ".join(classification.treatment_modalities)
        record["Is combination"] = classification.is_combination
        record["Delivery"] = classification.delivery
        record["NCCN taxonomy version"] = (
            f"NCCN v{classification.nccn_version} ({classification.nccn_date})"
            if classification.nccn_version
            else "N/A"
        )

        classifications[record["NCT ID"]] = {
            "Disease setting (primary)": classification.disease_setting_primary,
            "Classification confidence": classification.classification_confidence,
            "Treatment modality": classification.treatment_modality_str,
            "Delivery": classification.delivery,
        }

    for site_row in site_rows:
        classification = classifications.get(site_row["NCT ID"], {})
        site_row["Disease setting (primary)"] = classification.get("Disease setting (primary)", "")
        site_row["Classification confidence"] = classification.get("Classification confidence", "")
        site_row["Treatment modality"] = classification.get("Treatment modality", "")
        site_row["Delivery"] = classification.get("Delivery", "")

    for record in study_records:
        record.pop("_interventions_raw", None)
        record.pop("_inclusion_raw", None)
        record.pop("_exclusion_raw", None)


def run_pipeline(
    *,
    root: Path | None = None,
    output_root: Path | None = None,
    timestamp: str | None = None,
    page_size: int | None = None,
    max_conditions: int | None = None,
    skip_excel: bool = False,
    skip_updates: bool = False,
    website_catalog_out: Path | None = None,
) -> dict:
    config = load_pipeline_config(root)
    api_config = replace(config.api, page_size=page_size or config.api.page_size)
    client = ClinicalTrialsGovClient(api_config)
    normalizer = SiteNormalizer(config.site_config)

    run_ts = timestamp or datetime.now().strftime("%Y-%m-%d_%H%M")
    run_date = run_ts.split("_")[0]
    output_dir = Path(output_root) if output_root else config.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    run_output_dir = output_dir / run_ts
    run_output_dir.mkdir(parents=True, exist_ok=True)
    previous_csv = find_prev_csv(output_dir, run_ts)

    conditions = list(config.search_terms.primary_terms)
    if max_conditions is not None:
        conditions = conditions[:max_conditions]

    fetch_start = time.time()
    studies = client.fetch_all(conditions)
    fetch_seconds = time.time() - fetch_start

    study_records: list[dict] = []
    site_rows: list[dict] = []
    seen_ncts: set[str] = set()
    seen_site_keys: set[tuple[str, str]] = set()

    for study in studies:
        record, record_site_rows = parse_study_extended(study, normalizer=normalizer, pulled_by=PULLED_BY)
        if record is None:
            continue
        nct_id = record["NCT ID"]
        if nct_id not in seen_ncts:
            seen_ncts.add(nct_id)
            study_records.append(record)
        for site_row in record_site_rows:
            site_key = (site_row["NCT ID"], site_row["Institution"])
            if site_key not in seen_site_keys:
                seen_site_keys.add(site_key)
                site_rows.append(site_row)

    if not study_records:
        raise RuntimeError("No qualifying trials found for the configured SoCal pipeline filters.")

    _classify_records(study_records, site_rows)

    csv_path = run_output_dir / f"all_trials_{run_date}.csv"
    save_flat_csv(study_records, csv_path)
    website_catalog_path = website_catalog_out or (run_output_dir / "website_trials.json")
    write_website_catalog(
        study_records=study_records,
        site_rows=site_rows,
        out_path=website_catalog_path,
        run_ts=run_ts,
        pipeline_version=VERSION,
        source_run_dir=str(run_output_dir),
    )

    if not skip_excel:
        for filename_prefix, cancer_type, filters in CANCER_TYPE_DEFS:
            workbook_path = run_output_dir / f"{filename_prefix}_trials_{run_date}.xlsx"
            build_cancer_type_excel(
                cancer_type=cancer_type,
                cancer_type_filters=filters,
                study_records=study_records,
                site_rows=site_rows,
                out_path=workbook_path,
            )

    if not skip_updates:
        updates_path = run_output_dir / f"updates_{run_date}.xlsx"
        build_updates_excel(
            study_records=study_records,
            site_rows=site_rows,
            run_ts=run_ts,
            prev_csv=previous_csv,
            out_path=updates_path,
            client=client,
            api_base_url=api_config.base_url,
            conditions=conditions,
            target_institutions=sorted(normalizer.target_institutions),
            version=VERSION,
            pulled_by=PULLED_BY,
        )

    return {
        "run_ts": run_ts,
        "run_output_dir": str(run_output_dir),
        "fetch_seconds": round(fetch_seconds, 1),
        "conditions_queried": len(conditions),
        "study_count": len(study_records),
        "site_row_count": len(site_rows),
        "institution_count": len({row["Institution"] for row in site_rows}),
        "csv_path": str(csv_path),
        "website_catalog_path": str(website_catalog_path),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the production-ready GU trial pipeline.")
    parser.add_argument("--output-root", type=Path, help="Optional output root. Defaults to production_ready_pipeline/output.")
    parser.add_argument("--timestamp", help="Explicit run timestamp in YYYY-MM-DD_HHMM format.")
    parser.add_argument("--page-size", type=int, help="Override CT.gov page size for this run.")
    parser.add_argument("--max-conditions", type=int, help="Limit the number of configured search terms for a smoke run.")
    parser.add_argument("--skip-excel", action="store_true", help="Skip cancer-type Excel generation.")
    parser.add_argument("--skip-updates", action="store_true", help="Skip updates workbook generation.")
    parser.add_argument("--website-catalog-out", type=Path, help="Optional website-ready JSON output path.")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    result = run_pipeline(
        output_root=args.output_root,
        timestamp=args.timestamp,
        page_size=args.page_size,
        max_conditions=args.max_conditions,
        skip_excel=args.skip_excel,
        skip_updates=args.skip_updates,
        website_catalog_out=args.website_catalog_out,
    )
    print(
        f"Run {result['run_ts']} complete: {result['study_count']} trials, "
        f"{result['site_row_count']} site rows, output={result['run_output_dir']}, "
        f"website_catalog={result['website_catalog_path']}"
    )


if __name__ == "__main__":
    main()
