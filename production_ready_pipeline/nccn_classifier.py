#!/usr/bin/env python3
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

try:
    from .taxonomy_store import default_store
    from .clinical_schema import exact_trial_anchor
except ImportError:
    from taxonomy_store import default_store
    from clinical_schema import exact_trial_anchor


_BLADDER_TAX = default_store.get_for_cancer_type("Bladder/Urothelial")
_PROSTATE_TAX = default_store.get_for_cancer_type("Prostate")
_KIDNEY_TAX = default_store.get_for_cancer_type("Kidney/RCC")
_TESTICULAR_TAX = default_store.get_for_cancer_type("Testicular/GCT")


@dataclass
class TrialClassification:
    disease_settings: list[str] = field(default_factory=list)
    disease_setting_ids: list[str] = field(default_factory=list)
    disease_setting_primary: str = "Unclassified"
    disease_setting_primary_id: str = ""
    disease_setting_all: str = ""
    classification_confidence: str = "UNCLASSIFIED"
    classification_evidence_strength: str = "UNCLASSIFIED"
    classification_is_probability: bool = False
    classification_method: str = "deterministic_taxonomy_rules"
    classification_field_evidence: list[dict] = field(default_factory=list)
    classification_evidence: list[str] = field(default_factory=list)
    bcg_status: str = "Not applicable"
    cisplatin_status: str = "Not specified"
    cis_papillary_pattern: str = "Not applicable"
    castration_status: str = "Not applicable"
    metastatic_status: str = "Not applicable"
    disease_volume: str = "Not applicable"
    prior_arpi: str = "Not applicable"
    prior_docetaxel: str = "Not applicable"
    fgfr3_status: str = "Not applicable"
    her2_status: str = "Not applicable"
    biomarker_hrr: str = "Not applicable"
    psma_status: str = "Not applicable"
    genomic_classifier: str = "Not applicable"
    histology: str = "Not applicable"
    imdc_risk: str = "Not applicable"
    prior_systemic_lines: str = "Not applicable"
    prior_io: str = "Not applicable"
    prior_vegf_tki: str = "Not applicable"
    nephrectomy_status: str = "Not applicable"
    vhl_status: str = "Not applicable"
    met_alteration: str = "Not applicable"
    sarcomatoid: str = "Not applicable"
    clinical_stage: str = "Not applicable"
    igcccg_risk: str = "Not applicable"
    primary_site: str = "Not applicable"
    prior_chemo_lines: str = "Not applicable"
    prior_hdct: str = "Not applicable"
    rplnd_status: str = "Not applicable"
    marker_status: str = "Not applicable"
    stage1_risk_factors: str = "Not applicable"
    treatment_modalities: list[str] = field(default_factory=list)
    treatment_modality_str: str = ""
    is_combination: bool = False
    delivery: str = "UNCLASSIFIED"
    nccn_version: str = ""
    nccn_date: str = ""


def _make_text_blob(*parts: Optional[str]) -> str:
    return " ".join(part for part in parts if part).lower()


def _matches_any(text: str, patterns: list[str]) -> tuple[bool, list[str]]:
    hits = [pattern for pattern in patterns if re.search(pattern, text, re.IGNORECASE)]
    return bool(hits), hits


def _confidence_from_hits(hits: list[str], base: str) -> str:
    if not hits:
        return "UNCLASSIFIED"
    if len(hits) >= 3:
        return "HIGH"
    if len(hits) == 2:
        return "HIGH" if base == "HIGH" else "MEDIUM"
    return base


def _pattern_matches_section(pattern: str, field_name: str, text: str) -> bool:
    for name in ("TheraP", "ARANOTE", "ARASENS"):
        if name.lower() in pattern.lower():
            return name in exact_trial_anchor(field_name, text)
    return bool(re.search(pattern, text, re.IGNORECASE))


def _classify_categories(taxonomy: dict, sections: dict[str, str] | str) -> tuple[list[dict], list[str], list[dict]]:
    section_map = sections if isinstance(sections, dict) else {"combined_legacy": sections}
    matched_categories = []
    evidence: list[str] = []
    field_evidence: list[dict] = []
    for category in taxonomy.get("categories", []):
        excluded = any(
            _pattern_matches_section(pattern, field_name, text)
            for field_name, text in section_map.items()
            for pattern in category.get("exclude_patterns", [])
        )
        if excluded:
            continue
        hits: list[str] = []
        matched_fields: list[str] = []
        for field_name, text in section_map.items():
            for pattern in category.get("include_patterns", []):
                if _pattern_matches_section(pattern, field_name, text):
                    hits.append(pattern)
                    matched_fields.append(field_name)
                    field_evidence.append({
                        "categoryId": category.get("id", ""),
                        "field": field_name,
                        "pattern": pattern,
                        "provenanceClass": "deterministic_rule",
                    })
        if hits:
            confidence = _confidence_from_hits(hits, category.get("confidence_base", "MEDIUM"))
            matched_categories.append({**category, "_confidence": confidence, "_hits": hits, "_fields": sorted(set(matched_fields))})
            evidence.extend(hits[:3])
    return matched_categories, list(dict.fromkeys(evidence)), field_evidence


def _classify_axis(taxonomy: dict, text: str, axis_id: str, default: str = "unknown") -> str:
    axis = taxonomy.get("clinical_axes", {}).get(axis_id, {})
    for value, patterns in axis.get("detection_rules", {}).items():
        if _matches_any(text, patterns)[0]:
            return value
    return default


def _classify_bcg_status(text: str) -> str:
    for status, patterns in _BLADDER_TAX.get("bcg_status_rules", {}).items():
        if _matches_any(text, patterns)[0]:
            return status
    return "Not applicable"


def _classify_cisplatin_status(text: str) -> str:
    for status, patterns in _BLADDER_TAX.get("cisplatin_status_rules", {}).items():
        if _matches_any(text, patterns)[0]:
            return status
    return "Not specified"


def _classify_cis_papillary_pattern(text: str) -> str:
    has_cis = bool(re.search(r"carcinoma.in.situ|\bCIS\b", text, re.I))
    has_papillary = bool(re.search(r"papillary|high.grade.*Ta|high.grade.*T1|Ta/T1", text, re.I))
    if has_cis and has_papillary:
        return "cis_plus_papillary"
    if has_cis:
        return "cis_only"
    if has_papillary:
        return "papillary_only"
    return "Not applicable"


def _classify_fgfr3_status(text: str) -> str:
    if re.search(r"FGFR3.*(wild.type|negative|not detected)|no FGFR3 alteration", text, re.I):
        return "wild_type"
    if re.search(r"FGFR3.*(alter|mutat|fusion|susceptible)", text, re.I):
        return "susceptible_alteration"
    return "Not applicable"


def _classify_her2_status(text: str) -> str:
    if re.search(r"HER2.*(IHC\s*)?3\+|ERBB2.*(3\+|high|positive)", text, re.I):
        return "ihc_3_plus"
    if re.search(r"HER2.*(IHC\s*)?2\+|ERBB2.*2\+", text, re.I):
        return "ihc_2_plus"
    if re.search(r"HER2.*equivocal|ERBB2.*equivocal", text, re.I):
        return "equivocal"
    if re.search(r"HER2.*(0|1\+|negative|low)|ERBB2.*(negative|low)", text, re.I):
        return "negative_or_low"
    return "Not applicable"


_SYSTEMIC_MODALITIES = {"IMMUNOTHERAPY", "TARGETED", "CHEMOTHERAPY", "ADC"}
_LOCAL_MODALITIES = {"RADIATION", "SURGERY"}
_INTRAVESICAL_MODALITIES = {"INTRAVESICAL"}
_DIAGNOSTIC_MODALITIES = {"IMAGING_DIAGNOSTIC"}

_GENERIC_MODALITY_RULES = {
    "HORMONAL": [
        "ADT", "LHRH", "enzalutamide", "abiraterone", "apalutamide", "darolutamide",
        "leuprolide", "degarelix", "bilateral.orchiectomy", "androgen.deprivation",
        "ARPI", "antiandrogen", "bicalutamide", "flutamide",
    ],
    "IMMUNOTHERAPY": [
        "pembrolizumab", "nivolumab", "ipilimumab", "atezolizumab", "durvalumab",
        "avelumab", "checkpoint.inhibitor", "PD.1", "PD.L1", "anti.PD", "CAR.T",
        "sipuleucel", "immunotherapy", "cemiplimab",
    ],
    "TARGETED": [
        "olaparib", "rucaparib", "niraparib", "talazoparib", "PARP", "FGFR", "HER2",
        "AKT", "mTOR", "PI3K", "cabozantinib", "lenvatinib", "sunitinib", "pazopanib",
        "everolimus", "erdafitinib", "targeted.therapy", "axitinib", "tivozanib",
        "sorafenib", "temsirolimus", "bevacizumab", "belzutifan", "HIF.2", "HIF2",
        "VHL.inhibitor", "savolitinib", "crizotinib", "VEGF.TKI", "VEGFR.inhibitor",
        "anti.VEGF", "mTOR.inhibitor",
    ],
    "RADIOLIGAND": [
        "Lu.177", "PSMA.617", "lutetium", "Ra.223", "radium", "actinium",
        "theranostic", "radioligand", "radiopharmaceutical",
    ],
    "ADC": [
        "enfortumab", "sacituzumab", "disitamab", "trastuzumab.deruxtecan",
        "antibody.drug.conjugate", r"\bADC\b",
    ],
    "CHEMOTHERAPY": [
        "docetaxel", "cabazitaxel", "cisplatin", "carboplatin", "gemcitabine",
        "paclitaxel", "MVAC", "ddMVAC", "chemotherapy", "cytotoxic", "bleomycin",
        "etoposide", "ifosfamide", "vinblastine", "oxaliplatin", r"\bBEP\b",
        r"\bEP\b", r"\bTIP\b", r"\bVeIP\b", r"\bVIP\b", r"\bGemOx\b", "TI-CE",
        "high.dose.*chemo", r"\bHDCT\b", "stem.cell",
    ],
    "RADIATION": [
        "EBRT", "radiation", "radiotherapy", "IMRT", "SBRT", "brachytherapy",
        "stereotactic", "proton", "external.beam",
    ],
    "SURGERY": [
        "radical.prostatectomy", "RARP", "robotic", "cystectomy", "nephrectomy",
        "ureterectomy", "TURBT", "surgical", r"\bRPLND\b",
        "retroperitoneal.lymph.node.dissection", "orchiectomy",
    ],
    "IMAGING_DIAGNOSTIC": [
        "PSMA.PET", "PET.CT", "PET.MRI", "FDG.PET", "diagnostic", "imaging",
        "detection", "biomarker", "liquid.biopsy", "ctDNA", "cfDNA",
    ],
}


def _classify_treatment_modality(text: str, cancer_type: str) -> tuple[list[str], bool, str]:
    rules = (
        _BLADDER_TAX.get("treatment_modality_rules", {})
        if cancer_type == "Bladder/Urothelial" and _BLADDER_TAX
        else _GENERIC_MODALITY_RULES
    )
    matched = [name for name, patterns in rules.items() if _matches_any(text, patterns)[0]]
    is_combination = len(matched) > 1

    has_systemic = bool(set(matched) & _SYSTEMIC_MODALITIES)
    has_local = bool(set(matched) & _LOCAL_MODALITIES)
    has_intravesical = bool(set(matched) & _INTRAVESICAL_MODALITIES)
    has_diagnostic = bool(set(matched) & _DIAGNOSTIC_MODALITIES)

    if has_intravesical and not has_systemic and not has_local:
        delivery = "INTRAVESICAL"
    elif has_diagnostic and not has_systemic and not has_local and not has_intravesical:
        delivery = "DIAGNOSTIC"
    elif has_systemic and has_local:
        delivery = "MIXED"
    elif has_systemic or has_intravesical:
        delivery = "SYSTEMIC"
    elif has_local:
        delivery = "LOCAL"
    elif has_diagnostic:
        delivery = "DIAGNOSTIC"
    else:
        delivery = "UNCLASSIFIED"

    return matched, is_combination, delivery


def _resolve_categories(
    matched_categories: list[dict],
    evidence: list[str],
    result: TrialClassification,
    field_evidence: list[dict] | None = None,
) -> None:
    confidence_rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    matched_categories.sort(
        key=lambda category: (category.get("order", 99), confidence_rank.get(category["_confidence"], 3))
    )
    result.disease_setting_ids = [
        str(category.get("id", "")).strip()
        for category in matched_categories
        if str(category.get("id", "")).strip()
    ]
    result.disease_settings = [category["label"] for category in matched_categories]
    result.disease_setting_primary_id = result.disease_setting_ids[0] if result.disease_setting_ids else ""
    result.disease_setting_primary = matched_categories[0]["label"]
    result.disease_setting_all = " | ".join(result.disease_settings)
    confidences = [category["_confidence"] for category in matched_categories]
    result.classification_confidence = (
        "HIGH" if "HIGH" in confidences else "MEDIUM" if "MEDIUM" in confidences else "LOW"
    )
    result.classification_evidence_strength = result.classification_confidence
    result.classification_is_probability = False
    result.classification_evidence = evidence[:5]
    result.classification_field_evidence = (field_evidence or [])[:20]


def classify_trial(
    cancer_type: str,
    title: str = "",
    eligibility_incl: str = "",
    eligibility_excl: str = "",
    conditions: str = "",
    interventions: str = "",
    brief_summary: str = "",
) -> TrialClassification:
    result = TrialClassification()
    disease_sections = {
        "brief_title": title or "",
        "eligibility_inclusion": eligibility_incl or "",
        "conditions": conditions or "",
        "brief_summary": brief_summary or "",
    }
    disease_text = _make_text_blob(title, eligibility_incl, conditions, brief_summary)
    modality_text = _make_text_blob(title, interventions, brief_summary, eligibility_excl)

    if cancer_type == "Bladder/Urothelial":
        matched_categories, evidence, field_evidence = _classify_categories(_BLADDER_TAX, disease_sections)
        if matched_categories:
            _resolve_categories(matched_categories, evidence, result, field_evidence)
        else:
            result.disease_setting_primary = (
                "Bladder/Urothelial — unclassified (review)"
                if re.search(r"bladder|urothelial|upper.tract|renal.pelvis|ureter", disease_text, re.I)
                else "Bladder/Urothelial — insufficient data"
            )
            result.classification_confidence = "LOW"
            result.disease_setting_all = result.disease_setting_primary
        result.nccn_version = _BLADDER_TAX.get("nccn_version", "")
        result.nccn_date = _BLADDER_TAX.get("nccn_date", "")
        result.bcg_status = _classify_bcg_status(disease_text)
        result.cisplatin_status = _classify_cisplatin_status(disease_text)
        result.cis_papillary_pattern = _classify_cis_papillary_pattern(disease_text)
        # Eligibility requirements come from eligibility/condition text, never from
        # the intervention name alone. Interventions remain retrieval signals only.
        result.fgfr3_status = _classify_fgfr3_status(disease_text)
        result.her2_status = _classify_her2_status(disease_text)

    elif cancer_type == "Prostate":
        matched_categories, evidence, field_evidence = _classify_categories(_PROSTATE_TAX, disease_sections)
        if matched_categories:
            _resolve_categories(matched_categories, evidence, result, field_evidence)
        else:
            result.disease_setting_primary = (
                "Prostate — unclassified (review)"
                if re.search(r"prostate", disease_text, re.I)
                else "Prostate — insufficient data"
            )
            result.classification_confidence = "LOW"
            result.disease_setting_all = result.disease_setting_primary
        result.nccn_version = _PROSTATE_TAX.get("nccn_version", "")
        result.nccn_date = _PROSTATE_TAX.get("nccn_date", "")
        result.castration_status = _classify_axis(_PROSTATE_TAX, disease_text, "castration_status")
        result.metastatic_status = _classify_axis(_PROSTATE_TAX, disease_text, "metastatic_status")
        result.disease_volume = _classify_axis(_PROSTATE_TAX, disease_text, "disease_volume")
        result.prior_arpi = _classify_axis(_PROSTATE_TAX, disease_text, "prior_arpi")
        result.prior_docetaxel = _classify_axis(_PROSTATE_TAX, disease_text, "prior_docetaxel")
        result.biomarker_hrr = _classify_axis(_PROSTATE_TAX, disease_text, "biomarker_hrr")
        result.psma_status = _classify_axis(_PROSTATE_TAX, disease_text, "psma_status")
        result.genomic_classifier = _classify_axis(_PROSTATE_TAX, disease_text, "genomic_classifier")

    elif cancer_type == "Kidney/RCC":
        matched_categories, evidence, field_evidence = _classify_categories(_KIDNEY_TAX, disease_sections)
        if matched_categories:
            _resolve_categories(matched_categories, evidence, result, field_evidence)
        else:
            result.disease_setting_primary = (
                "Kidney/RCC — unclassified (review)"
                if re.search(r"kidney|renal|RCC|renal.cell", disease_text, re.I)
                else "Kidney/RCC — insufficient data"
            )
            result.classification_confidence = "LOW"
            result.disease_setting_all = result.disease_setting_primary
        result.nccn_version = _KIDNEY_TAX.get("nccn_version", "")
        result.nccn_date = _KIDNEY_TAX.get("nccn_date", "")
        result.histology = _classify_axis(_KIDNEY_TAX, disease_text, "histology")
        result.imdc_risk = _classify_axis(_KIDNEY_TAX, disease_text, "imdc_risk")
        result.prior_systemic_lines = _classify_axis(_KIDNEY_TAX, disease_text, "prior_systemic_lines")
        result.prior_io = _classify_axis(_KIDNEY_TAX, disease_text, "prior_io")
        result.prior_vegf_tki = _classify_axis(_KIDNEY_TAX, disease_text, "prior_vegf_tki")
        result.nephrectomy_status = _classify_axis(_KIDNEY_TAX, disease_text, "nephrectomy_status")
        result.vhl_status = _classify_axis(_KIDNEY_TAX, disease_text, "vhl_status")
        result.met_alteration = _classify_axis(_KIDNEY_TAX, disease_text, "met_alteration")
        result.sarcomatoid = _classify_axis(_KIDNEY_TAX, disease_text, "sarcomatoid")

    elif cancer_type == "Testicular/GCT":
        matched_categories, evidence, field_evidence = _classify_categories(_TESTICULAR_TAX, disease_sections)
        if matched_categories:
            _resolve_categories(matched_categories, evidence, result, field_evidence)
        else:
            result.disease_setting_primary = (
                "Testicular/GCT — unclassified (review)"
                if re.search(r"testicular|testis|germ.cell|seminoma|NSGCT|GCT", disease_text, re.I)
                else "Testicular/GCT — insufficient data"
            )
            result.classification_confidence = "LOW"
            result.disease_setting_all = result.disease_setting_primary
        result.nccn_version = _TESTICULAR_TAX.get("nccn_version", "")
        result.nccn_date = _TESTICULAR_TAX.get("nccn_date", "")
        result.histology = _classify_axis(_TESTICULAR_TAX, disease_text, "histology")
        result.clinical_stage = _classify_axis(_TESTICULAR_TAX, disease_text, "clinical_stage")
        result.igcccg_risk = _classify_axis(_TESTICULAR_TAX, disease_text, "igcccg_risk")
        result.primary_site = _classify_axis(_TESTICULAR_TAX, disease_text, "primary_site")
        result.prior_chemo_lines = _classify_axis(_TESTICULAR_TAX, disease_text, "prior_chemo_lines")
        result.prior_hdct = _classify_axis(_TESTICULAR_TAX, disease_text, "prior_hdct")
        result.rplnd_status = _classify_axis(_TESTICULAR_TAX, disease_text, "rplnd_status")
        result.marker_status = _classify_axis(_TESTICULAR_TAX, disease_text, "marker_status")
        result.stage1_risk_factors = _classify_axis(_TESTICULAR_TAX, disease_text, "stage1_risk_factors")

    else:
        result.disease_setting_primary = f"{cancer_type} — classifier not yet built"
        result.disease_setting_all = result.disease_setting_primary
        result.classification_confidence = "N/A"
        result.nccn_version = "pending"
        result.nccn_date = "pending"

    modalities, is_combination, delivery = _classify_treatment_modality(modality_text, cancer_type)
    result.treatment_modalities = modalities
    result.treatment_modality_str = " · ".join(modalities) if modalities else "Unclassified"
    result.is_combination = is_combination
    result.delivery = delivery
    if result.classification_evidence_strength == "UNCLASSIFIED":
        result.classification_evidence_strength = result.classification_confidence
    return result


def get_disease_settings_in_order(cancer_type: str) -> list[dict]:
    return default_store.get_disease_settings_in_order(cancer_type)


def get_section_colors(cancer_type: str) -> dict[str, str]:
    return default_store.get_section_colors(cancer_type)


def get_nccn_stamp(cancer_type: str) -> str:
    return default_store.get_nccn_stamp(cancer_type)


def list_loaded_taxonomies() -> list[str]:
    return default_store.list_loaded_taxonomies()
