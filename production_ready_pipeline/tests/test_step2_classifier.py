#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE.parent))

from production_ready_pipeline.clinical_schema import exact_trial_anchor
from production_ready_pipeline.nccn_classifier import classify_trial


PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
_results: list[tuple[bool, str]] = []


def check(condition: bool, description: str) -> None:
    status = PASS if condition else FAIL
    print(f"  [{status}] {description}")
    _results.append((condition, description))


def test_bladder() -> None:
    print("\n[Step 2 — Bladder]")
    result = classify_trial(
        cancer_type="Bladder/Urothelial",
        title="Pembrolizumab for BCG-Unresponsive Non-Muscle-Invasive Bladder Cancer",
        eligibility_incl="BCG-unresponsive non-muscle-invasive bladder cancer (NMIBC), CIS with or without Ta/T1, adequate BCG treatment",
        conditions="bladder cancer NMIBC",
        brief_summary="Phase II pembrolizumab for BCG-unresponsive NMIBC with CIS",
    )
    check(result.classification_confidence in ("HIGH", "MEDIUM"), f"BCG-unresponsive NMIBC confidence={result.classification_confidence}")
    check("BCG" in result.disease_setting_primary or "NMIBC" in result.disease_setting_primary, f"BCG NMIBC primary={result.disease_setting_primary!r}")
    check(result.bcg_status == "BCG-Unresponsive", f"bcg_status={result.bcg_status!r}")
    check(result.cis_papillary_pattern == "cis_plus_papillary", f"cis_papillary_pattern={result.cis_papillary_pattern!r}")

    result = classify_trial(
        cancer_type="Bladder/Urothelial",
        title="Neoadjuvant Gemcitabine-Cisplatin for Muscle-Invasive Bladder Cancer",
        eligibility_incl="Muscle-invasive bladder cancer cT2-T4a, creatinine clearance >= 60 mL/min, cisplatin-eligible, cystectomy planned",
        conditions="muscle-invasive bladder cancer MIBC urothelial carcinoma",
        brief_summary="Neoadjuvant gemcitabine plus cisplatin for cisplatin-eligible MIBC",
    )
    check(result.classification_confidence in ("HIGH", "MEDIUM"), f"MIBC confidence={result.classification_confidence}")
    check(result.cisplatin_status == "Cisplatin-Eligible", f"cisplatin_status={result.cisplatin_status!r}")

    result = classify_trial(
        cancer_type="Bladder/Urothelial",
        title="Erdafitinib for FGFR3-Altered Metastatic Urothelial Carcinoma",
        eligibility_incl="Metastatic urothelial carcinoma with susceptible FGFR3 mutation or fusion after platinum therapy",
        conditions="metastatic urothelial carcinoma bladder cancer",
        interventions="erdafitinib targeted therapy",
        brief_summary="FGFR3-selected metastatic urothelial trial",
    )
    check(result.fgfr3_status == "susceptible_alteration", f"fgfr3_status={result.fgfr3_status!r}")

    result = classify_trial(
        cancer_type="Bladder/Urothelial",
        title="Trastuzumab Deruxtecan for HER2 IHC 3+ Metastatic Urothelial Carcinoma",
        eligibility_incl="Later-line metastatic urothelial carcinoma with HER2 IHC 3+ disease",
        conditions="metastatic urothelial carcinoma bladder cancer",
        interventions="trastuzumab deruxtecan",
        brief_summary="HER2-directed ADC trial in metastatic urothelial carcinoma",
    )
    check(result.her2_status == "ihc_3_plus", f"her2_status={result.her2_status!r}")

    result = classify_trial(
        cancer_type="Bladder/Urothelial",
        title="Trastuzumab Deruxtecan All-Comer Urothelial Study",
        eligibility_incl="Metastatic urothelial carcinoma; archival tissue requested for exploratory analysis",
        conditions="metastatic urothelial carcinoma",
        interventions="trastuzumab deruxtecan",
    )
    check(result.her2_status == "Not applicable", f"All-comer HER2 intervention remains unrestricted: {result.her2_status!r}")

    result = classify_trial(
        cancer_type="Bladder/Urothelial",
        title="Erdafitinib All-Comer Urothelial Study",
        eligibility_incl="Metastatic urothelial carcinoma without biomarker selection",
        conditions="metastatic urothelial carcinoma",
        interventions="erdafitinib",
    )
    check(result.fgfr3_status == "Not applicable", f"All-comer FGFR intervention remains unrestricted: {result.fgfr3_status!r}")


def test_prostate() -> None:
    print("\n[Step 2 — Prostate]")
    result = classify_trial(
        cancer_type="Prostate",
        title="Darolutamide for Non-Metastatic Castration-Resistant Prostate Cancer",
        eligibility_incl="Non-metastatic castration-resistant prostate cancer (nmCRPC), PSA doubling time <= 10 months, ongoing ADT",
        conditions="prostate cancer nmCRPC",
        brief_summary="Darolutamide versus placebo for nmCRPC with rapid PSA rise",
    )
    check(result.classification_confidence in ("HIGH", "MEDIUM"), f"nmCRPC confidence={result.classification_confidence}")
    check("nmCRPC" in result.disease_setting_primary or "Non-Metastatic" in result.disease_setting_primary, f"nmCRPC primary={result.disease_setting_primary!r}")
    check(result.castration_status == "castration_resistant", f"castration_status={result.castration_status!r}")
    check(result.metastatic_status == "nonmetastatic_crpc", f"metastatic_status={result.metastatic_status!r}")

    result = classify_trial(
        cancer_type="Prostate",
        title="Olaparib for mCRPC with BRCA1/2 Mutation Post-Enzalutamide",
        eligibility_incl="Metastatic castration-resistant prostate cancer, BRCA1 or BRCA2 mutation, prior enzalutamide or abiraterone",
        conditions="metastatic prostate cancer CRPC",
        interventions="olaparib PARP inhibitor",
        brief_summary="Olaparib for mCRPC with HRR mutation after ARPI",
    )
    check(result.castration_status == "castration_resistant", f"castration_status={result.castration_status!r}")
    check(result.metastatic_status == "metastatic", f"metastatic_status={result.metastatic_status!r}")
    check(result.prior_arpi == "yes", f"prior_arpi={result.prior_arpi!r}")
    check(result.biomarker_hrr == "positive", f"biomarker_hrr={result.biomarker_hrr!r}")
    check(result.classification_is_probability is False, "Rule evidence strength is explicitly not probability")
    check(exact_trial_anchor("brief_title", "A TheraPeutic trial") == [], "Ordinary words do not trigger TheraP")
    check(exact_trial_anchor("brief_title", "TheraP randomized trial") == ["TheraP"], "Exact TheraP title anchor is recognized")
    check(exact_trial_anchor("acronym", "ARANOTE") == ["ARANOTE"], "Exact ARANOTE acronym is recognized")
    check(exact_trial_anchor("eligibility_inclusion", "ARASENS") == [], "Named anchors are ignored outside title/acronym fields")


def test_kidney() -> None:
    print("\n[Step 2 — Kidney / RCC]")
    result = classify_trial(
        cancer_type="Kidney/RCC",
        title="Pembrolizumab Adjuvant Therapy Following Nephrectomy for High-Risk RCC",
        eligibility_incl="Clear cell RCC, high-risk features, following nephrectomy, no prior systemic therapy, no evidence of metastatic disease",
        conditions="renal cell carcinoma kidney cancer",
        interventions="pembrolizumab immunotherapy",
        brief_summary="Adjuvant pembrolizumab after nephrectomy for high-risk clear cell RCC",
    )
    check(result.classification_confidence in ("HIGH", "MEDIUM"), f"Adjuvant RCC confidence={result.classification_confidence}")
    check("Adjuvant" in result.disease_setting_primary, f"Adjuvant RCC primary={result.disease_setting_primary!r}")
    check(result.histology == "clear_cell", f"histology={result.histology!r}")
    check(result.nephrectomy_status == "prior_nephrectomy", f"nephrectomy_status={result.nephrectomy_status!r}")
    check(result.prior_io == "no", f"prior_io={result.prior_io!r}")
    check(result.prior_systemic_lines == "0", f"prior_systemic_lines={result.prior_systemic_lines!r}")

    result = classify_trial(
        cancer_type="Kidney/RCC",
        title="Belzutifan in Metastatic Clear-Cell RCC",
        eligibility_incl="Metastatic clear-cell RCC without biomarker selection",
        conditions="metastatic renal cell carcinoma",
        interventions="belzutifan",
    )
    check(result.vhl_status == "unknown", f"Belzutifan intervention does not imply a VHL requirement: {result.vhl_status!r}")

    result = classify_trial(
        cancer_type="Kidney/RCC",
        title="Cabozantinib plus Nivolumab for First-Line Metastatic ccRCC",
        eligibility_incl="Clear cell RCC, advanced or metastatic stage IV, no prior systemic therapy for RCC",
        conditions="advanced clear cell renal cell carcinoma metastatic RCC",
        interventions="cabozantinib nivolumab",
        brief_summary="First-line treatment for metastatic clear cell RCC",
    )
    check("1st Line" in result.disease_setting_primary or "1L" in result.disease_setting_primary or "First" in result.disease_setting_primary, f"1L RCC primary={result.disease_setting_primary!r}")
    check(result.histology == "clear_cell", f"histology={result.histology!r}")
    check(result.prior_io == "no", f"prior_io={result.prior_io!r}")
    check(result.prior_vegf_tki == "no", f"prior_vegf_tki={result.prior_vegf_tki!r}")
    check(result.prior_systemic_lines == "0", f"prior_systemic_lines={result.prior_systemic_lines!r}")


def test_testicular() -> None:
    print("\n[Step 2 — Testicular / GCT]")
    result = classify_trial(
        cancer_type="Testicular/GCT",
        title="Surveillance vs Carboplatin for Stage IA/IB Pure Seminoma",
        eligibility_incl="Stage IA or IB pure seminoma following radical orchiectomy, no prior chemotherapy, no prior radiation",
        conditions="testicular seminoma stage I",
        brief_summary="Randomized trial of active surveillance vs carboplatin in stage IA/IB seminoma post-orchiectomy",
    )
    check("Seminoma" in result.disease_setting_primary and "Stage I" in result.disease_setting_primary, f"Seminoma Stage I primary={result.disease_setting_primary!r}")
    check(result.histology == "pure_seminoma", f"histology={result.histology!r}")
    check(result.clinical_stage == "stage_1a", f"clinical_stage={result.clinical_stage!r}")
    check(result.classification_confidence in ("HIGH", "MEDIUM"), f"confidence={result.classification_confidence}")

    result = classify_trial(
        cancer_type="Testicular/GCT",
        title="First-Line Chemotherapy for Good-Risk Metastatic NSGCT",
        eligibility_incl="Nonseminomatous germ cell tumor, IGCCCG good risk, stage IIC or III, treatment naive",
        conditions="testicular cancer NSGCT germ cell tumor",
        brief_summary="First-line treatment naive IGCCCG good-risk nonseminomatous germ cell tumor",
    )
    check("NSGCT" in result.disease_setting_primary, f"Good-risk NSGCT primary={result.disease_setting_primary!r}")
    check(result.histology == "nsgct", f"histology={result.histology!r}")
    check(result.igcccg_risk == "good", f"igcccg_risk={result.igcccg_risk!r}")
    check(result.prior_chemo_lines == "0", f"prior_chemo_lines={result.prior_chemo_lines!r}")

    result = classify_trial(
        cancer_type="Testicular/GCT",
        title="Pembrolizumab plus BEP for Mediastinal Primary GCT",
        eligibility_incl="Mediastinal primary germ cell tumor, extragonadal GCT, nonseminoma, treatment naive, IGCCCG poor risk",
        conditions="mediastinal germ cell tumor extragonadal GCT",
        brief_summary="Pembrolizumab plus BEP for mediastinal primary extragonadal GCT",
    )
    check("Extragonadal" in result.disease_setting_primary, f"Extragonadal primary={result.disease_setting_primary!r}")
    check(result.primary_site == "mediastinal", f"primary_site={result.primary_site!r}")


def test_edge_cases() -> None:
    print("\n[Step 2 — Edge cases]")
    result = classify_trial(
        cancer_type="Testicular/GCT",
        title="Opioid-Sparing Perioperative Protocol for Radical Orchiectomy",
        eligibility_incl="Undergoing radical orchiectomy for suspected testicular malignancy, no prior chemotherapy",
        conditions="testicular malignancy",
        interventions="PROCEDURE: Radical inguinal orchiectomy",
        brief_summary="Standardized perioperative pain protocol for orchiectomy",
    )
    check(result.classification_confidence == "LOW", f"Perioperative trial confidence={result.classification_confidence}")
    check("unclassified" in result.disease_setting_primary.lower() or "review" in result.disease_setting_primary.lower(), f"Perioperative primary={result.disease_setting_primary!r}")

    result = classify_trial(
        cancer_type="Penile",
        title="Pembrolizumab for Advanced Penile Cancer",
        eligibility_incl="Squamous cell carcinoma of the penis, metastatic",
        conditions="penile cancer",
    )
    check("classifier not yet built" in result.disease_setting_primary, f"Unsupported type={result.disease_setting_primary!r}")
    check(result.classification_confidence == "N/A", f"Unsupported confidence={result.classification_confidence!r}")


if __name__ == "__main__":
    test_bladder()
    test_prostate()
    test_kidney()
    test_testicular()
    test_edge_cases()

    passed = sum(1 for ok, _ in _results if ok)
    total = len(_results)
    print(f"\n{'=' * 50}")
    print(f"Step 2 results: {passed}/{total} checks passed")
    if passed < total:
        print("Failed checks:")
        for ok, description in _results:
            if not ok:
                print(f"  - {description}")
        sys.exit(1)
    print("All Step 2 classifier checks passed.")
