(function (global) {
  "use strict";

  let parserApi = global.PatientQueryParser;
  if (!parserApi && typeof require === "function") {
    try {
      parserApi = require("./patient-query-parser.js");
    } catch (error) {
      parserApi = null;
    }
  }

  let schemaApi = global.ClinicalTrialSchema;
  if (!schemaApi && typeof require === "function") {
    try {
      schemaApi = require("./clinical-trial-schema.js");
    } catch (error) {
      schemaApi = null;
    }
  }

  const CONFIDENCE_SCORES = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    UNCLASSIFIED: 0
  };

  const FLAG_DEFINITIONS = {
    brca_hrr: {
      title: "BRCA/HRR status not confirmed",
      message: "Order germline and somatic HRR testing before referring to PARP inhibitor trials. Most labs return in 2-3 weeks."
    },
    brca2_specificity_needed: {
      title: "Confirm BRCA/HRR gene specificity",
      message: "Clarify the exact HRR gene alteration. BRCA2-specific trials should not be treated the same as ATM, CDK12, PALB2, or unspecified HRR alterations."
    },
    psma_status: {
      title: "PSMA-PET required",
      message: "Confirm PSMA imaging has been performed and is positive before referring to radioligand trials."
    },
    psma_pet_pattern_needed: {
      title: "Confirm PSMA-PET pattern",
      message: "For PSMA-targeted trials, verify PSMA positivity, scan recency, and whether there are dominant PSMA-negative or discordant lesions."
    },
    disease_volume: {
      title: "Confirm disease volume",
      message: "Review imaging for bone lesion count and visceral disease. High-volume usually means 4 or more bone metastases or any visceral metastasis."
    },
    prostate_variant_histology: {
      title: "Confirm prostate histology",
      message: "Small-cell, neuroendocrine, or aggressive-variant prostate cancer may require different trials than adenocarcinoma-only protocols."
    },
    taxane_setting_needed: {
      title: "Confirm taxane exposure setting",
      message: "Clarify whether docetaxel was given in the hormone-sensitive setting, castration-resistant setting, or both."
    },
    prior_arpi: {
      title: "Confirm ARPI history",
      message: "Confirm whether the patient has received enzalutamide, abiraterone, apalutamide, or darolutamide."
    },
    chemotherapy_history: {
      title: "Confirm chemotherapy history",
      message: "Confirm prior docetaxel exposure. Some trials require chemo-naive disease; others require prior docetaxel."
    },
    genomic_classifier: {
      title: "Genomic classifier result needed",
      message: "Confirm a genomic risk classifier result exists, such as Decipher, Oncotype GPS, Prolaris, Artera AI, or equivalent."
    },
    castration_status: {
      title: "Confirm castration status",
      message: "Confirm whether the patient is castration-sensitive or castration-resistant before referral."
    },
    staging: {
      title: "Confirm staging",
      message: "Confirm whether the patient has distant metastatic disease on current imaging."
    },
    adt_history: {
      title: "Confirm ADT history",
      message: "Most mCSPC intensification studies require ADT-naive disease or tightly limit prior ADT exposure."
    },
    bcg_status: {
      title: "Confirm BCG history",
      message: "Confirm whether the patient is BCG-unresponsive, BCG-intolerant, or BCG-naive before referring to NMIBC trials."
    },
    bcg_adequacy_timing_needed: {
      title: "Confirm BCG adequacy and timing",
      message: "Vague BCG failure is not enough. Confirm adequate BCG exposure, recurrence/persistence timing, and whether the disease meets BCG-unresponsive criteria."
    },
    cis_papillary_pattern: {
      title: "Confirm CIS / papillary pattern",
      message: "Confirm whether the bladder cancer is CIS-only, papillary-only, or mixed CIS plus papillary disease."
    },
    cisplatin_eligibility: {
      title: "Confirm cisplatin eligibility",
      message: "Confirm renal function, hearing, neuropathy, and performance status to determine cisplatin eligibility."
    },
    fgfr3_status: {
      title: "Confirm FGFR3 alteration status",
      message: "Confirm whether a susceptible FGFR3 alteration is present before referring to FGFR3-directed urothelial trials."
    },
    fgfr3_specificity_needed: {
      title: "Confirm FGFR3 specificity",
      message: "Clarify whether the FGFR alteration is FGFR3-specific. FGFR2 or unspecified FGFR alterations should not be treated as equivalent for FGFR3-directed trials."
    },
    her2_status: {
      title: "Confirm HER2 status",
      message: "Confirm HER2 IHC status before referring to HER2-directed urothelial trials."
    },
    ecog_status: {
      title: "Confirm ECOG performance status",
      message: "Verify before referral: ECOG performance status."
    },
    lab_organ_function: {
      title: "Confirm key laboratory and organ function criteria",
      message: "Verify before referral: current renal, hepatic, and hematologic function."
    },
    washout_window: {
      title: "Verify washout interval",
      message: "Recent systemic therapy may require a protocol-specific washout interval before referral."
    },
    therapy_sequence: {
      title: "Confirm prior therapy sequence",
      message: "Clarify which exact therapies the patient received, progressed on, or must be excluded from before referral."
    },
    recent_imaging: {
      title: "Verify imaging recency",
      message: "Confirm required staging or biomarker imaging was performed recently enough for trial screening."
    },
    post_surgery_timing: {
      title: "Verify post-surgery timing",
      message: "Recent surgery may affect perioperative or recovery-based eligibility windows."
    },
    persistent_markers: {
      title: "Persistent markers after orchiectomy",
      message: "Clarify the timing and persistence of AFP, beta-hCG, or LDH after orchiectomy before referral."
    },
    systemic_line: {
      title: "Confirm prior systemic therapy line",
      message: "Clarify whether the patient is treatment-naive, post-platinum, or more heavily pretreated before referral."
    },
    platinum_response_needed: {
      title: "Confirm platinum response",
      message: "For maintenance urothelial trials, clarify whether disease was stable/responding or progressed after first-line platinum."
    },
    histology: {
      title: "Confirm histology",
      message: "Confirm the relevant histologic subtype, because several kidney and testicular trials are histology-restricted."
    },
    imdc_risk: {
      title: "Confirm IMDC risk group",
      message: "Assign IMDC risk before referral to risk-stratified metastatic RCC trials."
    },
    io_history: {
      title: "Confirm prior immunotherapy exposure",
      message: "Clarify whether the patient has previously received PD-1, PD-L1, or CTLA-4 therapy."
    },
    vegf_tki_history: {
      title: "Confirm prior VEGF-TKI exposure",
      message: "Clarify whether the patient has previously received VEGF-targeted TKI therapy."
    },
    pd1_vegf_sequence_needed: {
      title: "Confirm PD-1/PD-L1 and VEGF-TKI sequence",
      message: "Later-line RCC trials may require both prior checkpoint inhibitor and prior VEGF-TKI exposure."
    },
    nephrectomy_status: {
      title: "Confirm nephrectomy status",
      message: "Clarify whether the patient has had prior nephrectomy, still has the primary tumor in place, or is not a surgical candidate."
    },
    vhl_status: {
      title: "Confirm VHL status",
      message: "Confirm hereditary or tumor VHL status before referring to VHL-directed or hereditary RCC trials."
    },
    met_alteration: {
      title: "Confirm MET alteration",
      message: "Confirm the presence of a MET mutation or amplification before referring to MET-directed RCC trials."
    },
    sarcomatoid: {
      title: "Confirm sarcomatoid features",
      message: "Clarify whether sarcomatoid features are present, because some RCC studies are enriched for this subgroup."
    },
    clinical_stage: {
      title: "Confirm clinical stage",
      message: "Clarify whether the patient has stage I, stage II, or advanced/metastatic disease before referral."
    },
    igcccg_risk: {
      title: "Confirm IGCCCG risk group",
      message: "Assign IGCCCG risk before referring to advanced germ-cell tumor trials."
    },
    primary_site: {
      title: "Confirm primary site",
      message: "Clarify whether the primary site is testicular or extragonadal, such as mediastinal or intracranial."
    },
    chemo_lines: {
      title: "Confirm prior chemotherapy lines",
      message: "Clarify whether the patient is first-line, salvage, or more heavily pretreated before referral."
    },
    hdct_history: {
      title: "Confirm high-dose chemotherapy history",
      message: "Clarify whether the patient has already received high-dose chemotherapy with stem-cell rescue."
    },
    marker_status: {
      title: "Confirm tumor marker status",
      message: "Clarify whether AFP, beta-hCG, and LDH are normal, rising, or persistently elevated."
    },
    gct_residual_mass_size_needed: {
      title: "Confirm residual mass size",
      message: "Post-chemotherapy GCT management depends on residual mass size and histology."
    },
    gct_marker_trend_needed: {
      title: "Confirm tumor marker trend",
      message: "Clarify whether markers are normal, normalizing, persistently elevated, or rising before referral."
    },
    gct_salvage_line_needed: {
      title: "Confirm salvage line",
      message: "Clarify whether this is first salvage, later salvage, or relapse after high-dose chemotherapy with stem-cell rescue."
    },
    stage1_risk_factors: {
      title: "Confirm stage I risk factors",
      message: "Clarify whether stage I risk factors such as lymphovascular invasion are present."
    },
    trial_data_incomplete: {
      title: "Trial structure requires manual review",
      message: "Cohort boundaries or critical criteria are missing, ambiguous, stale, or not clinician-reviewed. Review the current protocol before referral."
    },
    disease_setting_review: {
      title: "Confirm trial disease setting",
      message: "The trial-side disease-setting annotation is missing or conflicts with the patient context. The trial remains visible for manual review."
    },
    patient_fact_confirmation: {
      title: "Confirm extracted patient facts",
      message: "One or more extracted patient facts have not been confirmed by the physician."
    },
    phase_preference: {
      title: "Phase preference differs",
      message: "The study phase differs from the stated preference. Phase is a preference, not an eligibility exclusion."
    }
  };

  function normalizeWhitespace(value) {
    return (value || "").toString().replace(/\s+/g, " ").trim();
  }

  function normalizeList(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map(item => normalizeWhitespace(item))
      .filter(Boolean);
  }

  function normalizeMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const normalized = {};
    Object.entries(value).forEach(([key, mapValue]) => {
      const normalizedKey = normalizeWhitespace(key);
      if (!normalizedKey) {
        return;
      }

      if (mapValue && typeof mapValue === "object" && !Array.isArray(mapValue)) {
        const nested = {};
        Object.entries(mapValue).forEach(([nestedKey, nestedValue]) => {
          const normalizedNestedKey = normalizeWhitespace(nestedKey);
          const normalizedNestedValue = normalizeWhitespace(nestedValue);
          if (normalizedNestedKey && normalizedNestedValue) {
            nested[normalizedNestedKey] = normalizedNestedValue;
          }
        });
        if (Object.keys(nested).length > 0) {
          normalized[normalizedKey] = nested;
        }
        return;
      }

      const normalizedValue = normalizeWhitespace(mapValue);
      if (normalizedValue) {
        normalized[normalizedKey] = normalizedValue;
      }
    });

    return normalized;
  }

  function canonicalToken(value) {
    return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function isMeaningfulAxisValue(value) {
    const token = canonicalToken(value);
    return Boolean(token) && ![
      "unknown",
      "not_applicable",
      "not_specified",
      "not_required",
      "bcg_relevant_unspecified",
      "cisplatin_relevant_unspecified"
    ].includes(token);
  }

  function deriveLegacyDiseaseSettingIds(trial) {
    const primaryLabel = normalizeWhitespace(trial.diseaseSettingPrimary);
    const fallbackLabels = normalizeList(trial.diseaseSettingAll);
    const haystack = [trial.cancerType, primaryLabel, fallbackLabels.join(" ")].join(" ").toLowerCase();
    const ids = [];

    if (!haystack) {
      return ids;
    }

    if (/prostate/.test(haystack)) {
      if (/crpc/.test(haystack)) {
        if (/non[- ]metastatic|nmcrpc/.test(haystack)) {
          ids.push("crpc_nonmetastatic", "crpc_general");
        } else if (/metastatic/.test(haystack)) {
          if (/post[- ]arpi|2l\+/.test(haystack)) {
            ids.push("crpc_metastatic_postarpi", "crpc_general");
          } else {
            ids.push("crpc_metastatic_prearpi", "crpc_metastatic_postarpi", "crpc_general");
          }
        } else {
          ids.push("crpc_general");
        }
      }
      if (/mcspc|hormone[- ]sensitive/.test(haystack)) {
        ids.push("cspc_high_volume", "cspc_oligometastatic", "cspc_general");
      }
      if (/biochemical recurrence|\bbcr\b/.test(haystack)) {
        ids.push("bcr_general");
      }
      if (/localized/.test(haystack)) {
        ids.push("localized_general");
      }
    }

    if (/bladder|urothelial/.test(haystack)) {
      if (/bcg/.test(haystack) || /nmibc/.test(haystack)) {
        ids.push("nmibc_bcg_unresponsive", "nmibc_high_risk_bcg_naive", "nmibc_intermediate_risk", "nmibc_general");
      }
      if (/mibc|muscle[- ]invasive/.test(haystack)) {
        ids.push("mibc_neoadjuvant", "mibc_adjuvant", "mibc_bladder_preservation", "mibc_general");
      }
      if (/metastatic|advanced/.test(haystack)) {
        ids.push("metastatic_2l_plus", "metastatic_1l_general", "metastatic_general");
      }
    }

    if (/kidney|renal|rcc/.test(haystack)) {
      if (/adjuvant/.test(haystack)) ids.push("adjuvant_post_nephrectomy");
      if (/localized/.test(haystack)) ids.push("localized_t1a", "localized_t1b", "localized_stage2_3");
      if (/metastatic/.test(haystack)) ids.push("metastatic_ccrcc_general", "metastatic_ncrcc_general");
      if (/hereditary/.test(haystack)) ids.push("hereditary_rcc");
    }

    if (/testicular|seminoma|gct|nsgct/.test(haystack)) {
      if (/stage i/.test(haystack)) ids.push("gct_stage1_general");
      if (/recurrent|salvage|relapsed|advanced|metastatic/.test(haystack)) ids.push("gct_advanced_general");
      if (/seminoma/.test(haystack)) ids.push("seminoma_stage1", "seminoma_stage2c_3");
      if (/nsgct|nonseminoma/.test(haystack)) ids.push("nsgct_stage1", "nsgct_good_risk_advanced", "nsgct_recurrent_2l");
      if (/extragonadal|mediastinal/.test(haystack)) ids.push("extragonadal_gct");
    }

    return Array.from(new Set(ids));
  }

  function uniqueSources(trial) {
    const tags = normalizeMap(trial.sourceTags);
    const flat = new Set();

    Object.values(tags).forEach(value => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.values(value).forEach(nestedValue => {
          if (nestedValue) {
            flat.add(nestedValue);
          }
        });
        return;
      }
      if (value) {
        flat.add(value);
      }
    });

    return Array.from(flat);
  }

  function buildTrialSearchText(trial) {
    return [
      trial.title,
      trial.description,
      trial.treatmentModality,
      ...(normalizeList(trial.interventions)),
      ...(normalizeList(trial.conditions))
    ].join(" ").toLowerCase();
  }

  function buildTrialEligibilityText(trial) {
    return [
      ...(normalizeList(trial.eligibilityCriteria)),
      trial.inclusionCriteria,
      trial.exclusionCriteria
    ].join(" ").toLowerCase();
  }

  function confidenceScore(trial) {
    return CONFIDENCE_SCORES[(trial.classificationConfidence || "").toUpperCase()] || 0;
  }

  function phaseSet(value) {
    const normalized = normalizeWhitespace(value).toUpperCase();
    const phases = [];
    if (/\b(?:PHASE\s*)?I\b|\bPHASE1\b/.test(normalized)) phases.push("Phase I");
    if (/\b(?:PHASE\s*)?II\b|\bPHASE2\b/.test(normalized)) phases.push("Phase II");
    if (/\b(?:PHASE\s*)?III\b|\bPHASE3\b/.test(normalized)) phases.push("Phase III");
    if (/\b(?:PHASE\s*)?IV\b|\bPHASE4\b/.test(normalized)) phases.push("Phase IV");
    return phases;
  }

  function phasePreferenceMatches(trialPhase, preference) {
    if (!preference) return true;
    return phaseSet(trialPhase).includes(preference);
  }

  function buildLocationScore(trial, parsedQuery) {
    if (!Array.isArray(parsedQuery.locationPreferences) || parsedQuery.locationPreferences.length === 0) {
      return 0;
    }

    const haystack = [
      trial.location?.hospital,
      trial.location?.city,
      ...(normalizeList(trial.availableInstitutions)),
      ...normalizeList((trial.sites || []).map(site => `${site.institution || ""} ${site.city || ""}`))
    ].join(" ").toLowerCase();

    return parsedQuery.locationPreferences.some(term => haystack.includes(term.toLowerCase())) ? 1 : 0;
  }

  function buildPreferenceScore(trial, parsedQuery) {
    const trialText = buildTrialSearchText(trial);
    let score = 0;

    (parsedQuery.treatmentPreferences || []).forEach(pref => {
      if (pref === "radioligand" && /(radioligand|177lu|lutetium|psma)/i.test(trialText)) score += 2;
      if (pref === "parp" && /(parp|olaparib|rucaparib|niraparib|talazoparib)/i.test(trialText)) score += 2;
      if (pref === "triplet" && /(docetaxel|darolutamide|abiraterone)/i.test(trialText)) score += 1;
      if (pref === "intensification" && /(abiraterone|darolutamide|docetaxel|intensification)/i.test(trialText)) score += 1;
      if (pref === "deintensification" && /(de-?intensification|rt alone|surveillance)/i.test(trialText)) score += 1;
      if (pref === "intravesical" && /(intravesical|bcg|nadofaragene|nogapendekin|anktiva|tar-200)/i.test(trialText)) score += 2;
      if (pref === "bladder_preservation" && /(trimodality|tmt|bladder[- ]sparing|chemoradiation)/i.test(trialText)) score += 2;
      if (pref === "immunotherapy" && /(nivolumab|pembrolizumab|durvalumab|avelumab|atezolizumab|ipilimumab|pd-1|pd-l1)/i.test(trialText)) score += 1;
      if (pref === "targeted" && /(erdafitinib|fgfr|belzutifan|cabozantinib|axitinib|lenvatinib|met|vhl)/i.test(trialText)) score += 1;
      if (pref === "surveillance" && /surveillance|active surveillance/i.test(trialText)) score += 1;
      if (pref === "high_dose" && /high[- ]dose|hdct|stem cell/i.test(trialText)) score += 2;
    });

    if (parsedQuery.phasePreference && !phasePreferenceMatches(trial.phase, parsedQuery.phasePreference)) {
      score -= 1;
    }

    return score;
  }

  function normalizeTrial(trial) {
    const diseaseSettingAll = normalizeList(trial.diseaseSettingAll);
    const diseaseSettingAllIds = normalizeList(trial.diseaseSettingAllIds);
    const diseaseSettingPrimaryId = normalizeWhitespace(trial.diseaseSettingPrimaryId);
    const derivedDiseaseSettingIds = diseaseSettingAllIds.length > 0 || diseaseSettingPrimaryId
      ? []
      : deriveLegacyDiseaseSettingIds({ ...trial, diseaseSettingAll });

    return {
      ...trial,
      diseaseSettingPrimaryId: diseaseSettingPrimaryId || derivedDiseaseSettingIds[0] || "",
      diseaseSettingAllIds: diseaseSettingAllIds.length > 0 ? diseaseSettingAllIds : derivedDiseaseSettingIds,
      diseaseSettingAll,
      classificationEvidence: normalizeList(trial.classificationEvidence),
      availableInstitutions: normalizeList(trial.availableInstitutions),
      clinicalAxes: normalizeMap(trial.clinicalAxes),
      sourceTags: normalizeMap(trial.sourceTags)
    };
  }

  function addFlag(flags, code) {
    const definition = FLAG_DEFINITIONS[code];
    if (!definition) {
      return;
    }
    if (!flags.some(flag => flag.code === code)) {
      flags.push({
        code,
        title: definition.title,
        message: definition.message
      });
    }
  }

  function addResolvedFact(facts, value) {
    if (value && !facts.includes(value)) {
      facts.push(value);
    }
  }

  function buildDiseaseFact(parsedQuery) {
    if (parsedQuery.cancerType === "Prostate") {
      if (parsedQuery.diseaseLabel === "Unfavorable intermediate risk") {
        return "unfavorable IR";
      }
      if (parsedQuery.diseaseLabel === "High / very high risk") {
        return "high-risk localized";
      }
    }
    return parsedQuery.diseaseLabel;
  }

  function resolveDiseaseIds(parsedQuery) {
    return normalizeList(parsedQuery.diseaseSettingIds);
  }

  function getTrialDiseaseIds(trial) {
    const ids = trial.diseaseSettingAllIds.length > 0
      ? trial.diseaseSettingAllIds
      : normalizeList([trial.diseaseSettingPrimaryId]);
    return Array.from(new Set(ids));
  }

  function trialDiseaseRelation(trial, parsedQuery) {
    const allowedIds = resolveDiseaseIds(parsedQuery);
    if (allowedIds.length === 0) {
      return "BROAD_QUERY";
    }
    const trialIds = getTrialDiseaseIds(trial);
    if (trialIds.length === 0) {
      return "UNKNOWN_TRIAL_DATA";
    }
    return trialIds.some(id => allowedIds.includes(id)) ? "MATCH" : "MISMATCH";
  }

  function trialMatchesDiseaseSetting(trial, parsedQuery) {
    return trialDiseaseRelation(trial, parsedQuery) !== "MISMATCH";
  }

  function resolveArpiFact(parsedQuery) {
    const raw = (parsedQuery.rawQuery || "").toLowerCase();
    if (raw.includes("enzalutamide")) return "post-enzalutamide";
    if (raw.includes("abiraterone")) return "post-abiraterone";
    if (raw.includes("apalutamide")) return "post-apalutamide";
    if (raw.includes("darolutamide")) return "post-darolutamide";
    return "post-ARPI";
  }

  function resolveBiomarkerFact(parsedQuery) {
    if (!parsedQuery.clinicalAxes.biomarkerLabel) {
      return "HRR+ eligible";
    }

    if (/brca2/i.test(parsedQuery.clinicalAxes.biomarkerLabel)) {
      return "BRCA2+ eligible";
    }

    return `${parsedQuery.clinicalAxes.biomarkerLabel} eligible`;
  }

  function deriveProstateHrrRequirement(trial) {
    const axes = trial.clinicalAxes || {};
    if (isMeaningfulAxisValue(axes.hrrGene)) {
      return canonicalToken(axes.hrrGene);
    }

    const text = `${buildTrialSearchText(trial)} ${buildTrialEligibilityText(trial)}`;
    if (/brca\s*2|brca2/i.test(text)) return "brca2";
    if (/brca\s*1|brca1/i.test(text)) return "brca1";
    if (/\bbrca\b/i.test(text) && !/\bhrr\b|homologous recombination|atm|cdk12|palb2|chek2/i.test(text)) return "brca_unspecified";
    if (/\batm\b/i.test(text)) return "atm";
    if (/\bcdk12\b/i.test(text)) return "cdk12";
    if (/\bpalb2\b/i.test(text)) return "palb2";
    if (/\bchek2\b/i.test(text)) return "chek2";
    return "";
  }

  function hrrGeneMatchesRequirement(queryGene, requirement) {
    const queryToken = canonicalToken(queryGene);
    const requirementToken = canonicalToken(requirement);
    if (!requirementToken) return true;
    if (!queryToken) return false;
    if (queryToken === requirementToken) return true;
    if (requirementToken === "brca_unspecified" && ["brca1", "brca2", "brca_unspecified"].includes(queryToken)) return true;
    return false;
  }

  function humanizeTherapyLabel(value) {
    const label = normalizeWhitespace(value).replace(/_/g, " ");
    return label.toLowerCase() === "systemic therapy" ? "systemic therapy" : label;
  }

  const PROSTATE_THERAPY_ENTRIES = [
    { key: "adt", pattern: /\badt\b|androgen deprivation|lhrh|gnrh|leuprolide|goserelin|degarelix|relugolix/i, classKey: "adt", significant: false },
    { key: "enzalutamide", pattern: /enzalutamide/i, classKey: "arpi", significant: true },
    { key: "abiraterone", pattern: /abiraterone/i, classKey: "arpi", significant: true },
    { key: "apalutamide", pattern: /apalutamide/i, classKey: "arpi", significant: true },
    { key: "darolutamide", pattern: /darolutamide/i, classKey: "arpi", significant: true },
    { key: "arpi", pattern: /arpi|androgen receptor pathway inhibitor|novel hormonal/i, classKey: "arpi", significant: true },
    { key: "docetaxel", pattern: /docetaxel/i, classKey: "taxane", significant: true },
    { key: "cabazitaxel", pattern: /cabazitaxel/i, classKey: "taxane", significant: true },
    { key: "taxane", pattern: /taxane/i, classKey: "taxane", significant: true },
    { key: "olaparib", pattern: /olaparib/i, classKey: "parp", significant: true },
    { key: "rucaparib", pattern: /rucaparib/i, classKey: "parp", significant: true },
    { key: "niraparib", pattern: /niraparib/i, classKey: "parp", significant: true },
    { key: "talazoparib", pattern: /talazoparib/i, classKey: "parp", significant: true },
    { key: "parp", pattern: /parp/i, classKey: "parp", significant: true },
    { key: "radioligand", pattern: /radioligand|177lu|lutetium|psma-617|lu-psma/i, classKey: "radioligand", significant: true }
  ];

  function isTherapyClass(value) {
    return ["adt", "arpi", "taxane", "parp", "radioligand"].includes(canonicalToken(value));
  }

  function prostateTherapyEntry(value) {
    const token = canonicalToken(value);
    return PROSTATE_THERAPY_ENTRIES.find(entry => entry.key === token) || null;
  }

  function prostateTherapyClass(value) {
    const entry = prostateTherapyEntry(value);
    return entry ? entry.classKey : "";
  }

  function isSignificantProstateTherapy(value) {
    const entry = prostateTherapyEntry(value);
    return entry ? entry.significant !== false : canonicalToken(value) !== "adt";
  }

  function therapySatisfiesRequirement(therapy, requirement) {
    const therapyToken = canonicalToken(therapy);
    const requirementToken = canonicalToken(requirement);
    if (!therapyToken || !requirementToken) {
      return false;
    }
    if (therapyToken === requirementToken) {
      return true;
    }
    if (!isTherapyClass(requirementToken)) {
      return false;
    }
    return prostateTherapyClass(therapyToken) === requirementToken;
  }

  function extractProstateTherapies(text) {
    const matches = [];
    PROSTATE_THERAPY_ENTRIES.forEach(entry => {
      if (entry.pattern.test(text)) {
        addResolvedFact(matches, entry.key);
      }
    });

    const hasExactArpi = matches.some(value => ["enzalutamide", "abiraterone", "apalutamide", "darolutamide"].includes(value));
    const hasExactTaxane = matches.some(value => ["docetaxel", "cabazitaxel"].includes(value));
    const hasExactParp = matches.some(value => ["olaparib", "rucaparib", "niraparib", "talazoparib"].includes(value));
    return matches.filter(value => {
      if (value === "arpi" && hasExactArpi) return false;
      if (value === "taxane" && hasExactTaxane) return false;
      if (value === "parp" && hasExactParp) return false;
      return true;
    });
  }

  function buildQueryTherapyProfile(parsedQuery) {
    const profile = {
      received: new Set(),
      progressed: new Set()
    };
    const history = parsedQuery.therapyHistory || {};

    normalizeList(history.receivedTherapies).forEach(therapy => profile.received.add(canonicalToken(therapy)));
    normalizeList(history.progressedOnTherapies).forEach(therapy => {
      const token = canonicalToken(therapy);
      profile.progressed.add(token);
      profile.received.add(token);
    });

    normalizeList(parsedQuery.temporalFacts?.progressedAfterTherapies).forEach(therapy => {
      const token = canonicalToken(therapy);
      profile.progressed.add(token);
      profile.received.add(token);
    });

    if (parsedQuery.clinicalAxes?.priorArpi === "yes" && !Array.from(profile.received).some(therapy => prostateTherapyClass(therapy) === "arpi")) {
      profile.received.add("arpi");
    }

    if (parsedQuery.clinicalAxes?.priorDocetaxel === "yes") {
      profile.received.add("docetaxel");
    }

    return profile;
  }

  function queryHasReceivedTherapy(queryProfile, requirement) {
    return Array.from(queryProfile.received).some(therapy => therapySatisfiesRequirement(therapy, requirement));
  }

  function queryHasProgressedOnTherapy(queryProfile, requirement) {
    return Array.from(queryProfile.progressed).some(therapy => therapySatisfiesRequirement(therapy, requirement));
  }

  function deriveProstateTrialTherapyProfile(trial) {
    const profile = {
      requiredReceivedAll: [],
      requiredProgressionAll: [],
      prohibitedPriorTherapies: [],
      allowedPriorTherapies: []
    };
    const text = `${buildTrialSearchText(trial)} ${buildTrialEligibilityText(trial)}`;
    const segments = text.split(/[.;\n]+/).map(segment => normalizeWhitespace(segment)).filter(Boolean);

    segments.forEach(segment => {
      const therapies = extractProstateTherapies(segment);
      if (therapies.length === 0) {
        return;
      }

      if (/(?:no prior|without prior|naive to|not previously treated with|exclude(?:s|d)? prior|taxane-naive|arpi-naive|chemo-naive|chemotherapy-naive)/i.test(segment)) {
        therapies.forEach(therapy => addResolvedFact(profile.prohibitedPriorTherapies, therapy));
        return;
      }

      if (/(?:with or without prior|prior .* allowed|allowed prior|may have received|can have received)/i.test(segment)) {
        therapies.forEach(therapy => addResolvedFact(profile.allowedPriorTherapies, therapy));
        return;
      }

      if (/(?:progress(?:ed|ion)? on|after progressing on|following progression on|failed|failure of)/i.test(segment)) {
        therapies.forEach(therapy => {
          addResolvedFact(profile.requiredProgressionAll, therapy);
          addResolvedFact(profile.requiredReceivedAll, therapy);
        });
        return;
      }

      if (/(?:after|post[- ]|following|must have received|required prior|previously treated with|prior exposure to|received prior)/i.test(segment)) {
        therapies.forEach(therapy => addResolvedFact(profile.requiredReceivedAll, therapy));
      }
    });

    return profile;
  }

  function trialAccountsForTherapy(trialAxes, profile, therapy) {
    const therapyToken = canonicalToken(therapy);
    if (!therapyToken || !isSignificantProstateTherapy(therapyToken)) {
      return true;
    }

    const exactLists = [
      profile.requiredReceivedAll,
      profile.requiredProgressionAll,
      profile.prohibitedPriorTherapies,
      profile.allowedPriorTherapies
    ];

    if (exactLists.some(list => list.some(requirement => therapySatisfiesRequirement(therapyToken, requirement) || therapySatisfiesRequirement(requirement, therapyToken)))) {
      return true;
    }

    if (prostateTherapyClass(therapyToken) === "arpi" && isMeaningfulAxisValue(trialAxes.priorArpi)) {
      return true;
    }

    if ((therapyToken === "docetaxel" || prostateTherapyClass(therapyToken) === "taxane") && isMeaningfulAxisValue(trialAxes.priorDocetaxel)) {
      return true;
    }

    return false;
  }

  function applyProstateTherapyProfile(state) {
    const profile = deriveProstateTrialTherapyProfile(state.trial);
    const queryProfile = buildQueryTherapyProfile(state.parsedQuery);
    const hasTherapyDetail = queryProfile.received.size > 0 || queryProfile.progressed.size > 0;

    profile.prohibitedPriorTherapies.forEach(therapy => {
      if (!hasTherapyDetail) {
        addFlag(state.flags, therapy === "arpi" ? "prior_arpi" : therapy === "docetaxel" || therapy === "taxane" ? "chemotherapy_history" : "therapy_sequence");
        return;
      }

      if (queryHasReceivedTherapy(queryProfile, therapy)) {
        state.excludes.push(therapy === "arpi" ? "prior_arpi" : therapy === "docetaxel" || therapy === "taxane" ? "chemotherapy_history" : "therapy_sequence");
      }
    });

    profile.requiredProgressionAll.forEach(therapy => {
      if (!hasTherapyDetail) {
        addFlag(state.flags, therapy === "arpi" ? "prior_arpi" : therapy === "docetaxel" || therapy === "taxane" ? "chemotherapy_history" : "therapy_sequence");
        return;
      }

      if (queryHasProgressedOnTherapy(queryProfile, therapy)) {
        addResolvedFact(state.resolvedFacts, `progressed after ${humanizeTherapyLabel(therapy)}`);
        return;
      }

      if (queryHasReceivedTherapy(queryProfile, therapy)) {
        addFlag(state.flags, "therapy_sequence");
        return;
      }

      state.excludes.push("therapy_sequence");
    });

    profile.requiredReceivedAll.forEach(therapy => {
      if (profile.requiredProgressionAll.includes(therapy)) {
        return;
      }

      if (!hasTherapyDetail) {
        addFlag(state.flags, therapy === "arpi" ? "prior_arpi" : therapy === "docetaxel" || therapy === "taxane" ? "chemotherapy_history" : "therapy_sequence");
        return;
      }

      if (queryHasReceivedTherapy(queryProfile, therapy)) {
        if (therapy === "docetaxel" || therapy === "taxane") {
          addResolvedFact(state.resolvedFacts, "post-docetaxel");
        } else if (therapy === "arpi") {
          addResolvedFact(state.resolvedFacts, resolveArpiFact(state.parsedQuery));
        } else {
          addResolvedFact(state.resolvedFacts, `prior ${humanizeTherapyLabel(therapy)}`);
        }
        return;
      }

      state.excludes.push(therapy === "arpi" ? "prior_arpi" : therapy === "docetaxel" || therapy === "taxane" ? "chemotherapy_history" : "therapy_sequence");
    });

    const significantQueryTherapies = Array.from(new Set([
      ...Array.from(queryProfile.received),
      ...Array.from(queryProfile.progressed)
    ])).filter(therapy => isSignificantProstateTherapy(therapy));

    const unaccountedTherapies = significantQueryTherapies.filter(therapy => !trialAccountsForTherapy(state.trialAxes || {}, profile, therapy));
    const unaccountedProgressionTherapies = Array.from(queryProfile.progressed).filter(
      therapy => isSignificantProstateTherapy(therapy) && !trialAccountsForTherapy(state.trialAxes || {}, profile, therapy)
    );

    if (unaccountedProgressionTherapies.length > 0 || (unaccountedTherapies.length > 0 && significantQueryTherapies.length > 1)) {
      addFlag(state.flags, "therapy_sequence");
    }
  }

  function resolveTrialEcogRequirement(text) {
    if (!text) {
      return null;
    }

    if (/(?:ecog|performance status|eastern cooperative oncology group|ps)[^.]{0,48}(?:0\s*(?:-|to|or|\/)\s*1|0,?\s*1|<=?\s*1|less than 2)/i.test(text)) {
      return 1;
    }

    if (/(?:ecog|performance status|eastern cooperative oncology group|ps)[^.]{0,48}(?:0\s*(?:-|to|or|\/)\s*2|0,?\s*1,?\s*or?\s*2|<=?\s*2|less than 3)/i.test(text)) {
      return 2;
    }

    return null;
  }

  function trialNeedsLabReview(text) {
    return /(adequate (?:renal|hepatic|bone marrow|hematologic|organ) function|bone marrow function|hematologic(?:al)? function|anc\b|platelets?\b|hemoglobin\b|bilirubin\b|ast\b|alt\b|creatinine clearance|crcl\b|egfr\b|gfr\b|renal function|hepatic function)/i.test(text);
  }

  function trialNeedsWashoutReview(text) {
    return /(washout|within\s+\d+\s*(?:day|days|week|weeks)\s+(?:prior|before)|recovered from .* prior therapy|prior (?:systemic )?therapy within|anti[- ]cancer therapy within|systemic therapy within)/i.test(text);
  }

  function resolveSystemicWashoutDays(text) {
    const patterns = [
      /(?:systemic|anti[- ]cancer|anticancer|cytotoxic|chemotherapy|investigational)[^.]{0,70}?(?:within|for at least|minimum of|washout(?: of)?)\s*(\d+(?:\.\d+)?)\s*(days?|weeks?)/ig,
      /(?:within|for at least|minimum of|washout(?: of)?)\s*(\d+(?:\.\d+)?)\s*(days?|weeks?)[^.]{0,70}?(?:systemic|anti[- ]cancer|anticancer|cytotoxic|chemotherapy|investigational)/ig
    ];
    const days = [];
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text))) {
        const amount = Number(match[1]);
        if (!Number.isFinite(amount)) continue;
        days.push(match[2].toLowerCase().startsWith("week") ? amount * 7 : amount);
      }
    });
    return days.length ? Math.max(...days) : null;
  }

  function screeningEcogMax(value) {
    if (value === "ecog_0") return 0;
    if (value === "ecog_1") return 1;
    if (value === "ecog_2") return 2;
    if (value === "ecog_3_4") return 4;
    return null;
  }

  function resolveEcogFact(value) {
    if (value === "ecog_0") return "ECOG 0";
    if (value === "ecog_1") return "ECOG 1";
    if (value === "ecog_2") return "ECOG 2";
    if (value === "ecog_3_4") return "ECOG 3-4";
    return "";
  }

  function isObviouslyLocalizedProstateTrial(trial) {
    const text = `${buildTrialSearchText(trial)} ${buildTrialEligibilityText(trial)}`;
    const definitiveLocalizedSignals = /(clinically localized|has not spread to other parts of the body|no evidence of metastatic disease|localized adenocarcinoma)/i;
    const localizedSignals = /(radical prostatectomy|undergoing radical prostatectomy|scheduled to undergo rp|active surveillance|localized prostate cancer|stereotactic body radiation therapy|stereotactic body radiotherapy|\bsbrt\b)/i;
    const advancedSignals = /(mcrpc|nmcrpc|mcspc|metastatic|castration[- ]resistant|castration[- ]sensitive|psma|docetaxel|cabazitaxel|enzalutamide|abiraterone|apalutamide|darolutamide|radioligand|parp)/i;
    if (definitiveLocalizedSignals.test(text)) {
      return true;
    }
    return localizedSignals.test(text) && !advancedSignals.test(text);
  }

  function deriveProstateTrialHistology(trial) {
    const axes = trial.clinicalAxes || {};
    if (isMeaningfulAxisValue(axes.prostateHistology)) {
      return canonicalToken(axes.prostateHistology);
    }
    const text = `${buildTrialSearchText(trial)} ${buildTrialEligibilityText(trial)}`;
    if (/small[- ]cell/i.test(text)) return "small_cell";
    if (/neuroendocrine|\bnepc\b/i.test(text)) return "neuroendocrine";
    if (/aggressive[- ]variant|anaplastic/i.test(text)) return "aggressive_variant";
    if (/adenocarcinoma/i.test(text) && !/small[- ]cell|neuroendocrine|\bnepc\b|aggressive[- ]variant/i.test(text)) {
      return "adenocarcinoma";
    }
    return "";
  }

  function applyTemporalSignals(state) {
    const temporal = state.parsedQuery.temporalFacts || {};

    (temporal.progressedAfterTherapies || []).forEach(therapy => {
      addResolvedFact(state.resolvedFacts, `progressed after ${humanizeTherapyLabel(therapy)}`);
    });

    if (Number.isFinite(temporal.recentImagingDays) && temporal.recentImagingDays <= 30) {
      addResolvedFact(state.resolvedFacts, `imaging ${temporal.recentImagingDays}d ago`);
    }

    if (temporal.persistentMarkersAfterOrchiectomy === "yes") {
      addResolvedFact(state.resolvedFacts, "persistent markers after orchiectomy");
    }

    // Protocol-specific washout windows are evaluated against exact criterion text below.
  }

  function applyScreeningVerification(state) {
    const eligibilityText = buildTrialEligibilityText(state.trial);
    if (!eligibilityText) {
      return;
    }

    const screening = state.parsedQuery.screeningFacts || {};
    const ecogRequirement = resolveTrialEcogRequirement(eligibilityText);
    const needsLabReview = trialNeedsLabReview(eligibilityText);
    const needsWashoutReview = trialNeedsWashoutReview(eligibilityText);

    if (ecogRequirement !== null) {
      const ecogMax = screeningEcogMax(screening.ecogStatus);
      if (ecogMax === null) {
        addFlag(state.flags, "ecog_status");
      } else if (ecogMax <= ecogRequirement) {
        addResolvedFact(state.resolvedFacts, resolveEcogFact(screening.ecogStatus));
      } else if (screening.ecogStatus === "ecog_2" && ecogRequirement === 1) {
        addFlag(state.flags, "ecog_status");
      } else {
        state.excludes.push("ecog_status");
      }
    }

    if (needsLabReview) {
      // Generic phrases such as "labs normal" or "adequate organ function" never
      // satisfy protocol-specific numeric thresholds. Exact, dated values are required.
      addFlag(state.flags, "lab_organ_function");
    }

    if (needsWashoutReview) {
      const days = state.parsedQuery.temporalFacts?.sinceLastSystemicTherapyDays;
      const requiredDays = resolveSystemicWashoutDays(eligibilityText);
      if (!Number.isFinite(days) || !Number.isFinite(requiredDays)) {
        addFlag(state.flags, "washout_window");
      } else if (days >= requiredDays) {
        addResolvedFact(state.resolvedFacts, `systemic-therapy washout ${days}d (protocol requires ${requiredDays}d)`);
      } else {
        state.excludes.push("washout_window");
      }
    }
  }

  function baseMatchState(trial, parsedQuery) {
    const resolvedFacts = [];
    const flags = [];
    const excludes = [];
    if (parsedQuery.diseaseLabel) {
      addResolvedFact(resolvedFacts, buildDiseaseFact(parsedQuery));
    }
    const state = {
      trial,
      parsedQuery,
      trialAxes: trial.clinicalAxes || {},
      queryAxes: parsedQuery.clinicalAxes || {},
      resolvedFacts,
      flags,
      excludes,
      diseaseRelation: trial.patientSearchDiseaseRelation || "BROAD_QUERY"
    };
    applyTemporalSignals(state);
    applyScreeningVerification(state);
    return state;
  }

  function buildLegacyEvaluations(state) {
    const evaluations = [];
    state.resolvedFacts.forEach((fact, index) => {
      evaluations.push({
        criterionId: `legacy:satisfied:${index + 1}`,
        criterion: {
          criterionId: `legacy:satisfied:${index + 1}`,
          criticality: "supporting",
          reviewStatus: "machine_extracted",
          modeledStatus: "modeled",
          sourceSpan: null
        },
        status: "SATISFIED",
        patientFactIds: [],
        reason: fact,
        hardExclusionAllowed: false,
        provenanceClass: "legacy_rule"
      });
    });
    state.flags.forEach((flag, index) => {
      evaluations.push({
        criterionId: `legacy:unknown:${flag.code}:${index + 1}`,
        criterion: {
          criterionId: `legacy:unknown:${flag.code}:${index + 1}`,
          criticality: "hard",
          reviewStatus: "machine_extracted",
          modeledStatus: "modeled",
          sourceSpan: null
        },
        status: "UNKNOWN",
        unknownReason: "PATIENT_FACT_MISSING",
        patientFactIds: [],
        reason: flag.title,
        question: flag.message,
        hardExclusionAllowed: false,
        provenanceClass: "legacy_rule"
      });
    });
    Array.from(new Set(state.excludes)).forEach((code, index) => {
      evaluations.push({
        criterionId: `legacy:conflict:${code}:${index + 1}`,
        criterion: {
          criterionId: `legacy:conflict:${code}:${index + 1}`,
          criticality: "hard",
          reviewStatus: "machine_extracted",
          modeledStatus: "modeled",
          sourceSpan: null
        },
        status: "VIOLATED",
        patientFactIds: [],
        reason: `Potential rule conflict: ${String(code).replace(/_/g, " ")}.`,
        hardExclusionAllowed: false,
        provenanceClass: "legacy_rule"
      });
    });
    return evaluations;
  }

  function finalizeMatch(state) {
    const preferenceScore = buildPreferenceScore(state.trial, state.parsedQuery);
    const clinicalFlags = state.flags.slice();
    const legacyPhaseCompatible = phasePreferenceMatches(state.trial.phase, state.parsedQuery.phasePreference);
    if (state.parsedQuery.phasePreference && !phasePreferenceMatches(state.trial.phase, state.parsedQuery.phasePreference)) {
      addFlag(state.flags, "phase_preference");
    }
    if (["UNKNOWN_TRIAL_DATA", "MISMATCH"].includes(state.diseaseRelation)) {
      addFlag(state.flags, "disease_setting_review");
    }
    const reviewFacts = state.parsedQuery.patientFactSet?.facts || state.parsedQuery.candidateFacts || [];
    if (reviewFacts.some(fact => canonicalToken(fact.confirmation) === "unreviewed")) {
      addFlag(state.flags, "patient_fact_confirmation");
    }

    const locationScore = buildLocationScore(state.trial, state.parsedQuery);
    const hasConflict = state.excludes.length > 0;
    const preliminaryTier = hasConflict
      ? "MODELED_CONFLICT"
      : state.flags.length > 0
        ? "POTENTIALLY_RELEVANT"
        : "DISEASE_CONTEXT_RETRIEVAL";
    const badge = schemaApi?.REVIEW_TIER_LABELS?.[preliminaryTier] || "Potentially relevant — automated review incomplete";
    const reasonText = state.resolvedFacts.length > 0
      ? `Supported evidence: ${state.resolvedFacts.join(" · ")}`
      : "Disease-context retrieval; multiple eligibility axes remain unresolved.";
    const legacyEvaluations = buildLegacyEvaluations(state);
    const tierBase = {
      PRIORITY_PROTOCOL_REVIEW: 500,
      POTENTIALLY_RELEVANT: 400,
      MANUAL_REVIEW_TRIAL_DATA: 300,
      DISEASE_CONTEXT_RETRIEVAL: 200,
      MODELED_CONFLICT: 100
    }[preliminaryTier] || 0;

    return {
      included: true,
      badge,
      badgeTone: preliminaryTier === "MODELED_CONFLICT" ? "conflict" : preliminaryTier === "POTENTIALLY_RELEVANT" ? "potential" : "retrieval",
      reviewTier: preliminaryTier,
      legacyBadge: clinicalFlags.length > 0 ? "Possible match" : "Strong match",
      legacyIncluded: !hasConflict && legacyPhaseCompatible && state.diseaseRelation !== "MISMATCH",
      reasonText,
      resolvedFacts: state.resolvedFacts,
      flags: state.flags,
      potentialConflicts: Array.from(new Set(state.excludes)),
      hardExcluded: false,
      legacyEvaluations,
      diseaseRelation: state.diseaseRelation,
      preferenceScore,
      locationScore,
      aiExtractedReview: Object.keys(state.trialAxes).length > 0,
      sourceTagSummary: uniqueSources(state.trial),
      sortScore: tierBase + (state.resolvedFacts.length * 10) + (preferenceScore * 2) + locationScore
    };
  }

  function applyBinaryAxisRule(options) {
    const {
      trialValue,
      queryValue,
      resolvedFacts,
      factsLabel,
      flags,
      flagCode,
      excludes,
      allowValues
    } = options;

    if (!isMeaningfulAxisValue(trialValue)) {
      return;
    }

    if (queryValue) {
      if (!allowValues.includes(queryValue)) {
        excludes.push(flagCode);
        return;
      }
      if (trialValue !== queryValue && trialValue !== "required") {
        excludes.push(flagCode);
        return;
      }
      if (factsLabel) {
        addResolvedFact(resolvedFacts, factsLabel);
      }
      return;
    }

    addFlag(flags, flagCode);
  }

  function bladderBcgMatches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (trialToken === "bcg_unresponsive") return queryToken === "bcg_unresponsive";
    if (trialToken === "bcg_intolerant") return queryToken === "bcg_intolerant";
    if (trialToken === "bcg_naive") return queryToken === "bcg_naive";
    return true;
  }

  function bladderCisplatinMatches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (trialToken === "cisplatin_eligible") return queryToken === "cisplatin_eligible";
    if (trialToken === "cisplatin_ineligible") return queryToken === "cisplatin_ineligible";
    return true;
  }

  function bladderCisPapillaryMatches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (!trialToken || !queryToken) {
      return true;
    }
    if (trialToken === queryToken) {
      return true;
    }
    if (trialToken === "cis_plus_papillary") {
      return queryToken === "cis_plus_papillary";
    }
    return false;
  }

  function bladderFgfr3Matches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (!trialToken) {
      return true;
    }
    if (trialToken === "susceptible_alteration") {
      return queryToken === "susceptible_alteration";
    }
    if (trialToken === "wild_type") {
      return queryToken === "wild_type";
    }
    return true;
  }

  function bladderHer2Matches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (!trialToken) {
      return true;
    }
    if (trialToken === "ihc_3_plus") {
      return queryToken === "ihc_3_plus";
    }
    if (trialToken === "ihc_2_plus") {
      return ["ihc_2_plus", "ihc_3_plus"].includes(queryToken);
    }
    if (trialToken === "positive") {
      return ["ihc_2_plus", "ihc_3_plus", "positive"].includes(queryToken);
    }
    if (trialToken === "negative_or_low") {
      return queryToken === "negative_or_low";
    }
    return true;
  }

  function deriveBladderTrialAxes(trial) {
    const trialAxes = { ...(trial.clinicalAxes || {}) };
    const text = buildTrialEligibilityText(trial);
    const axisSources = trial?.sourceTags?.clinicalAxes || {};
    const fgfrRequirement = /(?:must|required|eligible|with|harbor(?:s|ing)?)[^.]{0,50}fgfr3[^.]{0,40}(?:mutation|fusion|alteration|positive)|fgfr3[^.]{0,50}(?:is required|required for eligibility)/i;
    const her2Requirement = /(?:must|required|eligible|with|express(?:es|ing)?)[^.]{0,50}(?:her2|erbb2)[^.]{0,40}(?:3\+|positive|overexpress)|(?:her2|erbb2)[^.]{0,50}(?:is required|required for eligibility)/i;

    if (isMeaningfulAxisValue(trialAxes.fgfr3Status) && /ai|model|inferred/i.test(axisSources.fgfr3Status || "") && !fgfrRequirement.test(text)) {
      trialAxes.fgfr3Status = "";
    }
    if (isMeaningfulAxisValue(trialAxes.her2Status) && /ai|model|inferred/i.test(axisSources.her2Status || "") && !her2Requirement.test(text)) {
      trialAxes.her2Status = "";
    }

    if (!isMeaningfulAxisValue(trialAxes.fgfr3Status) && fgfrRequirement.test(text)) {
      trialAxes.fgfr3Status = "susceptible_alteration";
    }

    if (!isMeaningfulAxisValue(trialAxes.her2Status) && her2Requirement.test(text)) {
      trialAxes.her2Status = "ihc_3_plus";
    }

    if (!isMeaningfulAxisValue(trialAxes.cisPapillaryPattern)) {
      const hasCis = /carcinoma in situ|\bcis\b/i.test(text);
      const hasPapillary = /papillary|high[- ]grade ta|high[- ]grade t1/i.test(text);
      if (hasCis && hasPapillary) {
        trialAxes.cisPapillaryPattern = "cis_plus_papillary";
      } else if (hasCis) {
        trialAxes.cisPapillaryPattern = "cis_only";
      } else if (hasPapillary) {
        trialAxes.cisPapillaryPattern = "papillary_only";
      }
    }

    return trialAxes;
  }

  function resolveBladderLineRequirement(trial) {
    const ids = getTrialDiseaseIds(trial);
    if (ids.includes("metastatic_maintenance_post_platinum_nonprogressing")) return "post_platinum_nonprogressing";
    if (ids.includes("metastatic_2l_plus")) return "1_plus";
    if (ids.some(id => ["metastatic_1l_cisplatin_ineligible", "metastatic_1l_cisplatin_eligible", "metastatic_1l_general"].includes(id))) return "0";
    return "";
  }

  function queryMeetsLineRequirement(queryValue, requirement) {
    if (!requirement) return true;
    if (!queryValue) return false;
    if (requirement === "0") return queryValue === "0";
    if (requirement === "1") return queryValue === "1";
    if (requirement === "1_plus") return queryValue === "1" || queryValue === "2+";
    if (requirement === "2+") return queryValue === "2+";
    return queryValue === requirement;
  }

  function resolveKidneyLineRequirement(trial) {
    const trialAxes = trial.clinicalAxes || {};
    if (isMeaningfulAxisValue(trialAxes.priorSystemicLines)) {
      return normalizeWhitespace(trialAxes.priorSystemicLines);
    }

    const ids = getTrialDiseaseIds(trial);
    if (ids.some(id => ["metastatic_ccrcc_favorable_1l", "metastatic_ccrcc_int_poor_1l", "metastatic_ccrcc_1l_all_risk"].includes(id))) return "0";
    if (ids.some(id => ["metastatic_ccrcc_2l_io_experienced", "metastatic_ccrcc_2l_io_naive"].includes(id))) return "1";
    if (ids.includes("metastatic_ccrcc_3l_plus")) return "2+";
    return "";
  }

  function kidneyRequiresPriorPd1AndVegf(trial) {
    const ids = getTrialDiseaseIds(trial);
    if (ids.includes("metastatic_ccrcc_post_pd1_vegf_tki_belzutifan")) {
      return true;
    }
    const text = `${buildTrialSearchText(trial)} ${buildTrialEligibilityText(trial)}`;
    return /belzutifan|welireg|after[^.;,\n]{0,60}(pd-?1|pd-?l1|checkpoint|immunotherapy)[^.;,\n]{0,60}(vegf|tki)|after[^.;,\n]{0,60}(vegf|tki)[^.;,\n]{0,60}(pd-?1|pd-?l1|checkpoint|immunotherapy)/i.test(text);
  }

  function resolveTesticularChemoRequirement(trial) {
    const trialAxes = trial.clinicalAxes || {};
    if (isMeaningfulAxisValue(trialAxes.priorChemoLines)) {
      return normalizeWhitespace(trialAxes.priorChemoLines);
    }

    const ids = getTrialDiseaseIds(trial);
    if (ids.some(id => ["seminoma_stage1", "nsgct_stage1", "nsgct_stage_is", "nsgct_stage2a_2b", "seminoma_stage2a_2b", "seminoma_stage2c_3", "nsgct_good_risk_advanced", "nsgct_intermediate_poor_risk_advanced", "gct_stage1_general"].includes(id))) return "0";
    if (ids.some(id => ["seminoma_recurrent_2l", "nsgct_recurrent_2l", "seminoma_post_first_line", "nsgct_post_first_line"].includes(id))) return "1";
    if (ids.some(id => ["seminoma_3l_plus", "nsgct_3l_plus"].includes(id))) return "2+";
    return "";
  }

  function resolveTesticularPathway(trial) {
    const ids = getTrialDiseaseIds(trial);
    if (ids.some(id => ["seminoma_post_first_line", "nsgct_post_first_line"].includes(id))) {
      return "post_first_line";
    }
    if (ids.some(id => ["seminoma_recurrent_2l", "nsgct_recurrent_2l"].includes(id))) {
      return "recurrent_2l";
    }
    if (ids.some(id => ["seminoma_3l_plus", "nsgct_3l_plus"].includes(id))) {
      return "recurrent_3l_plus";
    }
    if (ids.includes("nsgct_stage_is")) {
      return "stage_is";
    }
    if (ids.some(id => ["seminoma_stage1", "nsgct_stage1", "gct_stage1_general"].includes(id))) {
      return "stage1";
    }
    return "";
  }

  function isPostChemoResidualGctTrial(trial) {
    const ids = getTrialDiseaseIds(trial);
    if (ids.some(id => [
      "nsgct_post_first_line",
      "seminoma_post_first_line",
      "nsgct_post_chemo_residual_mass_gt1cm_markers_normalizing",
      "seminoma_post_chemo_residual_le3cm",
      "seminoma_post_chemo_residual_gt3cm_pet_timing"
    ].includes(id))) {
      return true;
    }
    const text = `${buildTrialSearchText(trial)} ${buildTrialEligibilityText(trial)}`;
    return /residual (?:mass|node|lesion)|post[- ]chemotherapy rplnd|pc[- ]rplnd/i.test(text);
  }

  function testicularPathwayCompatible(trial, parsedQuery) {
    const trialPathway = resolveTesticularPathway(trial);
    const queryGroup = normalizeWhitespace(parsedQuery.diseaseGroup);
    const queryLines = canonicalToken(parsedQuery.clinicalAxes?.priorChemoLines);
    const queryHdct = canonicalToken(parsedQuery.clinicalAxes?.priorHdct);

    if (!trialPathway || !queryGroup) {
      return true;
    }

    if (queryGroup === "post_first_line") {
      return !["recurrent_2l", "recurrent_3l_plus"].includes(trialPathway);
    }

    if (queryGroup === "recurrent") {
      if (trialPathway === "post_first_line") {
        return false;
      }
      if (trialPathway === "recurrent_2l" && (queryLines === "2+" || queryHdct === "yes")) {
        return false;
      }
      if (trialPathway === "recurrent_3l_plus" && queryLines !== "2+" && queryHdct !== "yes") {
        return false;
      }
      return true;
    }

    if (["stage_is", "stage1"].includes(queryGroup)) {
      return !["post_first_line", "recurrent_2l", "recurrent_3l_plus"].includes(trialPathway);
    }

    return true;
  }

  function histologyGroup(value) {
    const token = canonicalToken(value);
    if (!token) return "";
    if (token.includes("nsgct") || token.includes("nonseminoma") || token.includes("yolk_sac") || token.includes("mixed")) return "nsgct";
    if (token.includes("seminoma")) return "seminoma";
    if (token.includes("clear_cell")) return "clear_cell";
    if (token.includes("papillary")) return "papillary";
    if (token.includes("chromophobe")) return "chromophobe";
    if (token.includes("collecting_duct")) return "collecting_duct";
    if (token.includes("tfe3") || token.includes("tfeb") || token.includes("translocation")) return "translocation";
    return token;
  }

  function histologyMatches(trialValue, queryValue) {
    const trialGroup = histologyGroup(trialValue);
    const queryGroup = histologyGroup(queryValue);
    if (!trialGroup || !queryGroup) {
      return true;
    }
    if (trialGroup === queryGroup) {
      return true;
    }
    if (trialGroup === "papillary" && queryGroup === "papillary_type2") {
      return true;
    }
    return false;
  }

  function deriveKidneyTrialAxes(trial) {
    const trialAxes = { ...(trial.clinicalAxes || {}) };
    const text = `${buildTrialSearchText(trial)} ${buildTrialEligibilityText(trial)}`;

    if (!isMeaningfulAxisValue(trialAxes.histology)) {
      if (/unclassified/i.test(text)) {
        trialAxes.histology = "unclassified";
      } else if (/non[- ]clear[- ]cell|nccrcc/i.test(text)) {
        trialAxes.histology = "non_clear_cell";
      } else if (/clear[- ]cell|ccrcc/i.test(text)) {
        trialAxes.histology = "clear_cell";
      } else if (/papillary.{0,20}(type[\s-]*1|type i)|type[\s-]*1.{0,20}papillary|met[- ]driven papillary|hereditary papillary/i.test(text)) {
        trialAxes.histology = "papillary_type1";
      } else if (/papillary.{0,20}(type[\s-]*2|type ii)|type[\s-]*2.{0,20}papillary|hlrcc|fh[- ]deficient/i.test(text)) {
        trialAxes.histology = "papillary_type2";
      } else if (/papillary|\bprcc\b/i.test(text)) {
        trialAxes.histology = "papillary_unspecified";
      } else if (/chromophobe/i.test(text)) {
        trialAxes.histology = "chromophobe";
      } else if (/renal medullary|medullary carcinoma|medullary rcc|smarcb1|ini1[- ]deficient|sickle cell trait/i.test(text)) {
        trialAxes.histology = "medullary";
      } else if (/collecting duct/i.test(text)) {
        trialAxes.histology = "collecting_duct";
      } else if (/tfe3|tfeb|xp11|mit family|translocation/i.test(text)) {
        trialAxes.histology = "tfe3_tfeb_translocation";
      }
    }

    return trialAxes;
  }

  function kidneyHistologyInfo(value) {
    const token = canonicalToken(value);
    if (!token) {
      return { superfamily: "", family: "", specific: "", generic: false };
    }
    if (token.includes("unclassified")) return { superfamily: "nccrcc", family: "nccrcc", specific: "unclassified", generic: true };
    if (token.includes("non_clear") || token.includes("nccrcc")) return { superfamily: "nccrcc", family: "nccrcc", specific: "non_clear_cell", generic: true };
    if (token.includes("clear_cell")) return { superfamily: "clear_cell", family: "clear_cell", specific: "clear_cell", generic: false };
    if (token.includes("papillary_type1")) return { superfamily: "nccrcc", family: "papillary", specific: "papillary_type1", generic: false };
    if (token.includes("papillary_type2")) return { superfamily: "nccrcc", family: "papillary", specific: "papillary_type2", generic: false };
    if (token.includes("papillary_unspecified") || token === "papillary") return { superfamily: "nccrcc", family: "papillary", specific: "papillary_unspecified", generic: true };
    if (token.includes("chromophobe")) return { superfamily: "nccrcc", family: "chromophobe", specific: "chromophobe", generic: false };
    if (token.includes("collecting_duct")) return { superfamily: "nccrcc", family: "collecting_duct", specific: "collecting_duct", generic: false };
    if (token.includes("medullary")) return { superfamily: "nccrcc", family: "medullary", specific: "medullary", generic: false };
    if (token.includes("tfe3") || token.includes("tfeb") || token.includes("translocation")) return { superfamily: "nccrcc", family: "translocation", specific: "tfe3_tfeb_translocation", generic: false };
    return { superfamily: token, family: token, specific: token, generic: false };
  }

  function kidneyHistologyMatchStatus(trialValue, queryValue) {
    const trialInfo = kidneyHistologyInfo(trialValue);
    const queryInfo = kidneyHistologyInfo(queryValue);
    if (!trialInfo.superfamily || !queryInfo.superfamily) {
      return "match";
    }
    if (trialInfo.specific === queryInfo.specific) {
      return "match";
    }
    if (trialInfo.superfamily !== queryInfo.superfamily) {
      return "exclude";
    }
    if (trialInfo.family === queryInfo.family) {
      if (trialInfo.generic && !queryInfo.generic) {
        return "match";
      }
      if (!trialInfo.generic && queryInfo.generic) {
        return "flag";
      }
      return "exclude";
    }
    if (trialInfo.generic) {
      return "match";
    }
    if (queryInfo.generic) {
      return "flag";
    }
    return "exclude";
  }

  function imdcRiskMatches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (trialToken === "intermediate_poor") {
      return ["intermediate", "poor", "intermediate_poor"].includes(queryToken);
    }
    return trialToken === queryToken;
  }

  function nephrectomyStatusMatches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (trialToken === "prior_nephrectomy") return queryToken === "prior_nephrectomy";
    if (trialToken === "cytoreductive_candidate") return queryToken === "cytoreductive_candidate";
    if (trialToken === "no_nephrectomy_not_candidate") return queryToken === "no_nephrectomy_not_candidate";
    return true;
  }

  function vhlStatusMatches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (!trialToken || !queryToken) return false;
    if (trialToken === queryToken) return true;
    if (trialToken === "vhl_disease_germline") return queryToken === "vhl_disease_germline";
    if (trialToken === "somatic_vhl_mutation") return queryToken === "somatic_vhl_mutation";
    if (["vhl_unspecified", "vhl_altered"].includes(trialToken)) {
      return ["vhl_disease_germline", "somatic_vhl_mutation", "vhl_unspecified", "vhl_altered"].includes(queryToken);
    }
    return false;
  }

  function clinicalStageMatches(trialValue, queryValue) {
    const trialToken = schemaApi?.normalizeAxisValue ? schemaApi.normalizeAxisValue("clinicalStage", trialValue) : canonicalToken(trialValue);
    const queryToken = schemaApi?.normalizeAxisValue ? schemaApi.normalizeAxisValue("clinicalStage", queryValue) : canonicalToken(queryValue);
    if (!trialToken || !queryToken) {
      return true;
    }
    if (trialToken === queryToken) {
      return true;
    }
    if (trialToken === "stage_1_unspecified" && ["stage_1a", "stage_1b", "stage_1s"].includes(queryToken)) return true;
    if (queryToken === "stage_1_unspecified" && ["stage_1a", "stage_1b", "stage_1s"].includes(trialToken)) return true;
    if (trialToken === "stage_2_unspecified" && ["stage_2a", "stage_2b", "stage_2c"].includes(queryToken)) return true;
    if (trialToken === "stage_3_unspecified" && ["stage_3a", "stage_3b", "stage_3c"].includes(queryToken)) return true;
    return false;
  }

  function primarySiteMatches(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (!trialToken || !queryToken) {
      return true;
    }
    if (queryToken === "extragonadal" && trialToken !== "testicular") return true;
    if (trialToken === "extragonadal" && queryToken !== "testicular") return true;
    if (trialToken === queryToken) {
      return true;
    }
    if (trialToken === "testicular" && queryToken === "testis") return true;
    return false;
  }

  function primarySiteMatchStatus(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (!trialToken || !queryToken) {
      return "match";
    }
    if (trialToken === queryToken || (trialToken === "testicular" && queryToken === "testis")) {
      return "match";
    }
    if ((queryToken === "extragonadal" && trialToken !== "testicular") || (trialToken === "extragonadal" && queryToken !== "testicular")) {
      return "flag";
    }
    return "exclude";
  }

  function markerStatusMatchStatus(trialValue, queryValue) {
    const trialToken = canonicalToken(trialValue);
    const queryToken = canonicalToken(queryValue);
    if (!trialToken || !queryToken) {
      return "match";
    }
    if (trialToken === queryToken) {
      return "match";
    }
    const elevatedTokens = ["markers_elevated", "afp_elevated", "hcg_elevated", "ldh_elevated", "multiple_elevated"];
    if (trialToken === "markers_elevated" && elevatedTokens.includes(queryToken) && queryToken !== "markers_normal") {
      return "match";
    }
    if (queryToken === "markers_elevated" && ["afp_elevated", "hcg_elevated", "ldh_elevated"].includes(trialToken)) {
      return "flag";
    }
    if (trialToken === "afp_elevated" && ["afp_elevated", "multiple_elevated"].includes(queryToken)) {
      return "match";
    }
    if (trialToken === "hcg_elevated" && ["hcg_elevated", "multiple_elevated"].includes(queryToken)) {
      return "match";
    }
    if (trialToken === "ldh_elevated" && ["ldh_elevated", "multiple_elevated"].includes(queryToken)) {
      return "match";
    }
    if (queryToken === "multiple_elevated" && ["afp_elevated", "hcg_elevated", "ldh_elevated"].includes(trialToken)) {
      return "match";
    }
    if (trialToken === "multiple_elevated" && ["afp_elevated", "hcg_elevated", "ldh_elevated", "markers_elevated"].includes(queryToken)) {
      return "flag";
    }
    return "exclude";
  }

  function applyRequirementFlag(state, requirement, queryValue, flagCode, factLabel) {
    if (!requirement) {
      return;
    }
    if (!queryValue) {
      addFlag(state.flags, flagCode);
      return;
    }
    if (!queryMeetsLineRequirement(queryValue, requirement)) {
      state.excludes.push(flagCode);
      return;
    }
    if (factLabel) {
      addResolvedFact(state.resolvedFacts, factLabel);
    }
  }

  function resolveKidneyHistologyFact(value) {
    const info = kidneyHistologyInfo(value);
    if (!info.superfamily) return "";
    if (info.specific === "clear_cell") return "clear-cell histology";
    if (info.specific === "papillary_type1") return "papillary type 1 histology";
    if (info.specific === "papillary_type2") return "papillary type 2 / FH-deficient histology";
    if (info.family === "papillary") return "papillary histology";
    if (info.specific === "chromophobe") return "chromophobe histology";
    if (info.specific === "collecting_duct") return "collecting-duct histology";
    if (info.specific === "medullary") return "renal medullary carcinoma histology";
    if (info.specific === "tfe3_tfeb_translocation") return "translocation histology";
    if (info.specific === "unclassified") return "unclassified RCC histology";
    if (info.specific === "non_clear_cell") return "non-clear-cell histology";
    return info.specific.replace(/_/g, " ");
  }

  function resolveTesticularHistologyFact(value) {
    const group = histologyGroup(value);
    if (group === "seminoma") return "seminoma";
    if (group === "nsgct") return "NSGCT";
    return "";
  }

  function resolveMarkerStatusFact(value) {
    const token = canonicalToken(value);
    if (token === "markers_normal") return "markers normal";
    if (token === "markers_elevated") return "markers elevated";
    if (token === "afp_elevated") return "AFP elevated";
    if (token === "hcg_elevated") return "beta-hCG elevated";
    if (token === "ldh_elevated") return "LDH elevated";
    if (token === "multiple_elevated") return "multiple markers elevated";
    return normalizeWhitespace(value).replace(/_/g, " ");
  }

  function matchProstateTrial(trial, parsedQuery) {
    const state = baseMatchState(trial, parsedQuery);
    const trialAxes = state.trialAxes;
    const queryAxes = state.queryAxes;

    if (["crpc", "cspc"].includes(parsedQuery.diseaseGroup) && isObviouslyLocalizedProstateTrial(trial)) {
      state.excludes.push("staging");
      return finalizeMatch(state);
    }

    const trialHistology = deriveProstateTrialHistology(trial);
    const queryHistology = canonicalToken(queryAxes.prostateHistology);
    const variantHistologies = ["small_cell", "neuroendocrine", "aggressive_variant"];
    if (queryHistology && trialHistology) {
      if (variantHistologies.includes(queryHistology) && trialHistology === "adenocarcinoma") {
        state.excludes.push("prostate_variant_histology");
      } else if (variantHistologies.includes(trialHistology) && queryHistology === "adenocarcinoma") {
        state.excludes.push("prostate_variant_histology");
      } else if (variantHistologies.includes(queryHistology) && queryHistology !== trialHistology) {
        addFlag(state.flags, "prostate_variant_histology");
      }
    } else if (variantHistologies.includes(queryHistology) && !trialHistology) {
      addFlag(state.flags, "prostate_variant_histology");
    } else if (variantHistologies.includes(trialHistology) && !queryHistology) {
      addFlag(state.flags, "prostate_variant_histology");
    }

    applyBinaryAxisRule({
      trialValue: trialAxes.castrationStatus,
      queryValue: queryAxes.castrationStatus,
      resolvedFacts: state.resolvedFacts,
      factsLabel: parsedQuery.diseaseGroup === "crpc" ? "castration-resistant" : parsedQuery.diseaseGroup === "cspc" ? "castration-sensitive" : "",
      flags: state.flags,
      flagCode: "castration_status",
      excludes: state.excludes,
      allowValues: ["castration_sensitive", "castration_resistant"]
    });

    if (isMeaningfulAxisValue(trialAxes.metastaticStatus) && queryAxes.metastaticStatus) {
      if (trialAxes.metastaticStatus !== queryAxes.metastaticStatus && !(trialAxes.metastaticStatus === "metastatic" && parsedQuery.diseaseGroup === "cspc")) {
        state.excludes.push("staging");
      }
    } else if (isMeaningfulAxisValue(trialAxes.metastaticStatus) && !queryAxes.metastaticStatus) {
      addFlag(state.flags, "staging");
    }

    applyProstateTherapyProfile(state);

    if (isMeaningfulAxisValue(trialAxes.priorArpi)) {
      if (queryAxes.priorArpi) {
        if (trialAxes.priorArpi !== queryAxes.priorArpi) {
          state.excludes.push("prior_arpi");
        } else if (queryAxes.priorArpi === "yes") {
          addResolvedFact(state.resolvedFacts, resolveArpiFact(parsedQuery));
        }
      } else {
        addFlag(state.flags, "prior_arpi");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.priorDocetaxel)) {
      if (queryAxes.priorDocetaxel) {
        if (trialAxes.priorDocetaxel !== queryAxes.priorDocetaxel) {
          state.excludes.push("chemotherapy_history");
        } else if (queryAxes.priorDocetaxel === "no") {
          addResolvedFact(state.resolvedFacts, "chemo-naive permitted");
        } else {
          addResolvedFact(state.resolvedFacts, "post-docetaxel");
          if (queryAxes.taxaneExposure === "docetaxel_unspecified") {
            addFlag(state.flags, "taxane_setting_needed");
          }
        }
      } else {
        addFlag(state.flags, "chemotherapy_history");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.biomarkerHrr)) {
      const hrrRequirement = deriveProstateHrrRequirement(trial);
      if (queryAxes.biomarkerHrr) {
        if (trialAxes.biomarkerHrr !== queryAxes.biomarkerHrr) {
          state.excludes.push("brca_hrr");
        } else if (hrrRequirement && !hrrGeneMatchesRequirement(queryAxes.hrrGene, hrrRequirement)) {
          if (queryAxes.hrrGene) {
            state.excludes.push("brca_hrr");
          } else {
            addFlag(state.flags, "brca2_specificity_needed");
          }
        } else {
          addResolvedFact(state.resolvedFacts, resolveBiomarkerFact(parsedQuery));
        }
      } else {
        addFlag(state.flags, hrrRequirement ? "brca2_specificity_needed" : "brca_hrr");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.psmaStatus)) {
      if (queryAxes.psmaStatus) {
        if (queryAxes.psmaStatus === "negative") {
          state.excludes.push("psma_status");
        } else if (queryAxes.psmaPetPattern === "dominant_psma_negative_lesion") {
          addFlag(state.flags, "psma_pet_pattern_needed");
        } else {
          addResolvedFact(state.resolvedFacts, "PSMA-confirmed");
        }
      } else {
        addFlag(state.flags, "psma_status");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.genomicClassifier)) {
      if (queryAxes.genomicClassifier) {
        addResolvedFact(state.resolvedFacts, "genomic classifier confirmed");
      } else {
        addFlag(state.flags, "genomic_classifier");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.diseaseVolume)) {
      if (queryAxes.diseaseVolume) {
        if (trialAxes.diseaseVolume !== queryAxes.diseaseVolume) {
          state.excludes.push("disease_volume");
        } else if (queryAxes.prostateVolumeClass === "possible_high_volume") {
          addResolvedFact(state.resolvedFacts, "possible high-volume disease");
          addFlag(state.flags, "disease_volume");
        } else if (queryAxes.diseaseVolume === "high_volume") {
          addResolvedFact(state.resolvedFacts, "high-volume confirmed");
        } else if (queryAxes.diseaseVolume === "oligometastatic") {
          addResolvedFact(state.resolvedFacts, "oligometastatic");
        } else {
          addResolvedFact(state.resolvedFacts, "low-volume confirmed");
        }
      } else {
        addFlag(state.flags, "disease_volume");
      }
    }

    if (parsedQuery.diseaseGroup === "cspc" && !queryAxes.adtStatus) {
      addFlag(state.flags, "adt_history");
    } else if (parsedQuery.diseaseGroup === "cspc" && queryAxes.adtStatus === "naive") {
      addResolvedFact(state.resolvedFacts, "ADT-naive");
    }

    return finalizeMatch(state);
  }

  function matchBladderTrial(trial, parsedQuery) {
    const state = baseMatchState(trial, parsedQuery);
    const trialAxes = deriveBladderTrialAxes(trial);
    const queryAxes = state.queryAxes;
    state.trialAxes = trialAxes;

    if (isMeaningfulAxisValue(trialAxes.bcgStatus)) {
      if (queryAxes.bcgStatus) {
        if (!bladderBcgMatches(trialAxes.bcgStatus, queryAxes.bcgStatus)) {
          state.excludes.push("bcg_status");
        } else {
          addResolvedFact(state.resolvedFacts, normalizeWhitespace(queryAxes.bcgStatus).replace(/^BCG-/, "BCG-"));
          if (canonicalToken(queryAxes.bcgStatus) === "bcg_unresponsive" && !queryAxes.bcgAdequacy && !/bcg[- ]unresponsive/i.test(parsedQuery.rawQuery || "")) {
            addFlag(state.flags, "bcg_adequacy_timing_needed");
          }
        }
      } else if (queryAxes.bcgTimingPattern === "exposed_not_unresponsive") {
        addFlag(state.flags, "bcg_adequacy_timing_needed");
      } else {
        addFlag(state.flags, "bcg_status");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.cisPapillaryPattern)) {
      if (queryAxes.cisPapillaryPattern) {
        if (!bladderCisPapillaryMatches(trialAxes.cisPapillaryPattern, queryAxes.cisPapillaryPattern)) {
          state.excludes.push("cis_papillary_pattern");
        } else if (queryAxes.cisPapillaryPattern === "cis_only") {
          addResolvedFact(state.resolvedFacts, "CIS-only disease");
        } else if (queryAxes.cisPapillaryPattern === "papillary_only") {
          addResolvedFact(state.resolvedFacts, "papillary-only disease");
        } else {
          addResolvedFact(state.resolvedFacts, "CIS + papillary pattern");
        }
      } else {
        addFlag(state.flags, "cis_papillary_pattern");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.cisplatinStatus)) {
      if (queryAxes.cisplatinStatus) {
        if (!bladderCisplatinMatches(trialAxes.cisplatinStatus, queryAxes.cisplatinStatus)) {
          state.excludes.push("cisplatin_eligibility");
        } else {
          addResolvedFact(state.resolvedFacts, normalizeWhitespace(queryAxes.cisplatinStatus).toLowerCase());
        }
      } else {
        addFlag(state.flags, "cisplatin_eligibility");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.fgfr3Status)) {
      if (queryAxes.fgfr3Status) {
        if (!bladderFgfr3Matches(trialAxes.fgfr3Status, queryAxes.fgfr3Status)) {
          state.excludes.push("fgfr3_status");
        } else {
          addResolvedFact(state.resolvedFacts, queryAxes.fgfr3Status === "susceptible_alteration" ? "FGFR3-altered" : "FGFR3 wild-type");
        }
      } else if (queryAxes.fgfrAlteration === "fgfr_unspecified") {
        addFlag(state.flags, "fgfr3_specificity_needed");
      } else if (queryAxes.fgfrAlteration && queryAxes.fgfrAlteration !== "fgfr_negative") {
        state.excludes.push("fgfr3_status");
      } else {
        addFlag(state.flags, "fgfr3_status");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.her2Status)) {
      if (queryAxes.her2Status) {
        if (!bladderHer2Matches(trialAxes.her2Status, queryAxes.her2Status)) {
          state.excludes.push("her2_status");
        } else if (queryAxes.her2Status === "ihc_3_plus") {
          addResolvedFact(state.resolvedFacts, "HER2 IHC 3+");
        } else if (queryAxes.her2Status === "ihc_2_plus") {
          addResolvedFact(state.resolvedFacts, "HER2 IHC 2+");
        } else {
          addResolvedFact(state.resolvedFacts, "HER2 status confirmed");
        }
      } else {
        addFlag(state.flags, "her2_status");
      }
    }

    const lineRequirement = resolveBladderLineRequirement(trial);
    if (lineRequirement === "post_platinum_nonprogressing") {
      if (queryAxes.platinumStatus === "post_platinum_nonprogressing") {
        addResolvedFact(state.resolvedFacts, "post-platinum nonprogressing");
      } else if (queryAxes.platinumStatus === "post_platinum_progressed") {
        state.excludes.push("platinum_response_needed");
      } else {
        addFlag(state.flags, "platinum_response_needed");
      }
    } else {
      applyRequirementFlag(
        state,
        lineRequirement,
        queryAxes.priorSystemicLines,
        "systemic_line",
        lineRequirement === "0" ? "treatment-naive" : lineRequirement === "1_plus" ? "previously treated" : ""
      );
    }

    if (isMeaningfulAxisValue(trialAxes.priorIo)) {
      if (queryAxes.priorIo) {
        if (canonicalToken(trialAxes.priorIo) !== canonicalToken(queryAxes.priorIo)) {
          state.excludes.push("io_history");
        } else {
          addResolvedFact(state.resolvedFacts, queryAxes.priorIo === "no" ? "IO-naive" : "post-IO");
        }
      } else {
        addFlag(state.flags, "io_history");
      }
    }

    return finalizeMatch(state);
  }

  function matchKidneyTrial(trial, parsedQuery) {
    const state = baseMatchState(trial, parsedQuery);
    const trialAxes = deriveKidneyTrialAxes(trial);
    const queryAxes = state.queryAxes;
    state.trialAxes = trialAxes;

    if (isMeaningfulAxisValue(trialAxes.histology)) {
      if (queryAxes.histology) {
        const histologyStatus = kidneyHistologyMatchStatus(trialAxes.histology, queryAxes.histology);
        if (histologyStatus === "exclude") {
          state.excludes.push("histology");
        } else if (histologyStatus === "flag") {
          addResolvedFact(state.resolvedFacts, resolveKidneyHistologyFact(queryAxes.histology));
          addFlag(state.flags, "histology");
        } else {
          addResolvedFact(state.resolvedFacts, resolveKidneyHistologyFact(queryAxes.histology));
        }
      } else {
        addFlag(state.flags, "histology");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.imdcRisk)) {
      if (queryAxes.imdcRisk) {
        if (!imdcRiskMatches(trialAxes.imdcRisk, queryAxes.imdcRisk)) {
          state.excludes.push("imdc_risk");
        } else {
          addResolvedFact(state.resolvedFacts, `IMDC ${normalizeWhitespace(queryAxes.imdcRisk).replace(/_/g, "/")}`);
        }
      } else {
        addFlag(state.flags, "imdc_risk");
      }
    }

    const lineRequirement = resolveKidneyLineRequirement(trial);
    applyRequirementFlag(
      state,
      lineRequirement,
      queryAxes.priorSystemicLines,
      "systemic_line",
      lineRequirement === "0" ? "systemic-naive" : lineRequirement === "1" ? "one prior systemic line" : lineRequirement === "2+" ? "multiple prior lines" : ""
    );

    if (kidneyRequiresPriorPd1AndVegf(trial)) {
      if (queryAxes.priorIo === "yes" && queryAxes.priorVegfTki === "yes") {
        addResolvedFact(state.resolvedFacts, "post-PD-1/PD-L1 and VEGF-TKI");
      } else if (queryAxes.priorIo === "no" || queryAxes.priorVegfTki === "no") {
        state.excludes.push("pd1_vegf_sequence_needed");
      } else {
        addFlag(state.flags, "pd1_vegf_sequence_needed");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.priorIo)) {
      if (queryAxes.priorIo) {
        if (trialAxes.priorIo !== queryAxes.priorIo) {
          state.excludes.push("io_history");
        } else {
          addResolvedFact(state.resolvedFacts, queryAxes.priorIo === "no" ? "IO-naive" : "post-IO");
        }
      } else {
        addFlag(state.flags, "io_history");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.priorVegfTki)) {
      if (queryAxes.priorVegfTki) {
        if (trialAxes.priorVegfTki !== queryAxes.priorVegfTki) {
          state.excludes.push("vegf_tki_history");
        } else {
          addResolvedFact(state.resolvedFacts, queryAxes.priorVegfTki === "no" ? "VEGF-TKI naive" : "post-VEGF-TKI");
        }
      } else {
        addFlag(state.flags, "vegf_tki_history");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.nephrectomyStatus)) {
      if (queryAxes.nephrectomyStatus) {
        if (!nephrectomyStatusMatches(trialAxes.nephrectomyStatus, queryAxes.nephrectomyStatus)) {
          state.excludes.push("nephrectomy_status");
        } else if (queryAxes.nephrectomyStatus === "prior_nephrectomy") {
          addResolvedFact(state.resolvedFacts, "post-nephrectomy");
        } else if (queryAxes.nephrectomyStatus === "cytoreductive_candidate") {
          addResolvedFact(state.resolvedFacts, "primary in place");
        }
      } else {
        addFlag(state.flags, "nephrectomy_status");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.vhlStatus)) {
      if (queryAxes.vhlStatus) {
        if (!vhlStatusMatches(trialAxes.vhlStatus, queryAxes.vhlStatus)) {
          state.excludes.push("vhl_status");
        } else if (canonicalToken(queryAxes.vhlStatus) === "vhl_disease_germline") {
          addResolvedFact(state.resolvedFacts, "germline VHL disease");
        } else if (canonicalToken(queryAxes.vhlStatus) === "somatic_vhl_mutation") {
          addResolvedFact(state.resolvedFacts, "somatic VHL alteration");
        } else {
          addResolvedFact(state.resolvedFacts, "VHL status documented");
          addFlag(state.flags, "vhl_status");
        }
      } else {
        addFlag(state.flags, "vhl_status");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.metAlteration)) {
      if (queryAxes.metAlteration) {
        if (canonicalToken(trialAxes.metAlteration) !== canonicalToken(queryAxes.metAlteration)) {
          state.excludes.push("met_alteration");
        } else {
          addResolvedFact(state.resolvedFacts, queryAxes.metAlteration === "met_amplification" ? "MET amplification" : "MET mutation");
        }
      } else {
        addFlag(state.flags, "met_alteration");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.sarcomatoid)) {
      if (queryAxes.sarcomatoid) {
        if (trialAxes.sarcomatoid !== queryAxes.sarcomatoid) {
          state.excludes.push("sarcomatoid");
        } else {
          addResolvedFact(state.resolvedFacts, "sarcomatoid features");
        }
      } else {
        addFlag(state.flags, "sarcomatoid");
      }
    }

    return finalizeMatch(state);
  }

  function matchTesticularTrial(trial, parsedQuery) {
    const state = baseMatchState(trial, parsedQuery);
    const trialAxes = state.trialAxes;
    const queryAxes = state.queryAxes;

    if (!testicularPathwayCompatible(trial, parsedQuery)) {
      state.excludes.push("chemo_lines");
      return finalizeMatch(state);
    }

    if (isPostChemoResidualGctTrial(trial)) {
      if (!queryAxes.gctResidualMassSizeCm) {
        addFlag(state.flags, "gct_residual_mass_size_needed");
      } else {
        addResolvedFact(state.resolvedFacts, `residual mass ${queryAxes.gctResidualMassSizeCm} cm`);
      }

      if (!queryAxes.gctMarkerTrend && !queryAxes.markerStatus) {
        addFlag(state.flags, "gct_marker_trend_needed");
      } else if (queryAxes.gctMarkerTrend) {
        addResolvedFact(state.resolvedFacts, `markers ${normalizeWhitespace(queryAxes.gctMarkerTrend).replace(/_/g, " ")}`);
      }
    }

    if (parsedQuery.diseaseGroup === "recurrent" && !queryAxes.gctSalvageLine && !queryAxes.priorChemoLines) {
      addFlag(state.flags, "gct_salvage_line_needed");
    }

    if (isMeaningfulAxisValue(trialAxes.histology)) {
      if (queryAxes.histology) {
        if (!histologyMatches(trialAxes.histology, queryAxes.histology)) {
          state.excludes.push("histology");
        } else {
          addResolvedFact(state.resolvedFacts, resolveTesticularHistologyFact(queryAxes.histology));
        }
      } else {
        addFlag(state.flags, "histology");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.clinicalStage)) {
      if (queryAxes.clinicalStage) {
        if (!clinicalStageMatches(trialAxes.clinicalStage, queryAxes.clinicalStage)) {
          state.excludes.push("clinical_stage");
        } else {
          addResolvedFact(state.resolvedFacts, normalizeWhitespace(queryAxes.clinicalStage).replace(/_/g, " "));
        }
      } else {
        addFlag(state.flags, "clinical_stage");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.igcccgRisk)) {
      if (queryAxes.igcccgRisk) {
        if (canonicalToken(trialAxes.igcccgRisk) !== canonicalToken(queryAxes.igcccgRisk)) {
          state.excludes.push("igcccg_risk");
        } else {
          addResolvedFact(state.resolvedFacts, `IGCCCG ${normalizeWhitespace(queryAxes.igcccgRisk)}`);
        }
      } else {
        addFlag(state.flags, "igcccg_risk");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.primarySite)) {
      if (queryAxes.primarySite) {
        const primarySiteStatus = primarySiteMatchStatus(trialAxes.primarySite, queryAxes.primarySite);
        if (primarySiteStatus === "exclude") {
          state.excludes.push("primary_site");
        } else {
          if (canonicalToken(queryAxes.primarySite) !== "testicular") {
            const label = canonicalToken(queryAxes.primarySite) === "extragonadal"
              ? "extragonadal primary"
              : `${normalizeWhitespace(queryAxes.primarySite).replace(/_/g, " ")} primary`;
            addResolvedFact(state.resolvedFacts, label);
          }
          if (primarySiteStatus === "flag") {
            addFlag(state.flags, "primary_site");
          }
        }
      } else {
        addFlag(state.flags, "primary_site");
      }
    }

    const chemoRequirement = resolveTesticularChemoRequirement(trial);
    applyRequirementFlag(
      state,
      chemoRequirement,
      queryAxes.priorChemoLines,
      "chemo_lines",
      chemoRequirement === "0" ? "chemo-naive" : chemoRequirement === "1" ? "post first-line chemotherapy" : chemoRequirement === "2+" ? "multi-line treated" : ""
    );

    if (isMeaningfulAxisValue(trialAxes.priorHdct)) {
      if (queryAxes.priorHdct) {
        if (trialAxes.priorHdct !== queryAxes.priorHdct) {
          state.excludes.push("hdct_history");
        } else if (queryAxes.priorHdct === "yes") {
          addResolvedFact(state.resolvedFacts, "post-HDCT");
        }
      } else {
        addFlag(state.flags, "hdct_history");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.markerStatus)) {
      if (queryAxes.markerStatus) {
        const markerStatus = markerStatusMatchStatus(trialAxes.markerStatus, queryAxes.markerStatus);
        if (markerStatus === "exclude") {
          state.excludes.push("marker_status");
        } else {
          addResolvedFact(state.resolvedFacts, resolveMarkerStatusFact(queryAxes.markerStatus));
          if (markerStatus === "flag") {
            addFlag(state.flags, "marker_status");
          }
        }
      } else {
        addFlag(state.flags, "marker_status");
      }
    }

    if (isMeaningfulAxisValue(trialAxes.stage1RiskFactors)) {
      if (queryAxes.stage1RiskFactors) {
        const trialRisk = schemaApi?.normalizeAxisValue ? schemaApi.normalizeAxisValue("stage1RiskFactors", trialAxes.stage1RiskFactors) : canonicalToken(trialAxes.stage1RiskFactors);
        const queryRisk = schemaApi?.normalizeAxisValue ? schemaApi.normalizeAxisValue("stage1RiskFactors", queryAxes.stage1RiskFactors) : canonicalToken(queryAxes.stage1RiskFactors);
        if (trialRisk !== queryRisk) {
          state.excludes.push("stage1_risk_factors");
        } else {
          addResolvedFact(state.resolvedFacts, queryRisk === "with_risk_factors" ? "stage I risk factors present" : "stage I risk factors absent");
        }
      } else {
        addFlag(state.flags, "stage1_risk_factors");
      }
    }

    return finalizeMatch(state);
  }

  function buildPatientFactSet(parsedQuery) {
    if (parsedQuery?.patientFactSet && Array.isArray(parsedQuery.patientFactSet.facts)) {
      return parsedQuery.patientFactSet;
    }
    const facts = Array.isArray(parsedQuery?.candidateFacts) ? parsedQuery.candidateFacts : [];
    return {
      schemaVersion: schemaApi?.SCHEMA_VERSION || "1.0.0",
      patientVersion: "unconfirmed-parser-output",
      facts,
      contradictions: Array.isArray(parsedQuery?.contradictions)
        ? parsedQuery.contradictions
        : schemaApi?.detectContradictions?.(facts) || [],
      ignoredText: parsedQuery?.ignoredText || []
    };
  }

  function isTrialSourceCurrent(trial, maximumAgeDays) {
    const raw = trial?.registryVersion || trial?.lastSyncAt || trial?.lastUpdated || "";
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) return false;
    const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
    return ageDays <= (maximumAgeDays || 7);
  }

  function criterionCoverage(evaluations) {
    const weighted = (evaluations || []).filter(evaluation => evaluation.criterion?.criticality !== "supporting");
    if (weighted.length === 0) return 0;
    const supported = weighted.filter(evaluation => ["SATISFIED", "VIOLATED"].includes(evaluation.status)).length;
    return supported / weighted.length;
  }

  function reviewTierTone(reviewTier) {
    if (reviewTier === "PRIORITY_PROTOCOL_REVIEW") return "priority";
    if (reviewTier === "POTENTIALLY_RELEVANT") return "potential";
    if (reviewTier === "MANUAL_REVIEW_TRIAL_DATA") return "manual";
    if (reviewTier === "MODELED_CONFLICT") return "conflict";
    return "retrieval";
  }

  function enrichMatchForCohort(trial, cohort, parsedQuery, legacyMatch) {
    const patientFactSet = buildPatientFactSet(parsedQuery);
    const criteria = [].concat(cohort?.sharedCriteria || [], cohort?.cohortSpecificCriteria || []);
    const sourceCurrent = isTrialSourceCurrent(trial, 7);
    const structuredEvaluations = schemaApi?.evaluateCriterion
      ? criteria.map(criterion => schemaApi.evaluateCriterion(criterion, patientFactSet, { trialSourceIsCurrent: sourceCurrent }))
      : [];
    if (criteria.length === 0) {
      structuredEvaluations.push({
        criterionId: `${cohort.cohortId}:criteria-unavailable`,
        criterion: {
          criterionId: `${cohort.cohortId}:criteria-unavailable`,
          criticality: "hard",
          reviewStatus: "unreviewed",
          modeledStatus: "not_modeled",
          sourceSpan: null
        },
        status: "NOT_MODELED",
        unknownReason: "TRIAL_SOURCE_AMBIGUOUS",
        patientFactIds: [],
        patientFacts: [],
        reason: "Cohort-specific eligibility criteria are not available as reviewed structured data.",
        question: "Review the current protocol and confirm the applicable cohort.",
        trialSourceIsCurrent: sourceCurrent,
        hardExclusionAllowed: false
      });
    }

    const evaluations = structuredEvaluations.concat(legacyMatch.legacyEvaluations || []);
    const trialQuality = schemaApi?.calculateTrialDataQuality
      ? schemaApi.calculateTrialDataQuality(cohort, trial)
      : { tier: "machine_extracted", criticalCriteriaModeled: 0, currentLocalCohort: false };
    let reviewTier = schemaApi?.classifyReviewTier
      ? schemaApi.classifyReviewTier({
          evaluations,
          trialQuality,
          diseaseRelation: legacyMatch.diseaseRelation,
          positiveDiseaseEvidence: legacyMatch.diseaseRelation === "MATCH" && Boolean(parsedQuery.diseaseLabel),
          hasUnconfirmedCriticalFacts: patientFactSet.facts.some(fact => canonicalToken(fact.confirmation) === "unreviewed") || patientFactSet.contradictions.length > 0
        })
      : legacyMatch.reviewTier;
    if ((legacyMatch.potentialConflicts || []).length > 0) reviewTier = "MODELED_CONFLICT";
    if (legacyMatch.diseaseRelation === "MISMATCH" && trialQuality.tier !== "reviewed") reviewTier = "MANUAL_REVIEW_TRIAL_DATA";

    const flags = (legacyMatch.flags || []).slice();
    if (reviewTier === "MANUAL_REVIEW_TRIAL_DATA") addFlag(flags, "trial_data_incomplete");
    const tierBase = {
      PRIORITY_PROTOCOL_REVIEW: 5,
      POTENTIALLY_RELEVANT: 4,
      MANUAL_REVIEW_TRIAL_DATA: 3,
      DISEASE_CONTEXT_RETRIEVAL: 2,
      MODELED_CONFLICT: 1
    }[reviewTier] || 0;
    const supportedCount = evaluations.filter(evaluation => evaluation.status === "SATISFIED").length;
    const unknownCount = evaluations.filter(evaluation => ["UNKNOWN", "NOT_MODELED"].includes(evaluation.status)).length;
    const hardExcluded = evaluations.some(evaluation => evaluation.hardExclusionAllowed === true);
    const label = schemaApi?.REVIEW_TIER_LABELS?.[reviewTier] || legacyMatch.badge;

    return {
      ...legacyMatch,
      cohortId: cohort.cohortId,
      cohortLabel: cohort.label,
      cohort,
      badge: label,
      badgeTone: reviewTierTone(reviewTier),
      reviewTier,
      hardExcluded,
      flags,
      evaluations,
      trialDataQuality: trialQuality,
      patientVersion: patientFactSet.patientVersion,
      coverage: criterionCoverage(evaluations),
      relevance: {
        score: Math.max(0, Math.min(1, (supportedCount + (legacyMatch.resolvedFacts || []).length) / Math.max(1, evaluations.length + 2))),
        isProbability: false,
        components: {
          disease: legacyMatch.diseaseRelation === "MATCH" ? 1 : legacyMatch.diseaseRelation === "BROAD_QUERY" ? 0.5 : 0,
          clinicalSupport: supportedCount,
          unknown: unknownCount,
          sitePreference: legacyMatch.locationScore || 0,
          physicianPreference: legacyMatch.preferenceScore || 0
        }
      },
      reasonText: `${cohort.label}: ${legacyMatch.reasonText}`,
      sortScore: (tierBase * 10000) + (supportedCount * 100) - (unknownCount * 10) + ((legacyMatch.preferenceScore || 0) * 2) + (legacyMatch.locationScore || 0)
    };
  }

  function matchSingleTrial(trialInput, parsedQueryInput) {
    const trial = normalizeTrial(trialInput);
    const parsedQuery = parsedQueryInput || (parserApi ? parserApi.parse("") : { supported: false });

    if (!parsedQuery.supported) {
      return { included: false, excludedReason: parsedQuery.unsupportedReason || "Unsupported query." };
    }

    if ((trial.cancerType || "") !== parsedQuery.cancerType) {
      return { included: false, excludedReason: "Cancer type mismatch." };
    }

    trial.patientSearchDiseaseRelation = trialDiseaseRelation(trial, parsedQuery);

    let legacyMatch;
    if (parsedQuery.cancerType === "Prostate") {
      legacyMatch = matchProstateTrial(trial, parsedQuery);
    } else if (parsedQuery.cancerType === "Bladder") {
      legacyMatch = matchBladderTrial(trial, parsedQuery);
    } else if (parsedQuery.cancerType === "Kidney") {
      legacyMatch = matchKidneyTrial(trial, parsedQuery);
    } else if (parsedQuery.cancerType === "Testicular") {
      legacyMatch = matchTesticularTrial(trial, parsedQuery);
    } else {
      return { included: false, excludedReason: "Unsupported cancer type." };
    }
    const cohorts = schemaApi?.normalizeCohorts ? schemaApi.normalizeCohorts(trial) : [{ cohortId: `${trial.id}:unsegmented`, label: "Unsegmented trial record", sharedCriteria: [], cohortSpecificCriteria: [] }];
    const cohortMatches = cohorts.map(cohort => enrichMatchForCohort(trial, cohort, parsedQuery, legacyMatch));
    return { ...cohortMatches[0], cohortMatches, normalizedTrial: trial };
  }

  function matchTrials(options) {
    const trials = Array.isArray(options?.trials) ? options.trials : [];
    const originalParsedQuery = options?.parsedQuery || (parserApi ? parserApi.parse(options?.query || "") : { supported: false });
    const parsedQuery = originalParsedQuery?.patientFactSet && parserApi?.reconcileReviewedFacts && !originalParsedQuery.reviewReconciled
      ? parserApi.reconcileReviewedFacts(originalParsedQuery, originalParsedQuery.patientFactSet)
      : originalParsedQuery;

    const result = {
      parsedQuery,
      priorityReview: [],
      potentiallyRelevant: [],
      manualReview: [],
      modeledConflicts: [],
      diseaseContextOnly: [],
      evaluatedCohorts: [],
      auditTrail: [],
      totalCatalogRecords: trials.length,
      totalSameCancerRecords: 0,
      totalConsidered: 0
    };

    trials.forEach(trial => {
      const cancerTypes = [trial?.cancerType].concat(trial?.cancerTypes || []);
      if (!cancerTypes.includes(parsedQuery.cancerType)) {
        result.auditTrail.push({ trialId: trial?.nctId || trial?.id || "unknown", status: "NOT_EVALUATED", reason: "Cancer type mismatch." });
        return;
      }
      result.totalSameCancerRecords += 1;
      const match = matchSingleTrial(trial, parsedQuery);
      if (!match.included) {
        result.auditTrail.push({ trialId: trial?.nctId || trial?.id || "unknown", status: "NOT_EVALUATED", reason: match.excludedReason || "Unknown" });
        return;
      }
      (match.cohortMatches || [match]).forEach(cohortMatch => {
        result.totalConsidered += 1;
        const entry = { trial, match: cohortMatch };
        result.evaluatedCohorts.push(entry);
        result.auditTrail.push({
          trialId: trial?.nctId || trial?.id || "unknown",
          cohortId: cohortMatch.cohortId,
          status: "EVALUATED",
          reviewTier: cohortMatch.reviewTier,
          hardExcluded: cohortMatch.hardExcluded,
          diseaseRelation: cohortMatch.diseaseRelation,
          evaluationCount: cohortMatch.evaluations.length
        });
        if (cohortMatch.reviewTier === "PRIORITY_PROTOCOL_REVIEW") result.priorityReview.push(entry);
        else if (cohortMatch.reviewTier === "POTENTIALLY_RELEVANT") result.potentiallyRelevant.push(entry);
        else if (cohortMatch.reviewTier === "MANUAL_REVIEW_TRIAL_DATA") result.manualReview.push(entry);
        else if (cohortMatch.reviewTier === "MODELED_CONFLICT") result.modeledConflicts.push(entry);
        else result.diseaseContextOnly.push(entry);
      });
    });

    [result.priorityReview, result.potentiallyRelevant, result.manualReview, result.modeledConflicts, result.diseaseContextOnly]
      .forEach(group => group.sort((a, b) => b.match.sortScore - a.match.sortScore));
    // Compatibility aliases for older consumers. The UI no longer labels these
    // arrays as strong/possible, and no result is promoted because flags are empty.
    result.strongMatches = result.priorityReview;
    result.possibleMatches = result.potentiallyRelevant.concat(result.manualReview, result.diseaseContextOnly);
    result.conflictMatches = result.modeledConflicts;
    return result;
  }

  const api = {
    matchSingleTrial,
    matchTrials,
    trialDiseaseRelation,
    resolveSystemicWashoutDays,
    FLAG_DEFINITIONS
  };

  global.PatientTrialMatcher = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
