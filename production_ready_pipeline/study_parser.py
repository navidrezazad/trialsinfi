from __future__ import annotations

import re

try:
    from .site_normalization import DEFAULT_NORMALIZER, SiteNormalizer
except ImportError:
    from site_normalization import DEFAULT_NORMALIZER, SiteNormalizer


_CANCER_PATTERNS = [
    ("Prostate", re.compile(r"prostat", re.IGNORECASE)),
    ("Bladder/Urothelial", re.compile(r"bladder|urothelial|upper.tract|transitional.cell", re.IGNORECASE)),
    ("Kidney/RCC", re.compile(r"renal|kidney|nephr|renal.cell|\brcc\b", re.IGNORECASE)),
    ("Adrenal", re.compile(r"adrenal|adrenocortical|pheochromocytoma|paraganglioma", re.IGNORECASE)),
    ("Testicular/GCT", re.compile(r"testicular|testis|germ.cell|seminoma|\bNSGCT\b|\bGCT\b", re.IGNORECASE)),
    ("Penile", re.compile(r"penile|penis", re.IGNORECASE)),
]


def classify_cancer_types(conditions: str, title: str = "") -> list[str]:
    text = (conditions or "").lower()
    matched = [cancer_type for cancer_type, regex in _CANCER_PATTERNS if regex.search(text)]
    if not matched:
        title_lower = (title or "").lower()
        matched = [cancer_type for cancer_type, regex in _CANCER_PATTERNS if regex.search(title_lower)]
    return matched if matched else ["Basket"]


def parse_eligibility(text: str) -> tuple[str, str]:
    if not text:
        return "", ""
    exclusion_match = re.search(r"\bexclusion criteria\s*:?\s*\n", text, re.IGNORECASE)
    if exclusion_match:
        inclusion_raw = text[:exclusion_match.start()].strip()
        exclusion_raw = text[exclusion_match.end():].strip()
    else:
        inclusion_raw = text.strip()
        exclusion_raw = ""
    inclusion_raw = re.sub(r"^\s*inclusion criteria\s*:?\s*\n?", "", inclusion_raw, flags=re.IGNORECASE).strip()
    return inclusion_raw, exclusion_raw


def intervention_string_from_study(study: dict) -> str:
    interventions = (
        study.get("protocolSection", {})
        .get("armsInterventionsModule", {})
        .get("interventions", [])
    )
    return "; ".join(
        f"{intervention.get('type', 'Other')}: {intervention.get('name', '')}"
        for intervention in interventions
        if intervention.get("name")
    )


def extract_classifier_inputs(study: dict) -> dict[str, str]:
    protocol = study.get("protocolSection", {})
    ident = protocol.get("identificationModule", {})
    conds = protocol.get("conditionsModule", {})
    desc = protocol.get("descriptionModule", {})
    elig = protocol.get("eligibilityModule", {})

    raw_eligibility = elig.get("eligibilityCriteria", "")
    inclusion, exclusion = parse_eligibility(raw_eligibility)
    conditions = "; ".join(conds.get("conditions", []))

    return {
        "nct_id": ident.get("nctId", ""),
        "title": ident.get("officialTitle") or ident.get("briefTitle", ""),
        "conditions": conditions,
        "brief_summary": (desc.get("briefSummary") or "").strip(),
        "eligibility_incl": inclusion,
        "eligibility_excl": exclusion,
        "interventions": intervention_string_from_study(study),
    }


def parse_study_extended(
    study: dict,
    normalizer: SiteNormalizer | None = None,
    pulled_by: str = "Production Ready Pipeline",
) -> tuple[dict | None, list[dict]]:
    site_normalizer = normalizer or DEFAULT_NORMALIZER
    protocol = study.get("protocolSection", {})

    ident = protocol.get("identificationModule", {})
    status = protocol.get("statusModule", {})
    design = protocol.get("designModule", {})
    sponsor = protocol.get("sponsorCollaboratorsModule", {})
    description = protocol.get("descriptionModule", {})
    conditions_mod = protocol.get("conditionsModule", {})
    outcomes_mod = protocol.get("outcomesModule", {})
    eligibility = protocol.get("eligibilityModule", {})
    contacts = protocol.get("contactsLocationsModule", {})

    nct_id = ident.get("nctId", "")
    title = ident.get("officialTitle") or ident.get("briefTitle", "")
    secondary_ids = "; ".join(
        identifier.get("id", "")
        for identifier in ident.get("secondaryIdInfos", [])
        if identifier.get("id")
    )

    overall_status = status.get("overallStatus", "")
    start_date = status.get("startDateStruct", {}).get("date", "")
    end_date = status.get("primaryCompletionDateStruct", {}).get("date", "")
    last_update = status.get("lastUpdatePostDateStruct", {}).get("date", "")
    first_post_date = status.get("studyFirstPostDateStruct", {}).get("date", "")

    phase = ", ".join(design.get("phases", []) or ["N/A"])
    design_info = design.get("designInfo", {})
    masking_info = design_info.get("maskingInfo", {})
    masking_detail = design_info.get("masking", "") or masking_info.get("masking", "")
    masked_roles = ", ".join(masking_info.get("whoMasked", []))
    design_str = " | ".join(filter(None, [
        f"Allocation: {design_info.get('allocation', '')}" if design_info.get("allocation") else "",
        f"Model: {design_info.get('interventionModel', '')}" if design_info.get("interventionModel") else "",
        f"Purpose: {design_info.get('primaryPurpose', '')}" if design_info.get("primaryPurpose") else "",
        (f"Masking: {masking_detail}" + (f" ({masked_roles})" if masked_roles else "")) if masking_detail else "",
    ]))

    enrollment = design.get("enrollmentInfo", {})
    enrollment_count = enrollment.get("count", "")
    enrollment_type = enrollment.get("type", "")
    enrollment_estimated = str(enrollment_count) if enrollment_type == "ESTIMATED" else ""
    enrollment_actual = str(enrollment_count) if enrollment_type == "ACTUAL" else ""

    lead_sponsor = sponsor.get("leadSponsor", {}).get("name", "")
    collaborators = sponsor.get("collaborators", [])
    additional_sponsors = "; ".join(
        collaborator.get("name", "")
        for collaborator in collaborators
        if collaborator.get("name")
    )
    responsible_party = sponsor.get("responsibleParty", {})
    responsible_type = responsible_party.get("type", "")
    responsible_name = responsible_party.get("investigatorFullName", "")
    responsible_affiliation = responsible_party.get("investigatorAffiliation", "")
    if responsible_type == "SPONSOR":
        info_provided_by = f"Sponsor ({lead_sponsor})"
    elif responsible_name:
        info_provided_by = responsible_name + (f", {responsible_affiliation}" if responsible_affiliation else "")
    else:
        info_provided_by = responsible_type or lead_sponsor

    brief_summary = (description.get("briefSummary") or "").strip()
    condition_list = conditions_mod.get("conditions", [])
    conditions_full = "; ".join(condition_list)
    intervention_str = intervention_string_from_study(study)

    def format_outcomes(items: list[dict]) -> str:
        lines = []
        for item in items:
            measure = item.get("measure", "").strip()
            time_frame = item.get("timeFrame", "").strip()
            lines.append(f"• {measure}" + (f"  [{time_frame}]" if time_frame else ""))
        return "\n".join(lines)

    primary_outcomes = format_outcomes(outcomes_mod.get("primaryOutcomes", []))
    secondary_outcomes = format_outcomes(outcomes_mod.get("secondaryOutcomes", []))

    inclusion, exclusion = parse_eligibility(eligibility.get("eligibilityCriteria", ""))
    min_age = eligibility.get("minimumAge", "")
    max_age = eligibility.get("maximumAge", "")
    sex = eligibility.get("sex", "")

    cancer_types = classify_cancer_types(conditions_full, title)
    cancer_type_str = " | ".join(cancer_types)

    global_pi, global_pi_affiliation = site_normalizer.extract_pi(study)
    site_rows: list[dict] = []
    for location in contacts.get("locations", []):
        state = location.get("state", "")
        city = location.get("city", "")
        facility = location.get("facility", "")

        if state and state not in ("California", "CA"):
            continue
        if not site_normalizer.is_socal_site(city, facility):
            continue
        institution = site_normalizer.normalize_facility(facility)
        if institution not in site_normalizer.target_institutions:
            continue

        site_pi, site_email, site_phone = site_normalizer.extract_site_contact(location)
        pi_name = site_pi if site_pi else global_pi
        pi_affiliation = facility if site_pi else global_pi_affiliation

        site_rows.append({
            "NCT ID": nct_id,
            "Trial title": title,
            "Phase": phase,
            "Status": location.get("status", "UNKNOWN"),
            "Status source": "registry_location.status",
            "Cancer type": cancer_type_str,
            "Institution": institution,
            "PI name": pi_name,
            "PI email": site_email,
            "PI phone": site_phone,
            "PI affiliation": pi_affiliation,
            "Site city": city,
            "Lead sponsor": lead_sponsor,
        })

    if not site_rows:
        return None, []

    study_record = {
        "NCT ID": nct_id,
        "Study title": title,
        "Other study IDs": secondary_ids,
        "ClinicalTrials URL": f"https://clinicaltrials.gov/study/{nct_id}",
        "Phase": phase,
        "Status": overall_status,
        "Cancer type": cancer_type_str,
        "Conditions": conditions_full,
        "Lead sponsor": lead_sponsor,
        "Additional sponsors": additional_sponsors,
        "Information provided by": info_provided_by,
        "Intervention(s)": intervention_str,
        "Study design": design_str,
        "Enrollment (estimated)": enrollment_estimated,
        "Enrollment (actual)": enrollment_actual,
        "Start date": start_date,
        "Primary completion": end_date,
        "Last update posted": last_update,
        "Study first posted": first_post_date,
        "Last pulled by": pulled_by,
        "Brief summary": brief_summary,
        "Min age": min_age,
        "Max age": max_age,
        "Sex": sex,
        "Inclusion criteria": inclusion,
        "Exclusion criteria": exclusion,
        "_interventions_raw": intervention_str,
        "_inclusion_raw": inclusion,
        "_exclusion_raw": exclusion,
        "Primary outcomes": primary_outcomes,
        "Secondary outcomes": secondary_outcomes,
    }

    return study_record, site_rows
