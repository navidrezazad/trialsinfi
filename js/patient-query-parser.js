(function (global) {
  "use strict";

  let schemaApi = global.ClinicalTrialSchema;
  let vocabularyApi = global.ClinicalVocabulary;
  if (!schemaApi && typeof require === "function") {
    try {
      schemaApi = require("./clinical-trial-schema.js");
    } catch (error) {
      schemaApi = null;
    }
  }
  if (!vocabularyApi && typeof require === "function") {
    try {
      vocabularyApi = require("./clinical-vocabulary.js");
    } catch (error) {
      vocabularyApi = null;
    }
  }

  const LEGACY_DISEASE_ID_ALIASES = Object.freeze({
    crpc_metastatic_postarpi_taxane_naive_psma_positive: "crpc_metastatic_postarpi",
    crpc_metastatic_postarpi_post_taxane: "crpc_metastatic_postarpi",
    crpc_metastatic_brca_mutated: "crpc_metastatic_postarpi",
    crpc_metastatic_hrr_mutated_nonbrca: "crpc_metastatic_postarpi",
    cspc_brca2_mutated: "cspc_general",
    cspc_high_volume_chaarted: "cspc_high_volume",
    cspc_low_volume: "cspc_general",
    crpc_neuroendocrine_small_cell: "crpc_general",
    nmibc_bcg_unresponsive_papillary_only: "nmibc_bcg_unresponsive",
    nmibc_bcg_unresponsive_cis: "nmibc_bcg_unresponsive",
    nmibc_bcg_intolerant: "nmibc_general",
    nmibc_bcg_exposed_not_unresponsive: "nmibc_general",
    metastatic_maintenance_post_platinum_nonprogressing: "metastatic_general",
    metastatic_fgfr3_altered_post_systemic: "metastatic_2l_plus",
    metastatic_1l_all_comers_ev_pembro: "metastatic_1l_general",
    metastatic_ccrcc_post_pd1_vegf_tki_belzutifan: "metastatic_ccrcc_2l_io_experienced",
    seminoma_post_chemo_residual_gt3cm_pet_timing: "seminoma_post_first_line",
    seminoma_post_chemo_residual_le3cm: "seminoma_post_first_line",
    nsgct_post_chemo_residual_mass_gt1cm_markers_normalizing: "nsgct_post_first_line",
    gct_first_salvage: "gct_advanced_general",
    gct_post_hdct_relapse: "gct_advanced_general",
    seminoma_stage1_surveillance: "seminoma_stage1",
    nsgct_stage1_lvi_positive: "nsgct_stage1",
    nsgct_stage1_lvi_negative: "nsgct_stage1"
  });

  const LOCATION_TERMS = [
    "san diego",
    "la jolla",
    "los angeles",
    "orange county",
    "orange",
    "duarte",
    "irvine",
    "newport beach",
    "loma linda",
    "ucla",
    "usc",
    "cedars",
    "city of hope",
    "hoag",
    "uc irvine",
    "uci",
    "ucsd",
    "moores",
    "scripps"
  ];

  const CANCER_SIGNALS = {
    Prostate: [
      { pattern: /\bprostate\b/i, score: 4 },
      { pattern: /\bmcrpc\b|\bnmcrpc\b|\bmcspc\b|\bmhspc\b/i, score: 5 },
      { pattern: /psma|gleason|enzalutamide|abiraterone|apalutamide|darolutamide/i, score: 3 },
      { pattern: /\bbiochemical recurrence\b|\bbcr\b/i, score: 3 }
    ],
    Bladder: [
      { pattern: /\bbladder\b|\burothelial\b|\butuc\b|upper tract urothelial|renal pelvis|ureter/i, score: 4 },
      { pattern: /\bnmibc\b|\bmibc\b|intravesical|turbt|cystectomy|trimodality|bladder[- ]sparing/i, score: 4 },
      { pattern: /\bbcg\b|carcinoma in situ|cisplatin[- ]eligible|cisplatin[- ]ineligible/i, score: 3 }
    ],
    Kidney: [
      { pattern: /\bkidney\b|renal cell carcinoma|\brcc\b/i, score: 4 },
      { pattern: /clear cell|papillary|chromophobe|collecting duct|medullary|tfe3|tfeb|translocation|non[- ]clear cell|nccrcc|hlrcc|fh[- ]deficient|vhl|imdc|nephrectomy/i, score: 4 },
      { pattern: /sarcomatoid|cabozantinib|lenvatinib|axitinib|belzutifan/i, score: 2 }
    ],
    Testicular: [
      { pattern: /\btesticular\b|\btestis\b|germ cell tumor|germ cell tumour|\bgct\b/i, score: 4 },
      { pattern: /seminoma|nonseminoma|\bnsgct\b|orchiectomy|rplnd|igcccg/i, score: 4 },
      { pattern: /afp|beta[- ]?hcg|\bhcg\b|\bldh\b|mediastinal primary|extragonadal/i, score: 2 }
    ]
  };

  function normalizeWhitespace(value) {
    return (value || "").toString().replace(/\s+/g, " ").trim();
  }

  const EXPLICIT_THERAPIES = Object.freeze([
    "adt",
    "enzalutamide",
    "abiraterone",
    "apalutamide",
    "darolutamide",
    "docetaxel",
    "cabazitaxel",
    "platinum",
    "pembrolizumab",
    "nivolumab",
    "ipilimumab",
    "cabozantinib",
    "axitinib",
    "lenvatinib",
    "olaparib",
    "rucaparib",
    "niraparib",
    "talazoparib",
    "radioligand"
  ]);

  function replaceRangeWithSpaces(characters, start, end) {
    for (let index = Math.max(0, start); index < Math.min(characters.length, end); index += 1) {
      if (!/\s/.test(characters[index])) characters[index] = " ";
    }
  }

  function buildAssertionText(text) {
    const source = String(text || "");
    // split("") preserves JavaScript UTF-16 indexing used by RegExp offsets.
    const characters = source.split("");
    const warnings = [];
    const mask = (pattern, code, message) => {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      const matcher = new RegExp(pattern.source, flags);
      let match;
      while ((match = matcher.exec(source)) !== null) {
        replaceRangeWithSpaces(characters, match.index, match.index + match[0].length);
        if (!warnings.some(item => item.code === code)) warnings.push({ code, message });
        if (match[0].length === 0) matcher.lastIndex += 1;
      }
    };

    // These contexts are preserved in the raw narrative and ignored-text audit,
    // but they cannot create patient eligibility facts.
    mask(/\bfamily history of\b[^.;\n]*/i, "family_history_excluded", "Family-history statements were not treated as facts about the patient.");
    mask(/\b(?:mother|father|sister|brother|daughter|son|grandmother|grandfather)\s+(?:has|had|was diagnosed with)\b[^.;\n]*/i, "family_history_excluded", "Family-history statements were not treated as facts about the patient.");
    mask(/\b(?:cannot|can't|could not)\s+rule\s+out\b[^.;\n]*/i, "uncertain_assertion_excluded", "Uncertain disease assertions were not treated as confirmed patient facts.");
    mask(/\b(?:possible|possibly|suspected|concern for|may have)\s+(?:new\s+)?(?:brain\s+)?(?:metastatic\s+disease|metastasis|metastases|recurrence|progression|cancer|tumou?r)\b[^.;\n]*/i, "uncertain_assertion_excluded", "Uncertain disease assertions were not treated as confirmed patient facts.");

    const therapyAlternation = EXPLICIT_THERAPIES
      .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]?"))
      .join("|");
    mask(
      new RegExp(`\\b(?:considering|planning|planned\\s+(?:for|to\\s+start)?|may\\s+start|might\\s+start|candidate\\s+for|recommended|will\\s+start|to\\s+start)\\s+(?:treatment\\s+with\\s+)?(?:${therapyAlternation})(?:\\s*(?:\\+|and|plus|/)\\s*(?:${therapyAlternation}))*\\b`, "i"),
      "planned_treatment_not_prior",
      "Planned or hypothetical treatment was not counted as prior exposure."
    );
    mask(
      new RegExp(`\\b(?:${therapyAlternation})\\s+(?:is\\s+)?(?:planned|being\\s+considered|under\\s+consideration)\\b`, "i"),
      "planned_treatment_not_prior",
      "Planned or hypothetical treatment was not counted as prior exposure."
    );

    return { text: characters.join(""), warnings };
  }

  function normalizeToken(value) {
    return normalizeWhitespace(value).toLowerCase();
  }

  function addChip(chips, group, label) {
    if (!label) {
      return;
    }

    if (!chips.some(chip => chip.group === group && chip.label === label)) {
      chips.push({ group, label });
    }
  }

  function addPreference(preferences, value) {
    if (value && !preferences.includes(value)) {
      preferences.push(value);
    }
  }

  function addUniqueValue(list, value) {
    if (value && !list.includes(value)) {
      list.push(value);
    }
  }

  function pushDiseaseIds(list, ids) {
    ids.forEach(id => {
      if (id && !list.includes(id)) {
        list.push(id);
      }
    });
  }

  function createClinicalAxes() {
    return {
      bcgStatus: "",
      cisplatinStatus: "",
      cisPapillaryPattern: "",
      castrationStatus: "",
      metastaticStatus: "",
      diseaseVolume: "",
      priorArpi: "",
      priorDocetaxel: "",
      hrrGene: "",
      fgfr3Status: "",
      fgfrAlteration: "",
      her2Status: "",
      biomarkerHrr: "",
      biomarkerLabel: "",
      psmaStatus: "",
      psmaPetPattern: "",
      prostateVolumeClass: "",
      prostateHistology: "",
      taxaneExposure: "",
      genomicClassifier: "",
      genomicClassifierLabel: "",
      adtStatus: "",
      bcgAdequacy: "",
      bcgTimingPattern: "",
      platinumStatus: "",
      perioperativeStatus: "",
      histology: "",
      imdcRisk: "",
      priorSystemicLines: "",
      priorIo: "",
      priorVegfTki: "",
      nephrectomyStatus: "",
      vhlStatus: "",
      metAlteration: "",
      sarcomatoid: "",
      clinicalStage: "",
      igcccgRisk: "",
      primarySite: "",
      priorChemoLines: "",
      priorHdct: "",
      rplndStatus: "",
      markerStatus: "",
      gctResidualMassSizeCm: "",
      gctMarkerTrend: "",
      gctSalvageLine: "",
      stage1RiskFactors: ""
    };
  }

  function createTemporalFacts() {
    return {
      sinceLastSystemicTherapyDays: null,
      sinceLastRadiationDays: null,
      sinceLastSurgeryDays: null,
      recentImagingDays: null,
      progressedAfterTherapies: [],
      persistentMarkersAfterOrchiectomy: ""
    };
  }

  function createTherapyHistory() {
    return {
      receivedTherapies: [],
      progressedOnTherapies: [],
      plannedTherapies: []
    };
  }

  function detectDemographics(text) {
    const agePatterns = [
      /\b(\d{1,3})[- ](?:year|yr)s?[- ]old\b/i,
      /\bage(?:d)?\s*(?:is|:|=)?\s*(\d{1,3})\s*(?:years?|yrs?)?\b/i,
      /\b(\d{1,3})\s*(?:yo|y\/o)\b/i
    ];
    let ageYears = null;
    for (const pattern of agePatterns) {
      const match = pattern.exec(text);
      pattern.lastIndex = 0;
      const age = match ? Number(match[1]) : NaN;
      if (Number.isInteger(age) && age >= 0 && age <= 120) {
        ageYears = age;
        break;
      }
    }

    let administrativeSex = "";
    if (/\b(?:female|woman)\b/i.test(text)) administrativeSex = "female";
    else if (/\b(?:male|man)\b/i.test(text)) administrativeSex = "male";
    return { ageYears, administrativeSex };
  }

  function createScreeningFacts() {
    return {
      ecogStatus: "",
      labState: "",
      organFunctionState: "",
      laboratoryResults: []
    };
  }

  function detectCancerType(text) {
    let bestType = "";
    let bestScore = 0;

    Object.entries(CANCER_SIGNALS).forEach(([cancerType, signals]) => {
      const score = signals.reduce((total, signal) => total + (signal.pattern.test(text) ? signal.score : 0), 0);
      if (score > bestScore) {
        bestType = cancerType;
        bestScore = score;
      }
    });

    return bestScore > 0 ? bestType : "";
  }

  function detectDiseaseContext(text) {
    const context = {
      diseaseGroup: "",
      diseaseLabel: "",
      diseaseSettingIds: []
    };

    if (/\bnmcrpc\b|m0 crpc|non[- ]metastatic castration[- ]resistant/i.test(text)) {
      context.diseaseGroup = "crpc";
      context.diseaseLabel = "nmCRPC";
      context.diseaseSettingIds = ["crpc_nonmetastatic"];
      return context;
    }

    if (/\bmcrpc\b|metastatic castration[- ]resistant/i.test(text)) {
      context.diseaseGroup = "crpc";
      context.diseaseLabel = "mCRPC";
      return context;
    }

    if (/\bmcspc\b|\bmhspc\b|metastatic castration[- ]sensitive|hormone[- ]sensitive metastatic/i.test(text)) {
      context.diseaseGroup = "cspc";
      context.diseaseLabel = "mCSPC";
      return context;
    }

    if (/\bbiochemical recurrence\b|\bbcr\b/i.test(text)) {
      context.diseaseGroup = "bcr";
      context.diseaseLabel = "Biochemical recurrence";
      if (/prostatectomy|post[- ]rp|post[- ]prostatectomy|after prostatectomy/i.test(text)) {
        context.diseaseSettingIds = ["bcr_post_rp", "bcr_general"];
      } else if (/post[- ]rt|after radiation|after rt/i.test(text)) {
        context.diseaseSettingIds = ["bcr_post_rt", "bcr_general"];
      } else {
        context.diseaseSettingIds = ["bcr_general"];
      }
      return context;
    }

    if (/unfavo[u]?rable intermediate/i.test(text)) {
      context.diseaseGroup = "localized";
      context.diseaseLabel = "Unfavorable intermediate risk";
      context.diseaseSettingIds = ["localized_unfavorable_ir", "localized_general"];
      return context;
    }

    if (/high risk|very high risk/i.test(text)) {
      context.diseaseGroup = "localized";
      context.diseaseLabel = "High / very high risk";
      context.diseaseSettingIds = ["localized_high_very_high_risk", "localized_general"];
      return context;
    }

    if (/(?:\bmetastatic\b[^.]{0,80}\bprostate\b|\bprostate\b[^.]{0,80}\bmetastatic\b)/i.test(text)) {
      context.diseaseGroup = "metastatic_unspecified";
      context.diseaseLabel = "Metastatic prostate cancer — castration state unknown";
      return context;
    }

    if (/localized|newly diagnosed prostate cancer|gleason|radiation candidate|ct2/i.test(text)) {
      context.diseaseGroup = "localized";
      context.diseaseLabel = "Localized prostate cancer";
      context.diseaseSettingIds = ["localized_general"];
      return context;
    }

    return context;
  }

  function detectArpiState(text) {
    const agents = [];
    [
      { key: "enzalutamide", pattern: /enzalutamide/i },
      { key: "abiraterone", pattern: /abiraterone/i },
      { key: "apalutamide", pattern: /apalutamide/i },
      { key: "darolutamide", pattern: /darolutamide/i }
    ].forEach(entry => {
      if (entry.pattern.test(text)) {
        agents.push(entry.key);
      }
    });

    if (/arpi[- ]naive|no prior arpi|novel hormonal naive|enzalutamide naive|abiraterone naive/i.test(text)) {
      return { value: "no", agents: [] };
    }

    if (agents.length > 0 || /post[- ]arpi|progressed on .*enzalutamide|progressed on .*abiraterone/i.test(text)) {
      return { value: "yes", agents };
    }

    return { value: "", agents: [] };
  }

  function detectDocetaxelState(text) {
    if (/no prior (docetaxel|chemo|chemotherapy)|chemo[- ]naive|chemotherapy[- ]naive|taxane[- ]naive|docetaxel[- ]naive/i.test(text)) {
      return "no";
    }

    if (/prior docetaxel|post[- ]docetaxel|after docetaxel|received docetaxel|progressed on .*docetaxel|failed docetaxel/i.test(text)) {
      return "yes";
    }

    return "";
  }

  function detectHrrState(text) {
    if (/(?:brca\s*[12]?|brca1|brca2|atm|cdk12|palb2|chek2)\s*(?:\+|positive|mutation|mutated|altered)|hrr positive|hrr mutation|hrr deficient/i.test(text)) {
      const match = text.match(/brca\s*1|brca\s*2|brca1\+?|brca2\+?|brca\+|atm(?: mutation| mutated)?|cdk12(?: mutation| mutated)?|palb2(?: mutation| mutated)?|chek2(?: mutation| mutated)?/i);
      return {
        value: "positive",
        label: match ? normalizeWhitespace(match[0]).replace(/\bmutation\b/i, "").trim() : "HRR+"
      };
    }

    if (/(?:hrr|brca(?:1|2)?|homologous recombination)[^.]{0,24}(?:wild[- ]type|negative)|(?:wild[- ]type|negative)[^.]{0,24}(?:hrr|brca(?:1|2)?|homologous recombination)/i.test(text)) {
      return { value: "negative", label: "HRR wild-type" };
    }

    return { value: "", label: "" };
  }

  function detectHrrGene(text) {
    if (/brca\s*2|brca2/i.test(text)) return "brca2";
    if (/brca\s*1|brca1/i.test(text)) return "brca1";
    if (/\batm\b/i.test(text)) return "atm";
    if (/\bcdk12\b/i.test(text)) return "cdk12";
    if (/\bpalb2\b/i.test(text)) return "palb2";
    if (/\bchek2\b/i.test(text)) return "chek2";
    if (/\bbrca\b/i.test(text)) return "brca_unspecified";
    if (/\bhrr\b|homologous recombination/i.test(text)) return "other_hrr";
    return "";
  }

  function detectPsmaState(text) {
    if (/psma[^.]{0,24}(confirmed|positive|avid)|psma[- ]avid|psma positive/i.test(text)) {
      return "positive";
    }

    if (/psma negative/i.test(text)) {
      return "negative";
    }

    return "";
  }

  function detectPsmaPetPattern(text) {
    if (/dominant[^.;,\n]{0,30}psma[- ]negative|psma[- ]negative[^.;,\n]{0,30}dominant|discordant[^.;,\n]{0,30}(fdg|psma)/i.test(text)) {
      return "dominant_psma_negative_lesion";
    }
    if (/psma[^.]{0,24}(confirmed|positive|avid)|psma[- ]avid|psma positive/i.test(text)) {
      return "positive";
    }
    if (/psma negative/i.test(text)) {
      return "negative";
    }
    return "";
  }

  function detectGenomicClassifier(text) {
    const brandMatch = text.match(/decipher|oncotype gps|oncotype|prolaris|artera ai|artera|genomic risk classifier|genomic classifier/i);
    if (brandMatch) {
      return {
        value: "available",
        label: normalizeWhitespace(brandMatch[0])
      };
    }

    const scoreMatch = text.match(/(?:genomic|decipher|oncotype|prolaris|artera)[^.]{0,24}score[: ]+([0-9]+(?:\.[0-9]+)?)/i);
    if (scoreMatch) {
      return {
        value: "available",
        label: `Genomic score ${scoreMatch[1]}`
      };
    }

    return { value: "", label: "" };
  }

  function detectDiseaseVolume(text) {
    text = text.replace(/\b(?:no|without|absent)\b[^.;\n]{0,25}(?:liver|lung|visceral)\s+(?:metastases|mets|disease|nodules?)/gi, '');
    if (/oligometastatic|oligo[- ]metastatic/i.test(text)) {
      return "oligometastatic";
    }

    if (/high[- ]volume|high[- ]burden/i.test(text)) {
      return "high_volume";
    }

    if (/low[- ]volume|low[- ]burden/i.test(text)) {
      return "low_volume";
    }

    if (/(?:visceral (?:metastases|disease)|liver metastases|lung metastases)/i.test(text) && !/(?:no|without|absent)[^.]{0,20}visceral (?:metastases|disease)/i.test(text)) {
      return "high_volume";
    }

    const boneMatch = text.match(/(\d+)\s+(?:bone mets?|bone metastases|bone lesions?)/i);
    if (boneMatch) {
      const count = Number(boneMatch[1]);
      if (Number.isFinite(count)) {
        if (count >= 4) {
          if (/(?:rib|femur|humerus|skull|calvarium|appendicular|beyond (?:the )?(?:spine|vertebral bodies|pelvis))/i.test(text)) {
            return "high_volume";
          }
          if (/(?:confined|limited) to (?:the )?(?:spine|vertebral bodies)(?: and |\/)(?:the )?pelvis|no visceral disease/i.test(text)) {
            return "low_volume";
          }
          return "possible_high_volume";
        }
        if (count > 0 && count <= 3) {
          return "low_volume";
        }
      }
    }

    if (/(lung|liver|visceral).{0,18}(met|mets|metastases|nodule)/i.test(text)) {
      return "high_volume";
    }

    return "";
  }

  function detectProstateVolumeClass(text) {
    text = text.replace(/\b(?:no|without|absent)\b[^.;\n]{0,25}(?:liver|lung|visceral)\s+(?:metastases|mets|disease|nodules?)/gi, '');
    if (/oligometastatic|oligo[- ]metastatic/i.test(text)) {
      return "oligometastatic";
    }

    if (/low[- ]volume|low[- ]burden/i.test(text)) {
      return "low_volume";
    }

    if (/high[- ]volume|high[- ]burden|visceral[^.;,\n]{0,24}(met|mets|metastases)|(?:lung|liver)[^.;,\n]{0,24}(met|mets|metastases)/i.test(text)) {
      return "high_volume_chaarted";
    }

    const boneMatch = text.match(/(\d+)\s+(?:bone mets?|bone metastases|bone lesions?)/i);
    if (boneMatch) {
      const count = Number(boneMatch[1]);
      if (Number.isFinite(count)) {
        if (count <= 3 && /no visceral|without visceral/i.test(text)) {
          return "low_volume";
        }
        if (count >= 4 && /(rib|skull|humerus|femur|long bone|appendicular|outside (?:spine|vertebral|pelvis)|beyond (?:spine|vertebral|pelvis))/i.test(text)) {
          return "high_volume_chaarted";
        }
        if (count >= 4) {
          return "possible_high_volume";
        }
      }
    }

    return "";
  }

  function detectProstateHistology(text) {
    if (/small[- ]cell/i.test(text)) return "small_cell";
    if (/neuroendocrine|\bnepc\b/i.test(text)) return "neuroendocrine";
    if (/aggressive[- ]variant|anaplastic/i.test(text)) return "aggressive_variant";
    if (/mixed[^.;,\n]{0,24}(adenocarcinoma|small[- ]cell|neuroendocrine)/i.test(text)) return "mixed";
    if (/adenocarcinoma/i.test(text)) return "adenocarcinoma";
    return "";
  }

  function detectTaxaneExposure(text) {
    if (/no prior (docetaxel|taxane|chemo|chemotherapy)|taxane[- ]naive|docetaxel[- ]naive|chemo[- ]naive|chemotherapy[- ]naive/i.test(text)) {
      return "none";
    }
    if (/cabazitaxel/i.test(text)) {
      return "cabazitaxel";
    }
    if (/\bmcrpc\b|metastatic castration[- ]resistant/i.test(text) && /progress(?:ed|ion)?\s+(?:on|after|following)[^.;,\n]{0,40}docetaxel/i.test(text)) {
      return "docetaxel_mcrpc";
    }
    if (/docetaxel[^.;,\n]{0,40}(mcrpc|castration[- ]resistant)|mcrpc[^.;,\n]{0,40}docetaxel/i.test(text)) {
      return "docetaxel_mcrpc";
    }
    if (/docetaxel[^.;,\n]{0,40}(mhspc|mcspc|hormone[- ]sensitive|castration[- ]sensitive)|(?:mhspc|mcspc|hormone[- ]sensitive|castration[- ]sensitive)[^.;,\n]{0,40}docetaxel/i.test(text)) {
      return "docetaxel_mhspc";
    }
    if (/prior docetaxel|post[- ]docetaxel|after docetaxel|received docetaxel|progressed on .*docetaxel|failed docetaxel|taxane/i.test(text)) {
      return "docetaxel_unspecified";
    }
    return "";
  }

  function detectAdtState(text) {
    if (/adt[- ]naive|no prior adt|no prior androgen deprivation/i.test(text)) {
      return "naive";
    }

    if (/prior adt|received adt|on adt/i.test(text)) {
      return "prior";
    }

    return "";
  }

  function durationMatchToDays(match) {
    if (!match) {
      return null;
    }

    const amount = Number(match[1]);
    const unit = (match[2] || "").toLowerCase();
    if (!Number.isFinite(amount)) {
      return null;
    }

    if (unit.startsWith("day") || unit === "d") {
      return amount;
    }
    if (unit.startsWith("week") || unit.startsWith("wk") || unit === "w") {
      return amount * 7;
    }
    if (unit.startsWith("month") || unit.startsWith("mo")) {
      return amount * 30;
    }
    return null;
  }

  function extractRelativeDays(text, patterns) {
    for (const pattern of patterns) {
      const days = durationMatchToDays(text.match(pattern));
      if (days !== null) {
        return days;
      }
    }
    return null;
  }

  function normalizeTherapyLabel(raw) {
    const token = normalizeToken(raw).replace(/[^a-z0-9]+/g, " ").trim();
    if (!token) return "";
    if (token.includes("androgen deprivation") || token.includes("adt") || token.includes("lhrh") || token.includes("gnrh") || token.includes("leuprolide") || token.includes("goserelin") || token.includes("degarelix") || token.includes("relugolix")) return "adt";
    if (token.includes("enzalutamide")) return "enzalutamide";
    if (token.includes("abiraterone")) return "abiraterone";
    if (token.includes("apalutamide")) return "apalutamide";
    if (token.includes("darolutamide")) return "darolutamide";
    if (token.includes("arpi") || token.includes("androgen receptor pathway inhibitor") || token.includes("novel hormonal")) return "arpi";
    if (token.includes("docetaxel")) return "docetaxel";
    if (token.includes("cabazitaxel")) return "cabazitaxel";
    if (token.includes("taxane")) return "taxane";
    if (token.includes("platinum") || token.includes("cisplatin") || token.includes("carboplatin")) return "platinum";
    if (token.includes("pembrolizumab")) return "pembrolizumab";
    if (token.includes("nivolumab")) return "nivolumab";
    if (token.includes("ipilimumab")) return "ipilimumab";
    if (token.includes("io") || token.includes("immunotherapy")) return "immunotherapy";
    if (token.includes("cabozantinib")) return "cabozantinib";
    if (token.includes("axitinib")) return "axitinib";
    if (token.includes("lenvatinib")) return "lenvatinib";
    if (token.includes("olaparib")) return "olaparib";
    if (token.includes("rucaparib")) return "rucaparib";
    if (token.includes("niraparib")) return "niraparib";
    if (token.includes("talazoparib")) return "talazoparib";
    if (token.includes("parp")) return "parp";
    if (token.includes("radioligand") || token.includes("lutetium") || token.includes("177lu") || token.includes("lu psma") || token.includes("psma 617")) return "radioligand";
    if (token.includes("systemic therapy") || token.includes("therapy") || token.includes("treatment")) return "systemic therapy";
    return token;
  }

  function addTherapy(list, value) {
    const normalized = normalizeTherapyLabel(value);
    addUniqueValue(list, normalized);
  }

  function splitTherapyCandidates(raw) {
    return normalizeWhitespace(raw)
      .replace(/\bplus\b/ig, " and ")
      .replace(/[+/]/g, " and ")
      .split(/\s*(?:,|\band\b|&)\s*/i)
      .map(candidate => normalizeTherapyLabel(candidate))
      .filter(Boolean);
  }

  function detectProgressedAfterTherapies(text) {
    const therapies = [];
    const patterns = [
      /progress(?:ed|ion)?\s+(?:on|after|following)\s+([a-z0-9+\/ -]{3,40})/ig,
      /(?:failed|failure of)\s+([a-z0-9+\/ -]{3,40})/ig
    ];
    const stopTokens = /\b(with|without|who|after|before|for|while|because|due|no prior|phase|trial)\b/i;

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        let raw = normalizeWhitespace(match[1] || "");
        if (!raw) {
          continue;
        }
        raw = raw.split(/[,.;]/)[0];
        const stop = raw.match(stopTokens);
        if (stop && stop.index > 0) {
          raw = raw.slice(0, stop.index);
        }
        splitTherapyCandidates(raw).forEach(therapy => addTherapy(therapies, therapy));
      }
    });

    return therapies;
  }

  function hasExplicitNegativeTherapyContext(text, therapy) {
    const escaped = therapy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]?");
    return new RegExp(`(?:no(?: prior)?|without(?: prior)?|never received|not previously treated with|naive to)[^.;,\\n]{0,24}${escaped}`, "i").test(text)
      || new RegExp(`${escaped}[- ]naive`, "i").test(text);
  }

  function detectExplicitTherapyMentions(text) {
    const mentions = [];
    EXPLICIT_THERAPIES.forEach(therapy => {
      const escaped = therapy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]?");
      if (!hasExplicitNegativeTherapyContext(text, therapy) && new RegExp(escaped, "i").test(text)) {
        addTherapy(mentions, therapy);
      }
    });

    return mentions;
  }

  function detectPlannedTherapyMentions(text) {
    const mentions = [];
    EXPLICIT_THERAPIES.forEach(therapy => {
      const escaped = therapy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]?");
      const before = new RegExp(`\\b(?:considering|planning|planned\\s+(?:for|to\\s+start)?|may\\s+start|might\\s+start|candidate\\s+for|recommended|will\\s+start|to\\s+start)\\s+(?:treatment\\s+with\\s+)?${escaped}\\b`, "i");
      const after = new RegExp(`\\b${escaped}\\s+(?:is\\s+)?(?:planned|being\\s+considered|under\\s+consideration)\\b`, "i");
      const combination = new RegExp(`\\b(?:considering|planning|may start|will start)\\s+[^.;\\n]{0,80}(?:\\+|and|plus|/)\\s*${escaped}\\b`, 'i');
      if (before.test(text) || after.test(text) || combination.test(text)) addTherapy(mentions, therapy);
    });
    return mentions;
  }

  function detectSinceLastSystemicTherapyDays(text) {
    return extractRelativeDays(text, [
      /last\s+(?:systemic therapy|therapy|treatment|study drug|platinum|cisplatin|carboplatin|docetaxel|enzalutamide|abiraterone|apalutamide|darolutamide)[^.;,\n]{0,24}?(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+ago/i,
      /(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+(?:since|after)\s+(?:last\s+)?(?:systemic therapy|therapy|treatment|study drug|platinum|cisplatin|carboplatin|docetaxel|enzalutamide|abiraterone|apalutamide|darolutamide)/i,
      /stopped\s+(?:therapy|treatment|study drug)[^.;,\n]{0,20}?(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+ago/i
    ]);
  }

  function detectSinceLastRadiationDays(text) {
    return extractRelativeDays(text, [
      /last\s+(?:radiation|radiotherapy|rt|xrt)[^.;,\n]{0,20}?(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+ago/i,
      /(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+(?:since|after)\s+(?:last\s+)?(?:radiation|radiotherapy|rt|xrt)/i
    ]);
  }

  function detectSinceLastSurgeryDays(text) {
    return extractRelativeDays(text, [
      /last\s+(?:surgery|prostatectomy|cystectomy|nephrectomy|orchiectomy|rplnd)[^.;,\n]{0,20}?(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+ago/i,
      /(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+(?:since|after)\s+(?:last\s+)?(?:surgery|prostatectomy|cystectomy|nephrectomy|orchiectomy|rplnd)/i
    ]);
  }

  function detectRecentImagingDays(text) {
    return extractRelativeDays(text, [
      /(?:psma pet|pet\/ct|pet ct|ct scan|mri|restaging imaging|imaging)[^.;,\n]{0,20}?(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+ago/i,
      /(\d+)\s*(days?|d|weeks?|wks?|months?|mos?)\s+(?:since|after)\s+(?:psma pet|pet\/ct|pet ct|ct scan|mri|restaging imaging|imaging)/i
    ]);
  }

  function detectPersistentMarkersAfterOrchiectomy(text) {
    const markerToken = /(afp|beta[- ]?hcg|hcg|ldh|markers?)/i;
    const persistenceToken = /(persist(?:ent|ently)|remain(?:s|ed)? elevated|elevated)/i;
    if ((/after orchiectomy/i.test(text) && markerToken.test(text) && persistenceToken.test(text))
      || /(persist(?:ent|ently)|remain(?:s|ed)? elevated).{0,24}(afp|beta[- ]?hcg|hcg|ldh|markers?)/i.test(text)) {
      return "yes";
    }
    return "";
  }

  function detectEcogStatus(text) {
    const explicitMatch = text.match(/\b(?:eastern cooperative oncology group|ecog|performance status|ps)\s*(?:of\s*)?([0-4])(?:\s*(?:-|to|or|\/)\s*([0-4]))?\b/i);
    if (explicitMatch) {
      const low = Number.parseInt(explicitMatch[1], 10);
      const high = explicitMatch[2] ? Number.parseInt(explicitMatch[2], 10) : low;
      const max = Number.isFinite(high) ? Math.max(low, high) : low;
      if (max >= 3) return "ecog_3_4";
      if (max === 2) return "ecog_2";
      if (max === 1) return "ecog_1";
      if (max === 0) return "ecog_0";
    }

    if (/bedbound|wheelchair[- ]bound|limited self[- ]care|poor performance status/i.test(text)) {
      return "ecog_3_4";
    }

    return "";
  }

  function detectLabState(text) {
    if (/\b(?:labs?|cbc|cmp|hematologic(?:al)? (?:function|profile)|bone marrow function)\b[^.]{0,24}\b(?:not normal|abnormal|not within normal limits|inadequate)\b|\b(?:not normal|abnormal) (?:cbc|cmp|hemoglobin|platelets|anc)\b/i.test(text)) {
      return "abnormal_unspecified";
    }

    if (/\b(?:labs?|cbc|cmp|hematologic(?:al)? (?:function|profile)|bone marrow function)\b[^.]{0,24}\b(?:normal|wnl|within normal limits|adequate|acceptable)\b|normal (?:cbc|cmp|hemoglobin|platelets|anc)\b/i.test(text)) {
      return "within_range";
    }

    if (/severe cytopenia|pancytopenia|transfusion[- ]dependent|anc\s*(?:<|below)\s*1000|platelets?\s*(?:<|below)\s*(?:75(?:,?000)?|75000)|hemoglobin\s*(?:<|below)\s*8\b/i.test(text)) {
      return "markedly_abnormal";
    }

    if (/mild(?:ly)? abnormal labs?|mild anemia|mild thrombocytopenia|mild neutropenia|moderate thrombocytopenia|moderate anemia/i.test(text)) {
      return "mildly_abnormal";
    }

    return "";
  }

  function normalizeLabDate(sourceText) {
    const match = String(sourceText || "").match(/(?:\bon\b|\bas of\b|\bdated\b)?\s*(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/i);
    if (!match) return null;
    const normalized = match[1].replace(/\//g, "-");
    const date = new Date(`${normalized}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function normalizeLabAmount(amountText, unitText, family) {
    const amount = Number(String(amountText || "").replace(/,/g, ""));
    if (!Number.isFinite(amount)) return null;
    const unit = String(unitText || "").toLowerCase().replace(/\s+/g, "");
    if (family === "cell_count") {
      if (/10\^?9|10⁹|x10|×10|k\/?(?:ul|µl)/i.test(unit)) {
        return { value: amount * 1000, unit: "cells/uL", normalization: `${amountText} ${unitText} converted to cells/uL` };
      }
      return { value: amount, unit: "cells/uL", normalization: null };
    }
    if (family === "uln_ratio") return { value: amount, unit: "xULN", normalization: null };
    return { value: amount, unit: String(unitText || "").replace(/\s+/g, " ").trim(), normalization: null };
  }

  function detectNumericLabResults(text) {
    const source = String(text || "");
    const specs = [
      { concept: "hemoglobinGdl", display: "Hemoglobin", family: "absolute", names: "(?:hemoglobin|hgb)", units: "(?:g\\s*\\/\\s*dL)" },
      { concept: "absoluteNeutrophilCount", display: "Absolute neutrophil count", family: "cell_count", names: "(?:absolute\\s+neutrophil\\s+count|ANC)", units: "(?:cells?\\s*\\/\\s*(?:uL|µL|mm3|mm\\^3)|\\/\\s*(?:uL|µL|mm3|mm\\^3)|[Kk]\\s*\\/\\s*(?:uL|µL)|(?:x|×)\\s*10\\s*(?:\\^?9|⁹)\\s*\\/\\s*L)" },
      { concept: "plateletCount", display: "Platelet count", family: "cell_count", names: "(?:platelet(?:s|\\s+count)?)", units: "(?:cells?\\s*\\/\\s*(?:uL|µL|mm3|mm\\^3)|\\/\\s*(?:uL|µL|mm3|mm\\^3)|[Kk]\\s*\\/\\s*(?:uL|µL)|(?:x|×)\\s*10\\s*(?:\\^?9|⁹)\\s*\\/\\s*L)" },
      { concept: "totalBilirubinMgDl", display: "Total bilirubin", family: "absolute", names: "(?:total\\s+bilirubin|bilirubin)", units: "(?:mg\\s*\\/\\s*dL)" },
      { concept: "totalBilirubinUlnRatio", display: "Total bilirubin (ULN ratio)", family: "uln_ratio", names: "(?:total\\s+bilirubin|bilirubin)", units: "(?:(?:x|×)\\s*(?:the\\s+)?ULN)" },
      { concept: "astUnitsL", display: "AST", family: "absolute", names: "(?:AST|aspartate\\s+aminotransferase)", units: "(?:U\\s*\\/\\s*L)" },
      { concept: "astUlnRatio", display: "AST (ULN ratio)", family: "uln_ratio", names: "(?:AST|aspartate\\s+aminotransferase)", units: "(?:(?:x|×)\\s*(?:the\\s+)?ULN)" },
      { concept: "altUnitsL", display: "ALT", family: "absolute", names: "(?:ALT|alanine\\s+aminotransferase)", units: "(?:U\\s*\\/\\s*L)" },
      { concept: "altUlnRatio", display: "ALT (ULN ratio)", family: "uln_ratio", names: "(?:ALT|alanine\\s+aminotransferase)", units: "(?:(?:x|×)\\s*(?:the\\s+)?ULN)" },
      { concept: "creatinineClearanceMlMin", display: "Creatinine clearance", family: "absolute", names: "(?:creatinine\\s+clearance|CrCl)", units: "(?:mL\\s*\\/\\s*min(?:\\s*\\/\\s*1\\.73\\s*m2)?)" },
      { concept: "egfrMlMin", display: "eGFR", family: "absolute", names: "(?:eGFR|estimated\\s+glomerular\\s+filtration\\s+rate)", units: "(?:mL\\s*\\/\\s*min(?:\\s*\\/\\s*1\\.73\\s*m2)?)" },
      { concept: "serumCreatinineMgDl", display: "Serum creatinine", family: "absolute", names: "(?:serum\\s+creatinine|creatinine)", units: "(?:mg\\s*\\/\\s*dL)" }
    ];
    const results = [];
    specs.forEach(spec => {
      const pattern = new RegExp(`\\b${spec.names}\\b\\s*(?:is|of|=|:)?\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?)\\s*(${spec.units})`, "gi");
      let match;
      while ((match = pattern.exec(source))) {
        const normalized = normalizeLabAmount(match[1], match[2], spec.family);
        if (!normalized) continue;
        const nearby = source.slice(Math.max(0, match.index - 24), Math.min(source.length, match.index + match[0].length + 32));
        results.push({
          concept: spec.concept,
          display: spec.display,
          value: normalized.value,
          unit: normalized.unit,
          normalization: normalized.normalization,
          observedAt: normalizeLabDate(nearby),
          sourceSpan: schemaApi?.makeSourceSpan
            ? schemaApi.makeSourceSpan(match[0], match.index, match.index + match[0].length)
            : { field: "patientNarrative", text: match[0], start: match.index, end: match.index + match[0].length }
        });
      }
    });
    return results.sort((left, right) => left.sourceSpan.start - right.sourceSpan.start);
  }

  function detectOrganFunctionState(text) {
    if (/adequate organ function|normal renal and hepatic function|renal function (?:normal|adequate)|hepatic function (?:normal|adequate)|lfts? (?:normal|wnl)|bilirubin normal|creatinine clearance\s*(?:>=|≥|>|above)\s*60|crcl\s*(?:>=|≥|>|above)\s*60|e?gfr\s*(?:>=|≥|>|above)\s*60/i.test(text)) {
      return "adequate";
    }

    if (/dialysis|hemodialysis|end[- ]stage renal disease|esrd|severe renal impairment|severe hepatic dysfunction|bilirubin\s*(?:>=|≥|>|above)\s*3|creatinine clearance\s*(?:<=|≤|<|below)\s*30|crcl\s*(?:<=|≤|<|below)\s*30|e?gfr\s*(?:<=|≤|<|below)\s*30/i.test(text)) {
      return "marked_impairment";
    }

    if (/mild renal impairment|moderate renal impairment|renal insufficiency|mild hepatic impairment|moderate hepatic impairment|mild transaminitis|bilirubin\s*(?:>=|≥|>|above)\s*1\.5/i.test(text)) {
      return "mild_impairment";
    }

    return "";
  }

  function detectBcgStatus(text) {
    if (/bcg[- ]unresponsive|bcg[- ]refractory|bcg[- ]resistant|after adequate bcg/i.test(text)) {
      return "BCG-Unresponsive";
    }
    if (/bcg[- ]intolerant|intolerant.*bcg|unable to tolerate bcg|unable to receive bcg/i.test(text)) {
      return "BCG-Intolerant";
    }
    if (/bcg[- ]naive|no prior bcg|bcg eligible|bcg treatment naive/i.test(text)) {
      return "BCG-Naive";
    }
    return "";
  }

  function detectBcgAdequacy(text) {
    if (/\badequate bcg|induction plus maintenance|at least 5 of 6 induction|2 of 3 maintenance|two induction courses/i.test(text)) {
      return "adequate";
    }
    if (/inadequate bcg|only \d+ (?:dose|doses)|partial bcg|incomplete bcg/i.test(text)) {
      return "inadequate";
    }
    return "";
  }

  function detectBcgTimingPattern(text) {
    if (/bcg[- ]unresponsive/i.test(text)) return "unresponsive";
    if (/bcg[- ]refractory|persistent.*after.*bcg/i.test(text)) return "refractory";
    if (/bcg[- ]relapsing|recurrent.*after.*bcg/i.test(text)) return "relapsing";
    if (/bcg[- ]intolerant|intolerant.*bcg|unable to tolerate bcg/i.test(text)) return "intolerant";
    if (/bcg[- ]naive|no prior bcg|bcg treatment naive/i.test(text)) return "naive";
    if (/failed bcg|bcg failure|after bcg|post[- ]bcg|bcg exposed/i.test(text)) return "exposed_not_unresponsive";
    return "";
  }

  function detectCisplatinStatus(text) {
    if (/cisplatin[- ]ineligible|cisplatin[- ]unfit|ineligible for cisplatin|unable to receive cisplatin|not eligible for cisplatin/i.test(text)) {
      return "Cisplatin-Ineligible";
    }
    if (/cisplatin[- ]eligible|cisplatin[- ]fit|eligible for cisplatin|fit for cisplatin/i.test(text)) {
      return "Cisplatin-Eligible";
    }
    return "";
  }

  function detectCisPapillaryPattern(text) {
    const hasCis = /carcinoma in situ|\bcis\b/i.test(text);
    const hasPapillary = /papillary|high[- ]grade ta|high[- ]grade t1|hg ta|hg t1/i.test(text);

    if (hasCis && hasPapillary) {
      return "cis_plus_papillary";
    }
    if (hasCis) {
      return "cis_only";
    }
    if (hasPapillary) {
      return "papillary_only";
    }
    return "";
  }

  function detectFgfr3Status(text) {
    if (/fgfr3.{0,32}(?:wild[- ]type|negative|mutation negative|not detected)|no fgfr3 alteration|without fgfr3 alteration/i.test(text)) {
      return "wild_type";
    }
    if (/fgfr3.{0,24}(susceptible alteration|mutation|mutated|fusion|altered|positive)|erdafitinib candidate|fgfr inhibitor candidate/i.test(text)) {
      return "susceptible_alteration";
    }
    return "";
  }

  function detectFgfrAlteration(text) {
    if (/fgfr3.{0,24}(fusion|rearrangement)/i.test(text)) return "fgfr3_fusion";
    if (/fgfr3.{0,24}(mutation|mutated|altered|susceptible alteration|positive)|erdafitinib candidate/i.test(text)) return "fgfr3_mutation";
    if (/fgfr2/i.test(text)) return "fgfr2";
    if (/fgfr.{0,24}(mutation|mutated|altered|alteration|fusion|positive)/i.test(text)) return "fgfr_unspecified";
    if (/fgfr.{0,24}(wild[- ]type|negative)|no fgfr alteration/i.test(text)) return "fgfr_negative";
    return "";
  }

  function detectPlatinumStatus(text) {
    if (/stable after (?:first[- ]line )?(?:platinum|gem[/-]cis|gem[/-]carbo|gemcitabine[- \/](?:cisplatin|carboplatin))|respond(?:ed|ing|er)? after (?:first[- ]line )?(?:platinum|gem[/-]cis|gem[/-]carbo)|no progression after (?:first[- ]line )?(?:platinum|gem[/-]cis|gem[/-]carbo)/i.test(text)) {
      return "post_platinum_nonprogressing";
    }
    if (/progress(?:ed|ion)? (?:on|after|following) (?:platinum|cisplatin|carboplatin|gem[/-]cis|gem[/-]carbo)|platinum[- ]refractory|platinum[- ]resistant/i.test(text)) {
      return "post_platinum_progressed";
    }
    if (/post[- ]platinum|prior platinum|after prior platinum|received platinum|platinum exposed/i.test(text)) {
      return "platinum_exposed";
    }
    if (/platinum[- ]ineligible|unable to receive platinum/i.test(text)) {
      return "platinum_ineligible";
    }
    if (/carboplatin[- ]eligible|carbo[- ]eligible/i.test(text)) {
      return "carbo_eligible";
    }
    if (/cisplatin[- ]ineligible|cisplatin[- ]unfit|ineligible for cisplatin/i.test(text)) {
      return "cis_ineligible";
    }
    if (/cisplatin[- ]eligible|cisplatin[- ]fit|eligible for cisplatin|fit for cisplatin/i.test(text)) {
      return "cis_eligible";
    }
    return "";
  }

  function detectPerioperativeStatus(text) {
    if (/trimodality|bladder[- ]sparing|bladder[- ]preservation|\btmt\b|chemoradiation/i.test(text)) return "trimodality_candidate";
    if (/post[- ]cystectomy|after cystectomy|adjuvant/i.test(text)) return "post_cystectomy";
    if (/cystectomy planned|radical cystectomy planned|planning cystectomy/i.test(text)) return "cystectomy_planned";
    if (/neoadjuvant|pre[- ]cystectomy|before cystectomy|perioperative/i.test(text)) return "neoadjuvant_candidate";
    return "";
  }

  function detectHer2Status(text) {
    if (/\bher2\b.{0,12}(ihc\s*)?3\+|\berbb2\b.{0,24}(3\+|high|positive)|her2 overexpress/i.test(text)) {
      return "ihc_3_plus";
    }
    if (/\bher2\b.{0,12}(ihc\s*)?2\+|\berbb2\b.{0,24}2\+/i.test(text)) {
      return "ihc_2_plus";
    }
    if (/\bher2\b.{0,16}(equivocal)|\berbb2\b.{0,16}(equivocal)/i.test(text)) {
      return "equivocal";
    }
    if (/\bher2\b.{0,12}(0|1\+|negative|low)|\berbb2\b.{0,24}(negative|low)|her2 low/i.test(text)) {
      return "negative_or_low";
    }
    return "";
  }

  function detectKidneyHistology(text) {
    if (/unclassified/i.test(text)) {
      return "unclassified";
    }
    if (/non[- ]clear[- ]cell|nccrcc/i.test(text)) {
      return "non_clear_cell";
    }
    if (/clear[- ]cell|ccrcc/i.test(text)) {
      return "clear_cell";
    }
    if (/papillary.{0,20}(type[\s-]*1|type i)|type[\s-]*1.{0,20}papillary|met[- ]driven papillary|hereditary papillary/i.test(text)) {
      return "papillary_type1";
    }
    if (/papillary.{0,20}(type[\s-]*2|type ii)|type[\s-]*2.{0,20}papillary|hlrcc|fh[- ]deficient/i.test(text)) {
      return "papillary_type2";
    }
    if (/papillary|\bprcc\b/i.test(text)) {
      return "papillary_unspecified";
    }
    if (/chromophobe/i.test(text)) {
      return "chromophobe";
    }
    if (/renal medullary|medullary carcinoma|medullary rcc|smarcb1|ini1[- ]deficient|sickle cell trait/i.test(text)) {
      return "medullary";
    }
    if (/collecting duct/i.test(text)) {
      return "collecting_duct";
    }
    if (/tfe3|tfeb|xp11|mit family|translocation/i.test(text)) {
      return "tfe3_tfeb_translocation";
    }
    return "";
  }

  function detectImdcRisk(text) {
    if (/intermediate[- /]poor|intermediate\s+or\s+poor/i.test(text)) {
      return "intermediate_poor";
    }
    if (/imdc.{0,12}favorable|favo[u]?rable risk|good risk metastatic rcc/i.test(text)) {
      return "favorable";
    }
    if (/imdc.{0,12}intermediate|intermediate risk/i.test(text)) {
      return "intermediate";
    }
    if (/imdc.{0,12}poor|poor risk/i.test(text)) {
      return "poor";
    }
    return "";
  }

  function detectPriorSystemicLines(text) {
    if (/third[- ]line|3rd[- ]line|heavily pretreated|multiple prior lines|two prior lines|2 prior lines|>= ?2 prior lines/i.test(text)) {
      return "2+";
    }
    if (/second[- ]line|2nd[- ]line|one prior line|1 prior line|after one prior line|after first[- ]line|post[- ]platinum|prior platinum|after platinum|post[- ]io|previously treated/i.test(text)) {
      return "1";
    }
    if (/treatment[- ]naive|systemic[- ]naive|no prior systemic therapy|untreated metastatic/i.test(text)) {
      return "0";
    }
    if (/(^|[^a-z])(first[- ]line|1st[- ]line)([^a-z]|$)/i.test(text) && !/after first[- ]line|post[- ]first[- ]line/i.test(text)) {
      return "0";
    }
    return "";
  }

  function detectPriorIo(text) {
    if (/io[- ]naive|no prior io|no prior immunotherapy|no prior pd-?1|no prior pd-?l1|no prior (?:nivolumab|pembrolizumab|ipilimumab|atezolizumab|avelumab|durvalumab)/i.test(text)) {
      return "no";
    }
    if (/prior io|prior immunotherapy|prior pd-?1|prior pd-?l1|received nivolumab|received pembrolizumab|received ipilimumab|post[- ]io|after (?:nivolumab|pembrolizumab|ipilimumab)|progressed on (?:nivolumab|pembrolizumab|ipilimumab)|\b(?:nivolumab|pembrolizumab|ipilimumab)\b/i.test(text)) {
      return "yes";
    }
    return "";
  }

  function detectPriorVegfTki(text) {
    if (/vegf[- ]tki[- ]naive|tki[- ]naive|no prior vegf|no prior tki|no prior vegf\/tki|no prior (?:cabozantinib|axitinib|lenvatinib|sunitinib|pazopanib|tivozanib)/i.test(text)) {
      return "no";
    }
    if (/prior vegf|prior tki|prior vegf\/tki|received cabozantinib|received axitinib|received lenvatinib|received sunitinib|received pazopanib|post[- ]tki|after (?:cabozantinib|axitinib|lenvatinib|sunitinib|pazopanib)|progressed on (?:cabozantinib|axitinib|lenvatinib|sunitinib|pazopanib)|\b(?:cabozantinib|axitinib|lenvatinib|sunitinib|pazopanib)\b/i.test(text)) {
      return "yes";
    }
    return "";
  }

  function detectNephrectomyStatus(text) {
    if (/post[- ]nephrectomy|after nephrectomy|prior nephrectomy|status post nephrectomy|s\/p nephrectomy|resected primary/i.test(text)) {
      return "prior_nephrectomy";
    }
    if (/cytoreductive nephrectomy candidate|candidate for cn|unresected primary|primary in place/i.test(text)) {
      return "cytoreductive_candidate";
    }
    if (/not a nephrectomy candidate|not candidate for nephrectomy|unfit for nephrectomy/i.test(text)) {
      return "no_nephrectomy_not_candidate";
    }
    return "";
  }

  function detectVhlStatus(text) {
    if (/(?:germline|hereditary)[^.]{0,24}(?:vhl|von hippel[- ]lindau)|(?:vhl|von hippel[- ]lindau)[^.]{0,24}(?:germline|hereditary|disease|syndrome)/i.test(text)) return "vhl_disease_germline";
    if (/(?:somatic|tumou?r)[^.]{0,24}vhl|vhl[^.]{0,24}(?:somatic|tumou?r mutation|loss|inactivation)/i.test(text)) return "somatic_vhl_mutation";
    if (/von hippel[- ]lindau|\bvhl\b.{0,16}(mut|altered|associated|disease)|vhl-associated/i.test(text)) return "vhl_unspecified";
    return "";
  }

  function detectMetAlteration(text) {
    if (/\bmet\b.{0,16}(mutation|mutated|altered)/i.test(text)) {
      return "met_mutation";
    }
    if (/\bmet\b.{0,16}(amplified|amplification)/i.test(text)) {
      return "met_amplification";
    }
    return "";
  }

  function detectSarcomatoid(text) {
    if (/sarcomatoid/i.test(text)) {
      return "yes";
    }
    return "";
  }

  function detectTesticularHistology(text) {
    if (/mixed germ cell|mixed nonseminoma|mixed[^.;,\n]{0,32}seminoma[^.;,\n]{0,32}(?:nsgct|non[- ]?seminomatous)|seminoma\s+(?:and|with)\s+non[- ]?seminomatous/i.test(text)) {
      return "mixed_seminoma_nsgct";
    }
    if (/pure seminoma|seminoma only|\bseminoma\b/i.test(text)) {
      return "pure_seminoma";
    }
    if (/nonseminoma|non[- ]seminomatous|\bnsgct\b|yolk sac|embryonal|choriocarcinoma|teratoma/i.test(text)) {
      return "nsgct";
    }
    return "";
  }

  function detectClinicalStage(text) {
    if (/stage is|clinical stage is|persistently elevated markers/i.test(text)) {
      return "stage_1s";
    }
    if (/stage ia|cs ia/i.test(text)) return "stage_1a";
    if (/stage ib|cs ib/i.test(text)) return "stage_1b";
    if (/clinical stage i\b|stage i\b|cs i\b/i.test(text)) return "stage_1_unspecified";
    if (/stage iia|cs iia/i.test(text)) return "stage_2a";
    if (/stage iib|cs iib/i.test(text)) return "stage_2b";
    if (/stage iic|cs iic/i.test(text)) return "stage_2c";
    if (/stage iiia|cs iiia/i.test(text)) return "stage_3a";
    if (/stage iiib|cs iiib/i.test(text)) return "stage_3b";
    if (/stage iiic|cs iiic/i.test(text)) return "stage_3c";
    if (/stage iii|advanced gct|metastatic gct|metastatic seminoma|metastatic nonseminoma/i.test(text)) {
      return "stage_3_unspecified";
    }
    return "";
  }

  function detectIgcccgRisk(text) {
    if (/igcccg.{0,12}good|good[- ]risk|good prognosis/i.test(text)) {
      return "good";
    }
    if (/igcccg.{0,12}intermediate|intermediate[- ]risk|intermediate prognosis/i.test(text)) {
      return "intermediate";
    }
    if (/igcccg.{0,12}poor|poor[- ]risk|poor prognosis/i.test(text)) {
      return "poor";
    }
    return "";
  }

  function detectPrimarySite(text) {
    if (/mediastinal|primary mediastinal/i.test(text)) {
      return "mediastinal";
    }
    if (/intracranial|pineal|suprasellar/i.test(text)) {
      return "intracranial";
    }
    if (/retroperitoneal primary|retroperitoneal germ cell/i.test(text)) {
      return "retroperitoneal_primary";
    }
    if (/extragonadal|non[- ]gonadal/i.test(text)) {
      return "extragonadal";
    }
    if (/\btesticular\b|\btestis\b/i.test(text)) {
      return "testicular";
    }
    return "";
  }

  function detectPriorChemoLines(text) {
    if (/third[- ]line|2 prior lines|two prior lines|>= ?2 prior lines|heavily pretreated|multiple prior lines|after (?:tip|veip|vip|gemox|gemoxp|ti-?ce)|post[- ](?:tip|veip|vip|gemox|gemoxp|ti-?ce)|after second[- ]line|post[- ]second[- ]line|after hdct|after high[- ]dose chemotherapy/i.test(text)) {
      return "2+";
    }
    if (/after bep|after ep|after first[- ]line|post[- ]first[- ]line|second[- ]line|1 prior line|one prior line|salvage|relapsed after cisplatin|after cisplatin[- ]based/i.test(text)) {
      return "1";
    }
    if (/no prior chemotherapy|chemo[- ]naive|treatment[- ]naive/i.test(text)) {
      return "0";
    }
    if (/(^|[^a-z])(first[- ]line|1st[- ]line)([^a-z]|$)/i.test(text) && !/after first[- ]line|post[- ]first[- ]line/i.test(text)) {
      return "0";
    }
    return "";
  }

  function detectPriorHdct(text) {
    if (/no prior hdct|no prior high[- ]dose chemotherapy|hdct[- ]naive/i.test(text)) {
      return "no";
    }
    if (/prior hdct|after hdct|after high[- ]dose chemotherapy|ti-?ce|stem cell rescue|high[- ]dose carboplatin|high[- ]dose etoposide/i.test(text)) {
      return "yes";
    }
    return "";
  }

  function detectMarkerStatus(text) {
    if (/multiple.*markers.*elevated|AFP.*and.*(?:beta[- ]?hcg|hcg).*elevated|(?:beta[- ]?hcg|hcg).*(?:and ).*AFP.*elevated|afp.*hcg.*elevated|elevated.*AFP.*hCG/i.test(text)) {
      return "multiple_elevated";
    }
    if (/persistently elevated afp|afp elevated|afp remains elevated|afp rising/i.test(text)) {
      return "afp_elevated";
    }
    if (/persistently elevated (?:beta[- ]?hcg|hcg)|(?:beta[- ]?hcg|hcg) elevated|(?:beta[- ]?hcg|hcg) remains elevated|(?:beta[- ]?hcg|hcg) rising/i.test(text)) {
      return "hcg_elevated";
    }
    if (/persistently elevated ldh|ldh elevated|ldh remains elevated|ldh rising/i.test(text)) {
      return "ldh_elevated";
    }
    if (/elevated markers|rising markers|serum tumor markers elevated/i.test(text)) {
      return "markers_elevated";
    }
    if (/markers normal|normal markers|afp normal|beta[- ]?hcg normal|ldh normal|normalized markers|marker negative/i.test(text)) {
      return "markers_normal";
    }
    return "";
  }

  function detectStage1RiskFactors(text) {
    if (/no lymphovascular invasion|without lymphovascular invasion|\blvi[- ]negative|\blvi negative|no lvi/i.test(text)) {
      return "without_risk_factors";
    }
    if (/lymphovascular invasion|\blvi\b|spermatic cord invasion|rete testis|risk factors?/i.test(text)) {
      return "with_risk_factors";
    }
    return "";
  }

  function detectGctResidualMassSizeCm(text) {
    const patterns = [
      /residual (?:mass|node|lesion)[^.;,\n]{0,24}?(\d+(?:\.\d+)?)\s*(cm|centimeters?|mm|millimeters?)/i,
      /(\d+(?:\.\d+)?)\s*(cm|centimeters?|mm|millimeters?)[^.;,\n]{0,24}?residual (?:mass|node|lesion)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) {
        continue;
      }
      const amount = Number(match[1]);
      const unit = (match[2] || "").toLowerCase();
      if (!Number.isFinite(amount)) {
        continue;
      }
      return unit.startsWith("mm") || unit.startsWith("millimeter") ? String(amount / 10) : String(amount);
    }
    return "";
  }

  function detectGctMarkerTrend(text) {
    if (/markers? normaliz(?:ed|ing)|afp normaliz(?:ed|ing)|(?:beta[- ]?hcg|hcg) normaliz(?:ed|ing)|ldh normaliz(?:ed|ing)/i.test(text)) {
      return "normalizing";
    }
    if (/markers normal|normal markers|afp normal|beta[- ]?hcg normal|hcg normal|ldh normal|marker negative/i.test(text)) {
      return "normal";
    }
    if (/markers? rising|afp rising|(?:beta[- ]?hcg|hcg) rising|ldh rising|progressive marker/i.test(text)) {
      return "rising";
    }
    if (/persistently elevated|remain(?:s|ed)? elevated|markers? elevated|afp elevated|(?:beta[- ]?hcg|hcg) elevated|ldh elevated/i.test(text)) {
      return "persistently_elevated";
    }
    return "";
  }

  function detectGctSalvageLine(text) {
    if (/late relapse/i.test(text)) return "late_relapse";
    if (/after hdct|post[- ]hdct|prior hdct|after high[- ]dose chemotherapy|post[- ]asct|after asct/i.test(text)) return "post_hdct";
    if (/second salvage|third[- ]line|3rd[- ]line|after (?:tip|veip|vip|gemox|gemoxp|ti-?ce)|post[- ](?:tip|veip|vip|gemox|gemoxp|ti-?ce)|after second[- ]line/i.test(text)) return "second_salvage";
    if (/first salvage|relapsed after (?:bep|ep|first[- ]line)|after first[- ]line|post[- ]first[- ]line|one prior line|1 prior line|second[- ]line/i.test(text)) return "first_salvage";
    return "";
  }

  function detectPhasePreference(text) {
    const match = text.match(/phase\s*(i{1,3}|iv)\s*only/i);
    if (!match) {
      return "";
    }

    const roman = match[1].toUpperCase();
    if (roman === "I") return "Phase I";
    if (roman === "II") return "Phase II";
    if (roman === "III") return "Phase III";
    if (roman === "IV") return "Phase IV";
    return "";
  }

  function detectLocationTerms(text) {
    return LOCATION_TERMS.filter(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
    });
  }

  function detectTreatmentPreferences(text) {
    const preferences = [];
    text = (text.match(/\b(?:prefers?|seeking|interested in|requests?|wants?)\b[^.;\n]*/gi) || []).join(' ');

    if (/radioligand|lutetium|177lu|psma/i.test(text)) addPreference(preferences, "radioligand");
    if (/parp|olaparib|rucaparib|niraparib|talazoparib/i.test(text)) addPreference(preferences, "parp");
    if (/triplet/i.test(text)) addPreference(preferences, "triplet");
    if (/intensification/i.test(text)) addPreference(preferences, "intensification");
    if (/de[- ]intensification|deintensification/i.test(text)) addPreference(preferences, "deintensification");
    if (/intravesical|bcg|nadofaragene|anktiva|nogapendekin/i.test(text)) addPreference(preferences, "intravesical");
    if (/bladder[- ]sparing|trimodality|tmt|chemoradiation/i.test(text)) addPreference(preferences, "bladder_preservation");
    if (/immunotherapy|pd-?1|pd-?l1|nivolumab|pembrolizumab|avelumab|durvalumab|ipilimumab/i.test(text)) addPreference(preferences, "immunotherapy");
    if (/targeted|erdafitinib|fgfr|belzutifan|cabozantinib|axitinib|lenvatinib|vhl|met inhibitor/i.test(text)) addPreference(preferences, "targeted");
    if (/surveillance|active surveillance/i.test(text)) addPreference(preferences, "surveillance");
    if ((/high[- ]dose chemotherapy|hdct|ti-?ce/i.test(text)) && !/no prior hdct|no prior high[- ]dose chemotherapy|hdct[- ]naive/i.test(text)) {
      addPreference(preferences, "high_dose");
    }

    return preferences;
  }

  function finalizeDiseaseSettingIds(parsed) {
    const axes = parsed.clinicalAxes;
    const ids = [];

    if (parsed.cancerType === "Prostate") {
      if (parsed.diseaseGroup === "crpc") {
        if (axes.metastaticStatus === "nonmetastatic_crpc") {
          ids.push("crpc_nonmetastatic");
        } else if (axes.metastaticStatus === "metastatic") {
          if (axes.priorArpi === "yes") {
            if (axes.priorDocetaxel === "no" && axes.psmaStatus === "positive") {
              ids.push("crpc_metastatic_postarpi_taxane_naive_psma_positive");
            }
            if (axes.priorDocetaxel === "yes") {
              ids.push("crpc_metastatic_postarpi_post_taxane");
            }
            if (axes.hrrGene === "brca1" || axes.hrrGene === "brca2" || axes.hrrGene === "brca_unspecified") {
              ids.push("crpc_metastatic_brca_mutated");
            } else if (axes.biomarkerHrr === "positive") {
              ids.push("crpc_metastatic_hrr_mutated_nonbrca");
            }
            ids.push("crpc_metastatic_postarpi", "crpc_general");
          } else if (axes.priorArpi === "no") {
            ids.push("crpc_metastatic_prearpi", "crpc_general");
          } else {
            ids.push("crpc_metastatic_prearpi", "crpc_metastatic_postarpi", "crpc_general");
          }
        } else {
          ids.push("crpc_nonmetastatic", "crpc_metastatic_prearpi", "crpc_metastatic_postarpi", "crpc_general");
        }
      }

      if (parsed.diseaseGroup === "cspc") {
        if (axes.hrrGene === "brca2") {
          ids.push("cspc_brca2_mutated");
        }
        if (axes.prostateVolumeClass === "high_volume_chaarted" || axes.diseaseVolume === "high_volume") {
          ids.push("cspc_high_volume_chaarted", "cspc_high_volume", "cspc_general");
        } else if (axes.prostateVolumeClass === "low_volume" || axes.diseaseVolume === "low_volume") {
          ids.push("cspc_low_volume", "cspc_general");
        } else if (axes.diseaseVolume === "oligometastatic") {
          ids.push("cspc_oligometastatic", "cspc_general");
        } else {
          ids.push("cspc_high_volume", "cspc_low_volume", "cspc_general", "cspc_oligometastatic");
        }
      }

      if (["small_cell", "neuroendocrine", "aggressive_variant", "mixed"].includes(axes.prostateHistology)) {
        ids.push("crpc_neuroendocrine_small_cell");
      }

      if (parsed.diseaseGroup === "localized" || parsed.diseaseGroup === "bcr") {
        ids.push(...parsed.diseaseSettingIds);
      }
    }

    if (parsed.cancerType === "Bladder" || parsed.cancerType === "Kidney" || parsed.cancerType === "Testicular") {
      ids.push(...parsed.diseaseSettingIds);
    }

    const allowed = new Set(vocabularyApi?.diseaseSettings?.[parsed.cancerType] || []);
    const mapped = ids.filter(Boolean).map(id => LEGACY_DISEASE_ID_ALIASES[id] || id);
    parsed.ignoredDiseaseSettingIds = Array.from(new Set(ids.filter(id => id && !allowed.has(id))));
    parsed.diseaseSettingIds = Array.from(new Set(mapped.filter(id => !allowed.size || allowed.has(id))));
  }

  function parseProstate(parsed, text) {
    const diseaseContext = detectDiseaseContext(text);
    parsed.diseaseGroup = diseaseContext.diseaseGroup;
    parsed.diseaseLabel = diseaseContext.diseaseLabel;
    parsed.diseaseSettingIds = diseaseContext.diseaseSettingIds.slice();

    if (parsed.diseaseGroup === "crpc") {
      parsed.clinicalAxes.castrationStatus = "castration_resistant";
      parsed.clinicalAxes.metastaticStatus = parsed.diseaseLabel === "nmCRPC" ? "nonmetastatic_crpc" : "metastatic";
    } else if (parsed.diseaseGroup === "cspc") {
      parsed.clinicalAxes.castrationStatus = "castration_sensitive";
      parsed.clinicalAxes.metastaticStatus = "metastatic";
    } else if (parsed.diseaseGroup === "localized") {
      parsed.clinicalAxes.metastaticStatus = "localized";
    }

    const arpiState = detectArpiState(text);
    parsed.clinicalAxes.priorArpi = arpiState.value;
    parsed.clinicalAxes.priorDocetaxel = detectDocetaxelState(text);

    const hrrState = detectHrrState(text);
    parsed.clinicalAxes.biomarkerHrr = hrrState.value;
    parsed.clinicalAxes.biomarkerLabel = hrrState.label;
    parsed.clinicalAxes.hrrGene = detectHrrGene(text);

    parsed.clinicalAxes.psmaStatus = detectPsmaState(text);
    parsed.clinicalAxes.psmaPetPattern = detectPsmaPetPattern(text);

    const classifierState = detectGenomicClassifier(text);
    parsed.clinicalAxes.genomicClassifier = classifierState.value;
    parsed.clinicalAxes.genomicClassifierLabel = classifierState.label;

    parsed.clinicalAxes.diseaseVolume = detectDiseaseVolume(text);
    parsed.clinicalAxes.prostateVolumeClass = detectProstateVolumeClass(text);
    parsed.clinicalAxes.prostateHistology = detectProstateHistology(text);
    parsed.clinicalAxes.taxaneExposure = detectTaxaneExposure(text);
    parsed.clinicalAxes.adtStatus = detectAdtState(text);

    if (/declines further hormonal therapy/i.test(text)) {
      parsed.notes.push("Declines further hormonal therapy");
    }
    if (/radiation candidate|eligible for radiation/i.test(text)) {
      parsed.notes.push("Radiation candidate");
    }

    finalizeDiseaseSettingIds(parsed);

    if (parsed.diseaseLabel) addChip(parsed.chips, "Disease", parsed.diseaseLabel);
    if (arpiState.value === "yes") {
      addChip(parsed.chips, "Treatment", arpiState.agents.length > 0 ? `Post-${arpiState.agents[0]}` : "Post-ARPI");
    } else if (arpiState.value === "no") {
      addChip(parsed.chips, "Treatment", "ARPI-naive");
    }
    if (parsed.clinicalAxes.priorDocetaxel === "no") addChip(parsed.chips, "Treatment", "Chemo-naive");
    if (parsed.clinicalAxes.priorDocetaxel === "yes") addChip(parsed.chips, "Treatment", "Prior docetaxel");
    if (parsed.clinicalAxes.biomarkerLabel) addChip(parsed.chips, "Biomarker", parsed.clinicalAxes.biomarkerLabel);
    if (parsed.clinicalAxes.hrrGene && parsed.clinicalAxes.hrrGene !== "other_hrr") addChip(parsed.chips, "Biomarker", parsed.clinicalAxes.hrrGene.replace(/_/g, " ").toUpperCase());
    if (parsed.clinicalAxes.psmaStatus === "positive") addChip(parsed.chips, "Biomarker", "PSMA-confirmed");
    if (parsed.clinicalAxes.genomicClassifierLabel) addChip(parsed.chips, "Biomarker", parsed.clinicalAxes.genomicClassifierLabel);
    if (parsed.clinicalAxes.diseaseVolume === "high_volume") addChip(parsed.chips, "Disease", "High-volume");
    if (parsed.clinicalAxes.diseaseVolume === "low_volume") addChip(parsed.chips, "Disease", "Low-volume");
    if (parsed.clinicalAxes.diseaseVolume === "oligometastatic") addChip(parsed.chips, "Disease", "Oligometastatic");
    if (parsed.clinicalAxes.prostateVolumeClass === "high_volume_chaarted") addChip(parsed.chips, "Disease", "High-volume by CHAARTED clues");
    if (parsed.clinicalAxes.prostateVolumeClass === "possible_high_volume") addChip(parsed.chips, "Disease", "Possible high-volume");
    if (parsed.clinicalAxes.prostateHistology && parsed.clinicalAxes.prostateHistology !== "adenocarcinoma") addChip(parsed.chips, "Disease", parsed.clinicalAxes.prostateHistology.replace(/_/g, " "));
    if (parsed.clinicalAxes.taxaneExposure && parsed.clinicalAxes.taxaneExposure !== "none") addChip(parsed.chips, "Treatment", parsed.clinicalAxes.taxaneExposure.replace(/_/g, " "));
    if (parsed.clinicalAxes.adtStatus === "naive") addChip(parsed.chips, "Treatment", "ADT-naive");
  }

  function parseBladder(parsed, text) {
    parsed.clinicalAxes.bcgStatus = detectBcgStatus(text);
    parsed.clinicalAxes.bcgAdequacy = detectBcgAdequacy(text);
    parsed.clinicalAxes.bcgTimingPattern = detectBcgTimingPattern(text);
    parsed.clinicalAxes.cisplatinStatus = detectCisplatinStatus(text);
    parsed.clinicalAxes.cisPapillaryPattern = detectCisPapillaryPattern(text);
    parsed.clinicalAxes.fgfr3Status = detectFgfr3Status(text);
    parsed.clinicalAxes.fgfrAlteration = detectFgfrAlteration(text);
    parsed.clinicalAxes.her2Status = detectHer2Status(text);
    parsed.clinicalAxes.priorSystemicLines = detectPriorSystemicLines(text);
    parsed.clinicalAxes.priorIo = detectPriorIo(text);
    parsed.clinicalAxes.platinumStatus = detectPlatinumStatus(text);
    parsed.clinicalAxes.perioperativeStatus = detectPerioperativeStatus(text);

    if (/\bnmibc\b|non[- ]muscle[- ]invasive|carcinoma in situ|high[- ]grade t1|intravesical/i.test(text)) {
      parsed.diseaseGroup = "nmibc";
      if (parsed.clinicalAxes.bcgStatus === "BCG-Unresponsive") {
        if (parsed.clinicalAxes.cisPapillaryPattern === "papillary_only") {
          parsed.diseaseLabel = "NMIBC — BCG-unresponsive papillary-only";
          pushDiseaseIds(parsed.diseaseSettingIds, ["nmibc_bcg_unresponsive_papillary_only", "nmibc_bcg_unresponsive", "nmibc_general"]);
        } else if (parsed.clinicalAxes.cisPapillaryPattern === "cis_only" || parsed.clinicalAxes.cisPapillaryPattern === "cis_plus_papillary") {
          parsed.diseaseLabel = "NMIBC — BCG-unresponsive CIS";
          pushDiseaseIds(parsed.diseaseSettingIds, ["nmibc_bcg_unresponsive_cis", "nmibc_bcg_unresponsive", "nmibc_general"]);
        } else {
          parsed.diseaseLabel = "NMIBC — BCG-unresponsive";
          pushDiseaseIds(parsed.diseaseSettingIds, ["nmibc_bcg_unresponsive", "nmibc_general"]);
        }
      } else if (parsed.clinicalAxes.bcgStatus === "BCG-Intolerant") {
        parsed.diseaseLabel = "NMIBC — BCG-intolerant";
        pushDiseaseIds(parsed.diseaseSettingIds, ["nmibc_bcg_intolerant", "nmibc_general"]);
      } else if (parsed.clinicalAxes.bcgTimingPattern === "exposed_not_unresponsive") {
        parsed.diseaseLabel = "NMIBC — BCG-exposed";
        pushDiseaseIds(parsed.diseaseSettingIds, ["nmibc_bcg_exposed_not_unresponsive", "nmibc_bcg_unresponsive", "nmibc_general"]);
      } else if (parsed.clinicalAxes.bcgStatus === "BCG-Naive" || /high[- ]risk|cis with|cis\b|high[- ]grade/i.test(text)) {
        parsed.diseaseLabel = "NMIBC — high risk";
        pushDiseaseIds(parsed.diseaseSettingIds, ["nmibc_high_risk_bcg_naive", "nmibc_general"]);
      } else if (/intermediate[- ]risk|low[- ]grade ta|recurrent low[- ]grade/i.test(text)) {
        parsed.diseaseLabel = "NMIBC — intermediate risk";
        pushDiseaseIds(parsed.diseaseSettingIds, ["nmibc_intermediate_risk", "nmibc_general"]);
      } else {
        parsed.diseaseLabel = "NMIBC";
        pushDiseaseIds(parsed.diseaseSettingIds, ["nmibc_bcg_unresponsive", "nmibc_high_risk_bcg_naive", "nmibc_intermediate_risk", "nmibc_general"]);
      }
    } else if (/metastatic|stage ivb|m1|advanced urothelial|advanced bladder|distant metast/i.test(text)) {
      parsed.diseaseGroup = "metastatic";
      parsed.diseaseLabel = "Metastatic urothelial cancer";
      if (parsed.clinicalAxes.platinumStatus === "post_platinum_nonprogressing") {
        parsed.diseaseLabel = "Metastatic urothelial — maintenance after platinum";
        pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_maintenance_post_platinum_nonprogressing", "metastatic_general"]);
      } else if (parsed.clinicalAxes.priorSystemicLines === "1" || /post[- ]platinum|prior platinum|platinum[- ]refractory|platinum[- ]resistant|second[- ]line/i.test(text)) {
        parsed.diseaseLabel = "Metastatic urothelial — post-platinum";
        if (parsed.clinicalAxes.fgfrAlteration === "fgfr3_mutation" || parsed.clinicalAxes.fgfrAlteration === "fgfr3_fusion") {
          pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_fgfr3_altered_post_systemic"]);
        }
        pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_2l_plus", "metastatic_general"]);
      } else if (parsed.clinicalAxes.priorSystemicLines === "0") {
        if (parsed.clinicalAxes.cisplatinStatus === "Cisplatin-Ineligible") {
          parsed.diseaseLabel = "Metastatic urothelial — 1L cisplatin-ineligible";
          pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_1l_all_comers_ev_pembro", "metastatic_1l_cisplatin_ineligible", "metastatic_1l_general", "metastatic_general"]);
        } else if (parsed.clinicalAxes.cisplatinStatus === "Cisplatin-Eligible") {
          parsed.diseaseLabel = "Metastatic urothelial — 1L cisplatin-eligible";
          pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_1l_all_comers_ev_pembro", "metastatic_1l_cisplatin_eligible", "metastatic_1l_general", "metastatic_general"]);
        } else {
          parsed.diseaseLabel = "Metastatic urothelial — 1L";
          pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_1l_all_comers_ev_pembro", "metastatic_1l_cisplatin_eligible", "metastatic_1l_cisplatin_ineligible", "metastatic_1l_general", "metastatic_general"]);
        }
      } else {
        pushDiseaseIds(parsed.diseaseSettingIds, [
          "metastatic_2l_plus",
          "metastatic_1l_all_comers_ev_pembro",
          "metastatic_1l_cisplatin_eligible",
          "metastatic_1l_cisplatin_ineligible",
          "metastatic_1l_general",
          "metastatic_general"
        ]);
      }
    } else if (/locally advanced|unresectable|stage iva|node[- ]positive|n2|n3/i.test(text)) {
      parsed.diseaseGroup = "locally_advanced";
      parsed.diseaseLabel = "Locally advanced urothelial cancer";
      pushDiseaseIds(parsed.diseaseSettingIds, ["locally_advanced"]);
    } else if (/bladder[- ]preservation|bladder[- ]sparing|trimodality|\btmt\b|chemoradiation/i.test(text)) {
      parsed.diseaseGroup = "mibc";
      parsed.diseaseLabel = "MIBC — bladder preservation";
      pushDiseaseIds(parsed.diseaseSettingIds, ["mibc_bladder_preservation", "mibc_general"]);
    } else if (/adjuvant|post[- ]cystectomy|after cystectomy/i.test(text)) {
      parsed.diseaseGroup = "mibc";
      parsed.diseaseLabel = "MIBC — adjuvant";
      pushDiseaseIds(parsed.diseaseSettingIds, ["mibc_adjuvant", "mibc_general"]);
    } else if (/neoadjuvant|perioperative|pre[- ]cystectomy|before cystectomy/i.test(text)) {
      parsed.diseaseGroup = "mibc";
      parsed.diseaseLabel = "MIBC — perioperative";
      pushDiseaseIds(parsed.diseaseSettingIds, ["mibc_neoadjuvant", "mibc_general"]);
    } else if (/\bmibc\b|muscle[- ]invasive|cystectomy planned|ct2|ct3|ct4a/i.test(text)) {
      parsed.diseaseGroup = "mibc";
      parsed.diseaseLabel = "MIBC";
      pushDiseaseIds(parsed.diseaseSettingIds, ["mibc_neoadjuvant", "mibc_adjuvant", "mibc_bladder_preservation", "mibc_stage_iiib", "mibc_general"]);
    } else if (/\bbladder\b|\burothelial\b|upper tract urothelial|utuc|renal pelvis|ureter/i.test(text)) {
      parsed.diseaseGroup = "urothelial";
      parsed.diseaseLabel = "Bladder / urothelial cancer";
    }

    finalizeDiseaseSettingIds(parsed);

    if (parsed.diseaseLabel) addChip(parsed.chips, "Disease", parsed.diseaseLabel);
    if (parsed.clinicalAxes.bcgStatus) addChip(parsed.chips, "Treatment", parsed.clinicalAxes.bcgStatus);
    if (parsed.clinicalAxes.bcgAdequacy) addChip(parsed.chips, "Treatment", `BCG ${parsed.clinicalAxes.bcgAdequacy}`);
    if (parsed.clinicalAxes.bcgTimingPattern === "exposed_not_unresponsive") addChip(parsed.chips, "Treatment", "BCG-exposed");
    if (parsed.clinicalAxes.cisplatinStatus) addChip(parsed.chips, "Treatment", parsed.clinicalAxes.cisplatinStatus);
    if (parsed.clinicalAxes.cisPapillaryPattern === "cis_only") addChip(parsed.chips, "Disease", "CIS only");
    if (parsed.clinicalAxes.cisPapillaryPattern === "papillary_only") addChip(parsed.chips, "Disease", "Papillary only");
    if (parsed.clinicalAxes.cisPapillaryPattern === "cis_plus_papillary") addChip(parsed.chips, "Disease", "CIS + papillary");
    if (parsed.clinicalAxes.fgfr3Status === "susceptible_alteration") addChip(parsed.chips, "Biomarker", "FGFR3 altered");
    if (parsed.clinicalAxes.fgfrAlteration === "fgfr_unspecified") addChip(parsed.chips, "Biomarker", "FGFR altered");
    if (parsed.clinicalAxes.her2Status === "ihc_3_plus") addChip(parsed.chips, "Biomarker", "HER2 IHC 3+");
    if (parsed.clinicalAxes.her2Status === "ihc_2_plus") addChip(parsed.chips, "Biomarker", "HER2 IHC 2+");
    if (parsed.clinicalAxes.priorSystemicLines === "0") addChip(parsed.chips, "Treatment", "Treatment-naive");
    if (parsed.clinicalAxes.priorSystemicLines === "1") addChip(parsed.chips, "Treatment", "Previously treated");
    if (parsed.clinicalAxes.priorIo === "no") addChip(parsed.chips, "Treatment", "IO-naive");
    if (parsed.clinicalAxes.priorIo === "yes") addChip(parsed.chips, "Treatment", "Prior IO");
    if (parsed.clinicalAxes.platinumStatus === "post_platinum_nonprogressing") addChip(parsed.chips, "Treatment", "Post-platinum nonprogressing");
    if (parsed.clinicalAxes.platinumStatus === "post_platinum_progressed") addChip(parsed.chips, "Treatment", "Progressed after platinum");
  }

  function parseKidney(parsed, text) {
    parsed.clinicalAxes.histology = detectKidneyHistology(text);
    parsed.clinicalAxes.imdcRisk = detectImdcRisk(text);
    parsed.clinicalAxes.priorSystemicLines = detectPriorSystemicLines(text);
    parsed.clinicalAxes.priorIo = detectPriorIo(text);
    parsed.clinicalAxes.priorVegfTki = detectPriorVegfTki(text);
    if (!parsed.clinicalAxes.priorSystemicLines && parsed.clinicalAxes.priorIo === "yes" && parsed.clinicalAxes.priorVegfTki === "yes") {
      parsed.clinicalAxes.priorSystemicLines = "1";
    }
    parsed.clinicalAxes.nephrectomyStatus = detectNephrectomyStatus(text);
    parsed.clinicalAxes.vhlStatus = detectVhlStatus(text);
    parsed.clinicalAxes.metAlteration = detectMetAlteration(text);
    parsed.clinicalAxes.sarcomatoid = detectSarcomatoid(text);

    if (/hereditary|von hippel|vhl[- ]associated|hereditary rcc/i.test(text)) {
      parsed.diseaseGroup = "hereditary";
      parsed.diseaseLabel = "Hereditary RCC";
      pushDiseaseIds(parsed.diseaseSettingIds, ["hereditary_rcc"]);
    } else if (/adjuvant|m1 ned|disease[- ]free after nephrectomy|resected high[- ]risk/i.test(text) || (/post[- ]nephrectomy|after nephrectomy/i.test(text) && !/metastatic|metastases|stage iv/i.test(text))) {
      parsed.diseaseGroup = "adjuvant";
      parsed.diseaseLabel = "Adjuvant RCC";
      pushDiseaseIds(parsed.diseaseSettingIds, ["adjuvant_post_nephrectomy"]);
    } else if (/locally advanced|unresectable|neoadjuvant|presurgical|downsizing/i.test(text)) {
      parsed.diseaseGroup = "locally_advanced";
      parsed.diseaseLabel = "Locally advanced RCC";
      pushDiseaseIds(parsed.diseaseSettingIds, ["locally_advanced_unresectable"]);
    } else if (/metastatic|advanced|stage iv|\bmrcc\b/i.test(text)) {
      parsed.diseaseGroup = "metastatic";
      const histology = parsed.clinicalAxes.histology;
      const lines = parsed.clinicalAxes.priorSystemicLines;
      if (histology === "clear_cell") {
        if (lines === "0") {
          if (parsed.clinicalAxes.imdcRisk === "favorable") {
            parsed.diseaseLabel = "Metastatic ccRCC — favorable risk";
            pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ccrcc_favorable_1l", "metastatic_ccrcc_1l_all_risk", "metastatic_ccrcc_general"]);
          } else if (parsed.clinicalAxes.imdcRisk === "intermediate" || parsed.clinicalAxes.imdcRisk === "poor" || parsed.clinicalAxes.imdcRisk === "intermediate_poor") {
            parsed.diseaseLabel = "Metastatic ccRCC — intermediate/poor risk";
            pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ccrcc_int_poor_1l", "metastatic_ccrcc_1l_all_risk", "metastatic_ccrcc_general"]);
          } else {
            parsed.diseaseLabel = "Metastatic ccRCC — 1L";
            pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ccrcc_favorable_1l", "metastatic_ccrcc_int_poor_1l", "metastatic_ccrcc_1l_all_risk", "metastatic_ccrcc_general"]);
          }
        } else if (lines === "1" && parsed.clinicalAxes.priorIo === "yes") {
          parsed.diseaseLabel = "Metastatic ccRCC — IO experienced";
          if (parsed.clinicalAxes.priorVegfTki === "yes") {
            pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ccrcc_post_pd1_vegf_tki_belzutifan"]);
          }
          pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ccrcc_2l_io_experienced", "metastatic_ccrcc_general"]);
        } else if (lines === "1") {
          parsed.diseaseLabel = "Metastatic ccRCC — previously treated";
          pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ccrcc_2l_io_naive", "metastatic_ccrcc_2l_io_experienced", "metastatic_ccrcc_general"]);
        } else if (lines === "2+") {
          parsed.diseaseLabel = "Metastatic ccRCC — 3L+";
          pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ccrcc_3l_plus", "metastatic_ccrcc_general"]);
        } else {
          parsed.diseaseLabel = "Metastatic ccRCC";
          pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ccrcc_favorable_1l", "metastatic_ccrcc_int_poor_1l", "metastatic_ccrcc_1l_all_risk", "metastatic_ccrcc_2l_io_naive", "metastatic_ccrcc_2l_io_experienced", "metastatic_ccrcc_3l_plus", "metastatic_ccrcc_general"]);
        }
      } else if (["papillary_type1", "papillary_type2", "papillary_unspecified"].includes(histology)) {
        if (histology === "papillary_type1") {
          parsed.diseaseLabel = "Metastatic papillary RCC — type 1";
        } else if (histology === "papillary_type2") {
          parsed.diseaseLabel = "Metastatic papillary RCC — type 2 / FH-deficient";
        } else {
          parsed.diseaseLabel = "Metastatic papillary RCC";
        }
        pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ncrcc_papillary", "metastatic_ncrcc_general"]);
      } else if (histology === "chromophobe") {
        parsed.diseaseLabel = "Metastatic chromophobe RCC";
        pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ncrcc_chromophobe", "metastatic_ncrcc_general"]);
      } else if (histology === "collecting_duct" || histology === "medullary") {
        parsed.diseaseLabel = histology === "medullary" ? "Metastatic renal medullary carcinoma" : "Metastatic collecting duct RCC";
        pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ncrcc_collecting_duct", "metastatic_ncrcc_general"]);
      } else if (histology === "tfe3_tfeb_translocation") {
        parsed.diseaseLabel = "Metastatic translocation RCC";
        pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ncrcc_tfe3_tfeb", "metastatic_ncrcc_general"]);
      } else if (histology === "unclassified") {
        parsed.diseaseLabel = "Metastatic unclassified RCC";
        pushDiseaseIds(parsed.diseaseSettingIds, ["metastatic_ncrcc_general"]);
      } else if (histology === "non_clear_cell") {
        parsed.diseaseLabel = "Metastatic non-clear-cell RCC";
        pushDiseaseIds(parsed.diseaseSettingIds, [
          "metastatic_ncrcc_papillary",
          "metastatic_ncrcc_chromophobe",
          "metastatic_ncrcc_collecting_duct",
          "metastatic_ncrcc_tfe3_tfeb",
          "metastatic_ncrcc_general"
        ]);
      } else {
        parsed.diseaseLabel = "Metastatic RCC";
        pushDiseaseIds(parsed.diseaseSettingIds, [
          "metastatic_ccrcc_favorable_1l",
          "metastatic_ccrcc_int_poor_1l",
          "metastatic_ccrcc_1l_all_risk",
          "metastatic_ccrcc_2l_io_naive",
          "metastatic_ccrcc_2l_io_experienced",
          "metastatic_ccrcc_3l_plus",
          "metastatic_ccrcc_general",
          "metastatic_ncrcc_papillary",
          "metastatic_ncrcc_chromophobe",
          "metastatic_ncrcc_collecting_duct",
          "metastatic_ncrcc_tfe3_tfeb",
          "metastatic_ncrcc_general"
        ]);
      }
    } else if (/t1a|small renal mass|partial nephrectomy|ablation|active surveillance/i.test(text)) {
      parsed.diseaseGroup = "localized";
      parsed.diseaseLabel = "Localized RCC — T1a";
      pushDiseaseIds(parsed.diseaseSettingIds, ["localized_t1a"]);
    } else if (/t1b|4[- ]7 cm/i.test(text)) {
      parsed.diseaseGroup = "localized";
      parsed.diseaseLabel = "Localized RCC — T1b";
      pushDiseaseIds(parsed.diseaseSettingIds, ["localized_t1b"]);
    } else if (/stage ii|stage iii|t2|t3|high[- ]risk localized/i.test(text)) {
      parsed.diseaseGroup = "localized";
      parsed.diseaseLabel = "Localized RCC — Stage II/III";
      pushDiseaseIds(parsed.diseaseSettingIds, ["localized_stage2_3"]);
    } else {
      parsed.diseaseGroup = "rcc";
      parsed.diseaseLabel = "Kidney / RCC";
    }

    finalizeDiseaseSettingIds(parsed);

    if (parsed.diseaseLabel) addChip(parsed.chips, "Disease", parsed.diseaseLabel);
    if (parsed.clinicalAxes.histology === "papillary_type1") addChip(parsed.chips, "Disease", "Papillary type 1");
    if (parsed.clinicalAxes.histology === "papillary_type2") addChip(parsed.chips, "Disease", "Papillary type 2 / FH-deficient");
    if (parsed.clinicalAxes.histology === "papillary_unspecified") addChip(parsed.chips, "Disease", "Papillary RCC");
    if (parsed.clinicalAxes.histology === "chromophobe") addChip(parsed.chips, "Disease", "Chromophobe");
    if (parsed.clinicalAxes.histology === "collecting_duct") addChip(parsed.chips, "Disease", "Collecting duct");
    if (parsed.clinicalAxes.histology === "medullary") addChip(parsed.chips, "Disease", "Renal medullary");
    if (parsed.clinicalAxes.histology === "tfe3_tfeb_translocation") addChip(parsed.chips, "Disease", "Translocation RCC");
    if (parsed.clinicalAxes.histology === "non_clear_cell") addChip(parsed.chips, "Disease", "Non-clear-cell RCC");
    if (parsed.clinicalAxes.histology === "unclassified") addChip(parsed.chips, "Disease", "Unclassified RCC");
    if (parsed.clinicalAxes.histology === "clear_cell") addChip(parsed.chips, "Disease", "Clear-cell RCC");
    if (parsed.clinicalAxes.imdcRisk) addChip(parsed.chips, "Risk", `IMDC ${parsed.clinicalAxes.imdcRisk.replace(/_/g, "/")}`);
    if (parsed.clinicalAxes.priorIo === "no") addChip(parsed.chips, "Treatment", "IO-naive");
    if (parsed.clinicalAxes.priorIo === "yes") addChip(parsed.chips, "Treatment", "Prior IO");
    if (parsed.clinicalAxes.priorVegfTki === "no") addChip(parsed.chips, "Treatment", "VEGF-TKI naive");
    if (parsed.clinicalAxes.priorVegfTki === "yes") addChip(parsed.chips, "Treatment", "Prior VEGF-TKI");
    if (parsed.clinicalAxes.nephrectomyStatus === "prior_nephrectomy") addChip(parsed.chips, "Treatment", "Prior nephrectomy");
    if (parsed.clinicalAxes.sarcomatoid === "yes") addChip(parsed.chips, "Disease", "Sarcomatoid");
    if (parsed.clinicalAxes.vhlStatus) addChip(parsed.chips, "Biomarker", "VHL-altered");
    if (parsed.clinicalAxes.metAlteration) addChip(parsed.chips, "Biomarker", parsed.clinicalAxes.metAlteration === "met_amplification" ? "MET amplification" : "MET mutation");
  }

  function parseTesticular(parsed, text) {
    parsed.clinicalAxes.histology = detectTesticularHistology(text);
    parsed.clinicalAxes.clinicalStage = detectClinicalStage(text);
    parsed.clinicalAxes.igcccgRisk = detectIgcccgRisk(text);
    parsed.clinicalAxes.primarySite = detectPrimarySite(text);
    parsed.clinicalAxes.priorChemoLines = detectPriorChemoLines(text);
    parsed.clinicalAxes.priorHdct = detectPriorHdct(text);
    parsed.clinicalAxes.markerStatus = detectMarkerStatus(text);
    parsed.clinicalAxes.gctMarkerTrend = detectGctMarkerTrend(text);
    parsed.clinicalAxes.stage1RiskFactors = detectStage1RiskFactors(text);
    parsed.clinicalAxes.gctResidualMassSizeCm = detectGctResidualMassSizeCm(text);
    parsed.clinicalAxes.gctSalvageLine = detectGctSalvageLine(text);
    const persistentMarkersAfterOrchiectomy = detectPersistentMarkersAfterOrchiectomy(text);
    if (/prior rplnd|post[- ]rplnd|after rplnd/i.test(text)) {
      parsed.clinicalAxes.rplndStatus = "prior_rplnd";
    }

    if (!parsed.clinicalAxes.markerStatus && persistentMarkersAfterOrchiectomy === "yes") {
      if (/afp/i.test(text)) {
        parsed.clinicalAxes.markerStatus = "afp_elevated";
      } else if (/beta[- ]?hcg|\bhcg\b/i.test(text)) {
        parsed.clinicalAxes.markerStatus = "hcg_elevated";
      } else if (/\bldh\b/i.test(text)) {
        parsed.clinicalAxes.markerStatus = "ldh_elevated";
      } else {
        parsed.clinicalAxes.markerStatus = "markers_elevated";
      }
    }

    if (parsed.clinicalAxes.histology === "pure_seminoma" && ["afp_elevated", "multiple_elevated"].includes(parsed.clinicalAxes.markerStatus)) {
      parsed.clinicalAxes.histology = "nsgct";
      parsed.notes.push("AFP elevation treated as NSGCT");
    }

    if (!parsed.clinicalAxes.clinicalStage && persistentMarkersAfterOrchiectomy === "yes" && (parsed.clinicalAxes.histology === "nsgct" || parsed.clinicalAxes.histology === "mixed_seminoma_nsgct")) {
      parsed.clinicalAxes.clinicalStage = "stage_1s";
    }

    if (!parsed.clinicalAxes.igcccgRisk && parsed.clinicalAxes.primarySite === "mediastinal" && (parsed.clinicalAxes.histology === "nsgct" || parsed.clinicalAxes.histology === "mixed_seminoma_nsgct")) {
      parsed.clinicalAxes.igcccgRisk = "poor";
    }

    const histology = parsed.clinicalAxes.histology;
    const stage = parsed.clinicalAxes.clinicalStage;
    const lines = parsed.clinicalAxes.priorChemoLines;
    const postFirstLineManagement = (
      /(post[- ]first[- ]line|after first[- ]line chemotherapy|post[- ]chemotherapy|post[- ]chemo|pc[- ]rplnd|post[- ]chemotherapy rplnd|residual mass after chemotherapy|residual mass post[- ]chemo|complete response after chemotherapy)/i.test(text)
      || ((/after bep|after ep/i.test(text)) && /(residual mass|post[- ]chemotherapy|post[- ]chemo|pc[- ]rplnd)/i.test(text))
    ) && !/recurrent|relapsed|refractory|salvage|third[- ]line|2 prior lines|two prior lines|after tip|after veip|after vip|after ti-?ce|after hdct/i.test(text);

    if (parsed.clinicalAxes.primarySite && parsed.clinicalAxes.primarySite !== "testicular") {
      parsed.diseaseGroup = "extragonadal";
      parsed.diseaseLabel = "Extragonadal GCT";
      pushDiseaseIds(parsed.diseaseSettingIds, ["extragonadal_gct"]);
    } else if (postFirstLineManagement) {
      parsed.diseaseGroup = "post_first_line";
      if (histology === "pure_seminoma") {
        parsed.diseaseLabel = "Seminoma — post first-line management";
        const residualSize = Number(parsed.clinicalAxes.gctResidualMassSizeCm);
        if (Number.isFinite(residualSize) && residualSize > 3) {
          pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_post_chemo_residual_gt3cm_pet_timing"]);
        } else if (Number.isFinite(residualSize) && residualSize <= 3) {
          pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_post_chemo_residual_le3cm"]);
        }
        pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_post_first_line", "gct_advanced_general"]);
      } else if (histology === "nsgct" || histology === "mixed_seminoma_nsgct") {
        parsed.diseaseLabel = "NSGCT — post first-line management";
        const residualSize = Number(parsed.clinicalAxes.gctResidualMassSizeCm);
        if (Number.isFinite(residualSize) && residualSize > 1 && ["normal", "normalizing"].includes(parsed.clinicalAxes.gctMarkerTrend || parsed.clinicalAxes.markerStatus)) {
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_post_chemo_residual_mass_gt1cm_markers_normalizing"]);
        }
        pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_post_first_line", "gct_advanced_general"]);
      } else {
        parsed.diseaseLabel = "GCT — post first-line management";
        pushDiseaseIds(parsed.diseaseSettingIds, ["gct_advanced_general"]);
      }
    } else if (/recurrent|relapsed|refractory|salvage|after bep|after ep|after first[- ]line|second[- ]line|third[- ]line|ti-?ce|hdct/i.test(text) || lines === "1" || lines === "2+" || parsed.clinicalAxes.priorHdct === "yes") {
      parsed.diseaseGroup = "recurrent";
      if (histology === "pure_seminoma") {
        if (lines === "2+" || parsed.clinicalAxes.priorHdct === "yes") {
          parsed.diseaseLabel = "Seminoma — 3L+";
          pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_3l_plus", "gct_advanced_general"]);
        } else {
          parsed.diseaseLabel = "Seminoma — recurrent / 2L";
          if (parsed.clinicalAxes.gctSalvageLine === "first_salvage") {
            pushDiseaseIds(parsed.diseaseSettingIds, ["gct_first_salvage"]);
          }
          pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_recurrent_2l", "gct_advanced_general"]);
        }
      } else if (histology === "nsgct" || histology === "mixed_seminoma_nsgct") {
        if (lines === "2+" || parsed.clinicalAxes.priorHdct === "yes") {
          parsed.diseaseLabel = "NSGCT — 3L+";
          if (parsed.clinicalAxes.priorHdct === "yes") {
            pushDiseaseIds(parsed.diseaseSettingIds, ["gct_post_hdct_relapse"]);
          }
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_3l_plus", "gct_advanced_general"]);
        } else {
          parsed.diseaseLabel = "NSGCT — recurrent / 2L";
          if (parsed.clinicalAxes.gctSalvageLine === "first_salvage") {
            pushDiseaseIds(parsed.diseaseSettingIds, ["gct_first_salvage"]);
          }
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_recurrent_2l", "gct_advanced_general"]);
        }
      } else {
        parsed.diseaseLabel = "Recurrent GCT";
        pushDiseaseIds(parsed.diseaseSettingIds, ["gct_advanced_general"]);
      }
    } else if (stage === "stage_1s" && (histology === "nsgct" || histology === "mixed_seminoma_nsgct")) {
      parsed.diseaseGroup = "stage_is";
      parsed.diseaseLabel = "NSGCT — stage IS";
      pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage_is", "gct_advanced_general"]);
    } else if (["stage_1a", "stage_1b", "stage_1_unspecified"].includes(stage)) {
      parsed.diseaseGroup = "stage1";
      if (histology === "pure_seminoma") {
        parsed.diseaseLabel = "Seminoma — stage I";
        pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_stage1_surveillance", "seminoma_stage1", "gct_stage1_general"]);
      } else if (histology === "nsgct" || histology === "mixed_seminoma_nsgct") {
        parsed.diseaseLabel = "NSGCT — stage I";
        if (parsed.clinicalAxes.stage1RiskFactors === "with_risk_factors") {
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage1_lvi_positive"]);
        } else if (parsed.clinicalAxes.stage1RiskFactors === "without_risk_factors") {
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage1_lvi_negative"]);
        }
        pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage1", "gct_stage1_general"]);
      } else {
        parsed.diseaseLabel = "GCT — stage I";
        pushDiseaseIds(parsed.diseaseSettingIds, ["gct_stage1_general"]);
      }
    } else if (["stage_2a", "stage_2b"].includes(stage)) {
      parsed.diseaseGroup = "stage2";
      if (histology === "pure_seminoma") {
        parsed.diseaseLabel = "Seminoma — stage IIA/IIB";
        pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_stage2a_2b", "gct_advanced_general"]);
      } else if (histology === "nsgct" || histology === "mixed_seminoma_nsgct") {
        parsed.diseaseLabel = "NSGCT — stage IIA/IIB";
        pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage2a_2b", "gct_advanced_general"]);
      } else {
        parsed.diseaseLabel = "GCT — stage IIA/IIB";
        pushDiseaseIds(parsed.diseaseSettingIds, ["gct_advanced_general"]);
      }
    } else if (["stage_2c", "stage_3a", "stage_3b", "stage_3c", "stage_3_unspecified"].includes(stage) || /advanced|metastatic/i.test(text)) {
      parsed.diseaseGroup = "advanced";
      if (histology === "pure_seminoma") {
        parsed.diseaseLabel = "Seminoma — advanced";
        pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_stage2c_3", "gct_advanced_general"]);
      } else if (histology === "nsgct" || histology === "mixed_seminoma_nsgct") {
        if (parsed.clinicalAxes.igcccgRisk === "good") {
          parsed.diseaseLabel = "NSGCT — good-risk advanced";
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_good_risk_advanced", "gct_advanced_general"]);
        } else if (parsed.clinicalAxes.igcccgRisk === "intermediate" || parsed.clinicalAxes.igcccgRisk === "poor") {
          parsed.diseaseLabel = "NSGCT — intermediate/poor-risk advanced";
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_intermediate_poor_risk_advanced", "gct_advanced_general"]);
        } else {
          parsed.diseaseLabel = "NSGCT — advanced";
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_good_risk_advanced", "nsgct_intermediate_poor_risk_advanced", "gct_advanced_general"]);
        }
      } else {
        parsed.diseaseLabel = "Advanced GCT";
        pushDiseaseIds(parsed.diseaseSettingIds, ["gct_advanced_general"]);
      }
    } else {
      parsed.diseaseGroup = "gct";
      parsed.diseaseLabel = "Testicular / germ-cell tumor";
    }

    finalizeDiseaseSettingIds(parsed);

    if (parsed.diseaseLabel) addChip(parsed.chips, "Disease", parsed.diseaseLabel);
    if (parsed.clinicalAxes.histology) addChip(parsed.chips, "Disease", parsed.clinicalAxes.histology === "pure_seminoma" ? "Seminoma" : parsed.clinicalAxes.histology === "nsgct" ? "NSGCT" : "Mixed GCT");
    if (parsed.clinicalAxes.igcccgRisk) addChip(parsed.chips, "Risk", `IGCCCG ${parsed.clinicalAxes.igcccgRisk}`);
    if (parsed.clinicalAxes.primarySite && parsed.clinicalAxes.primarySite !== "testicular") addChip(parsed.chips, "Disease", parsed.clinicalAxes.primarySite === "extragonadal" ? "Extragonadal primary" : `${parsed.clinicalAxes.primarySite.replace(/_/g, " ")} primary`);
    if (parsed.clinicalAxes.priorChemoLines === "0") addChip(parsed.chips, "Treatment", "Chemo-naive");
    if (parsed.clinicalAxes.priorChemoLines === "1") addChip(parsed.chips, "Treatment", "One prior line");
    if (parsed.clinicalAxes.priorChemoLines === "2+") addChip(parsed.chips, "Treatment", "Multiple prior lines");
    if (parsed.clinicalAxes.priorHdct === "yes") addChip(parsed.chips, "Treatment", "Prior HDCT");
    if (parsed.clinicalAxes.markerStatus === "markers_normal") addChip(parsed.chips, "Biomarker", "Markers normal");
    if (parsed.clinicalAxes.markerStatus === "markers_elevated") addChip(parsed.chips, "Biomarker", "Markers elevated");
    if (parsed.clinicalAxes.markerStatus === "afp_elevated") addChip(parsed.chips, "Biomarker", "AFP elevated");
    if (parsed.clinicalAxes.markerStatus === "hcg_elevated") addChip(parsed.chips, "Biomarker", "beta-hCG elevated");
    if (parsed.clinicalAxes.markerStatus === "ldh_elevated") addChip(parsed.chips, "Biomarker", "LDH elevated");
    if (parsed.clinicalAxes.markerStatus === "multiple_elevated") addChip(parsed.chips, "Biomarker", "Multiple markers elevated");
    if (parsed.clinicalAxes.gctResidualMassSizeCm) addChip(parsed.chips, "Disease", `Residual mass ${parsed.clinicalAxes.gctResidualMassSizeCm} cm`);
    if (parsed.clinicalAxes.gctMarkerTrend) addChip(parsed.chips, "Biomarker", `Markers ${parsed.clinicalAxes.gctMarkerTrend.replace(/_/g, " ")}`);
    if (parsed.clinicalAxes.gctSalvageLine) addChip(parsed.chips, "Treatment", parsed.clinicalAxes.gctSalvageLine.replace(/_/g, " "));
  }

  function populateTemporalFacts(parsed, text) {
    parsed.temporalFacts.sinceLastSystemicTherapyDays = detectSinceLastSystemicTherapyDays(text);
    parsed.temporalFacts.sinceLastRadiationDays = detectSinceLastRadiationDays(text);
    parsed.temporalFacts.sinceLastSurgeryDays = detectSinceLastSurgeryDays(text);
    parsed.temporalFacts.recentImagingDays = detectRecentImagingDays(text);
    parsed.temporalFacts.progressedAfterTherapies = detectProgressedAfterTherapies(text);
    parsed.temporalFacts.persistentMarkersAfterOrchiectomy = detectPersistentMarkersAfterOrchiectomy(text);
  }

  function populateTherapyHistory(parsed, text) {
    const history = parsed.therapyHistory;
    const temporal = parsed.temporalFacts || {};
    const axes = parsed.clinicalAxes || {};

    detectExplicitTherapyMentions(text).forEach(therapy => addTherapy(history.receivedTherapies, therapy));

    (temporal.progressedAfterTherapies || []).forEach(therapy => {
      addTherapy(history.progressedOnTherapies, therapy);
      addTherapy(history.receivedTherapies, therapy);
    });

    if (axes.priorArpi === "yes" && !history.receivedTherapies.some(therapy => ["enzalutamide", "abiraterone", "apalutamide", "darolutamide"].includes(therapy))) {
      addTherapy(history.receivedTherapies, "arpi");
    }

    if (axes.priorDocetaxel === "yes") {
      addTherapy(history.receivedTherapies, "docetaxel");
    }

    if (parsed.cancerType === "Prostate" && /\badt\b|androgen deprivation|lhrh|gnrh|leuprolide|goserelin|degarelix|relugolix/i.test(text) && !hasExplicitNegativeTherapyContext(text, "adt") && !/\b(?:no|without)\s+(?:prior\s+)?(?:adt|androgen deprivation)/i.test(text)) {
      addTherapy(history.receivedTherapies, "adt");
    }
  }

  function populatePlannedTherapies(parsed, rawText) {
    detectPlannedTherapyMentions(rawText).forEach(therapy => addTherapy(parsed.therapyHistory.plannedTherapies, therapy));
  }

  function populateScreeningFacts(parsed, text) {
    parsed.screeningFacts.ecogStatus = detectEcogStatus(text);
    parsed.screeningFacts.labState = detectLabState(text);
    parsed.screeningFacts.organFunctionState = detectOrganFunctionState(text);
    parsed.screeningFacts.laboratoryResults = detectNumericLabResults(text);
  }

  function addTemporalChips(parsed) {
    const temporal = parsed.temporalFacts || {};

    (temporal.progressedAfterTherapies || []).forEach(therapy => {
      addChip(parsed.chips, "Temporal", `Progressed after ${therapy}`);
    });
    if (Number.isFinite(temporal.sinceLastSystemicTherapyDays)) {
      addChip(parsed.chips, "Temporal", `Last systemic therapy ${temporal.sinceLastSystemicTherapyDays}d ago`);
    }
    if (Number.isFinite(temporal.sinceLastRadiationDays)) {
      addChip(parsed.chips, "Temporal", `Last radiation ${temporal.sinceLastRadiationDays}d ago`);
    }
    if (Number.isFinite(temporal.sinceLastSurgeryDays)) {
      addChip(parsed.chips, "Temporal", `Last surgery ${temporal.sinceLastSurgeryDays}d ago`);
    }
    if (Number.isFinite(temporal.recentImagingDays)) {
      addChip(parsed.chips, "Temporal", `Imaging ${temporal.recentImagingDays}d ago`);
    }
    if (temporal.persistentMarkersAfterOrchiectomy === "yes") {
      addChip(parsed.chips, "Temporal", "Persistent markers after orchiectomy");
    }
  }

  function addScreeningChips(parsed) {
    const screening = parsed.screeningFacts || {};

    if (screening.ecogStatus === "ecog_0") addChip(parsed.chips, "Screening", "ECOG 0");
    if (screening.ecogStatus === "ecog_1") addChip(parsed.chips, "Screening", "ECOG 1");
    if (screening.ecogStatus === "ecog_2") addChip(parsed.chips, "Screening", "ECOG 2");
    if (screening.ecogStatus === "ecog_3_4") addChip(parsed.chips, "Screening", "ECOG 3-4");

    if (screening.labState === "within_range") addChip(parsed.chips, "Screening", "Labs within range");
    if (screening.labState === "mildly_abnormal") addChip(parsed.chips, "Screening", "Labs mildly abnormal");
    if (screening.labState === "markedly_abnormal") addChip(parsed.chips, "Screening", "Labs markedly abnormal");

    if (screening.organFunctionState === "adequate") addChip(parsed.chips, "Screening", "Organ function adequate");
    if (screening.organFunctionState === "mild_impairment") addChip(parsed.chips, "Screening", "Mild organ impairment");
    if (screening.organFunctionState === "marked_impairment") addChip(parsed.chips, "Screening", "Marked organ impairment");
  }

  function findSourceSpan(text, patterns, assertionText) {
    const searchable = assertionText == null ? text : assertionText;
    for (const pattern of patterns || []) {
      const match = pattern.exec(searchable);
      pattern.lastIndex = 0;
      if (match) {
        const sourceValue = text.slice(match.index, match.index + match[0].length);
        return schemaApi?.makeSourceSpan
          ? schemaApi.makeSourceSpan(sourceValue, match.index, match.index + match[0].length)
          : { field: "patientNarrative", text: sourceValue, start: match.index, end: match.index + match[0].length };
      }
    }
    return schemaApi?.makeSourceSpan
      ? schemaApi.makeSourceSpan("", 0, 0)
      : { field: "patientNarrative", text: "", start: 0, end: 0 };
  }

  function eventTimeNearSpan(text, span) {
    if (!span || !Number.isInteger(span.start)) return null;
    const leftBoundary = Math.max(text.lastIndexOf(".", span.start), text.lastIndexOf(";", span.start), text.lastIndexOf("\n", span.start));
    const rightCandidates = [text.indexOf(".", span.end), text.indexOf(";", span.end), text.indexOf("\n", span.end)]
      .filter(value => value >= 0);
    const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : text.length;
    const clause = text.slice(Math.max(0, leftBoundary + 1), rightBoundary);
    const match = clause.match(/\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
    if (!match) return null;
    const iso = `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }

  const AXIS_SOURCE_PATTERNS = {
    bcgStatus: [/bcg[- ](?:unresponsive|refractory|resistant|intolerant|naive)/i, /after adequate bcg/i],
    bcgAdequacy: [/adequate bcg|inadequate bcg|induction plus maintenance/i],
    bcgTimingPattern: [/within \d+ (?:months?|years?) of bcg|bcg[^.]{0,30}(?:recurrence|persistent)/i],
    cisplatinStatus: [/cisplatin[- ](?:eligible|ineligible|fit|unfit)/i],
    cisPapillaryPattern: [/carcinoma in situ|\bcis\b|papillary|high[- ]grade (?:ta|t1)/i],
    castrationStatus: [/castration[- ](?:resistant|sensitive)|hormone[- ]sensitive|\bmcrpc\b|\bmcspc\b|\bmhspc\b|\bnmcrpc\b/i],
    metastaticStatus: [/non[- ]metastatic|\bmetastatic\b|\bm0\b|\bm1\b/i],
    diseaseVolume: [/high[- ]volume|low[- ]volume|oligometastatic|\d+ bone (?:mets|metastases|lesions)|visceral (?:disease|metastases)/i],
    priorArpi: [/no prior arpi|arpi[- ]naive|prior arpi|enzalutamide|abiraterone|apalutamide|darolutamide/i],
    priorDocetaxel: [/no prior docetaxel|docetaxel[- ]naive|prior docetaxel|received docetaxel|progressed on[^.]{0,24}docetaxel/i],
    hrrGene: [/brca\s*[12]?|atm|cdk12|palb2|chek2|hrr/i],
    biomarkerHrr: [/(?:brca|hrr|homologous recombination)[^.]{0,24}(?:positive|negative|mutation|wild[- ]type)/i],
    psmaStatus: [/psma[^.]{0,24}(?:positive|negative|avid)/i],
    genomicClassifier: [/decipher|oncotype gps|prolaris|artera ai|genomic (?:risk )?classifier/i],
    fgfr3Status: [/fgfr3[^.]{0,32}(?:mutation|fusion|altered|positive|negative|wild[- ]type|not detected)/i],
    fgfrAlteration: [/fgfr[23]?[^.]{0,32}(?:mutation|fusion|altered|positive|negative|wild[- ]type)/i],
    her2Status: [/(?:her2|erbb2)[^.]{0,24}(?:3\+|2\+|1\+|positive|negative|low|equivocal)/i],
    histology: [/clear[- ]cell|non[- ]clear[- ]cell|papillary|chromophobe|medullary|collecting duct|seminoma|non[- ]seminomatous|nsgct|mixed germ cell/i],
    imdcRisk: [/imdc[^.]{0,20}(?:favorable|intermediate|poor)/i],
    priorSystemicLines: [/(?:no|one|two|\d+) prior (?:systemic )?(?:line|lines)|first[- ]line|second[- ]line|third[- ]line/i],
    priorIo: [/no prior (?:io|immunotherapy|nivolumab|pembrolizumab|ipilimumab)|prior (?:io|immunotherapy)|(?:received|after|progressed on) (?:nivolumab|pembrolizumab|ipilimumab)/i],
    priorVegfTki: [/no prior (?:vegf|tki|cabozantinib|axitinib|lenvatinib)|prior (?:vegf|tki)|(?:received|after|progressed on) (?:cabozantinib|axitinib|lenvatinib|sunitinib|pazopanib)/i],
    nephrectomyStatus: [/post[- ]nephrectomy|prior nephrectomy|after nephrectomy|unresected primary|nephrectomy candidate/i],
    vhlStatus: [/(?:germline|somatic|hereditary)?[^.]{0,16}(?:vhl|von hippel[- ]lindau)[^.]{0,20}(?:mutation|disease|syndrome|loss|altered)?/i],
    metAlteration: [/\bmet\b[^.]{0,20}(?:mutation|amplification|altered)/i],
    sarcomatoid: [/sarcomatoid/i],
    clinicalStage: [/stage\s*(?:is|i[abc]?|ii[abc]?|iii[abc]?)/i],
    igcccgRisk: [/igcccg[^.]{0,20}(?:good|intermediate|poor)/i],
    primarySite: [/mediastinal|intracranial|retroperitoneal primary|extragonadal|testicular primary/i],
    priorChemoLines: [/(?:no|one|two|\d+) prior (?:chemo|chemotherapy|lines?)|after (?:bep|ep|tip|veip|vip)|post[- ]first[- ]line/i],
    priorHdct: [/no prior (?:hdct|high[- ]dose chemotherapy)|prior (?:hdct|high[- ]dose chemotherapy)|ti-?ce|stem cell rescue/i],
    markerStatus: [/(?:afp|hcg|ldh|markers?)[^.]{0,24}(?:elevated|rising|normal|negative)/i],
    stage1RiskFactors: [/no (?:lymphovascular invasion|lvi)|lymphovascular invasion|\blvi\b|spermatic cord invasion|rete testis/i]
  };

  function makeCandidateFact(options) {
    if (schemaApi?.createPatientFact) {
      return schemaApi.createPatientFact({
        ...options,
        extractor: { type: "rule", version: "patient-query-parser-2.0.0" },
        confirmation: options.confirmation || "unreviewed"
      });
    }
    return {
      factId: `pf-${options.concept}-${options.sourceSpan?.start || 0}`,
      concept: { system: "local", code: options.concept, display: options.display || options.concept },
      predicate: options.predicate || "has",
      value: options.value,
      assertion: options.assertion || "present",
      status: options.status || "current",
      sourceSpan: options.sourceSpan,
      confirmation: options.confirmation || "unreviewed"
    };
  }

  function buildCandidateFacts(parsed, text, assertionText) {
    const facts = [];
    const add = options => {
      if (!options.sourceSpan?.text || options.sourceSpan.end <= options.sourceSpan.start) return;
      const fact = makeCandidateFact(options);
      if (!facts.some(existing => existing.factId === fact.factId)) facts.push(fact);
    };

    add({
      concept: "cancer_type",
      display: "Cancer type",
      predicate: "has_diagnosis",
      value: parsed.cancerType,
      sourceSpan: findSourceSpan(text, CANCER_SIGNALS[parsed.cancerType]?.map(item => item.pattern) || [], assertionText)
    });
    if (parsed.diseaseLabel) {
      add({
        concept: "disease_context",
        display: "Disease context",
        predicate: "has_diagnosis",
        value: parsed.diseaseGroup || parsed.diseaseLabel,
        sourceSpan: findSourceSpan(text, [/\bnmcrpc\b|\bmcrpc\b|\bmcspc\b|\bmhspc\b|biochemical recurrence|\bbcr\b|localized|metastatic|high risk|unfavo[u]?rable intermediate/i], assertionText)
      });
    }

    if (Number.isFinite(parsed.demographics?.ageYears)) {
      add({
        concept: "ageYears",
        display: "Age",
        predicate: "has",
        value: parsed.demographics.ageYears,
        sourceSpan: findSourceSpan(text, [/\b\d{1,3}[- ](?:year|yr)s?[- ]old\b/i, /\bage(?:d)?\s*(?:is|:|=)?\s*\d{1,3}\s*(?:years?|yrs?)?\b/i, /\b\d{1,3}\s*(?:yo|y\/o)\b/i], assertionText)
      });
    }
    if (parsed.demographics?.administrativeSex) {
      add({
        concept: "administrativeSex",
        display: "Administrative sex",
        predicate: "has",
        value: parsed.demographics.administrativeSex,
        sourceSpan: findSourceSpan(text, [/\b(?:female|woman|male|man)\b/i], assertionText)
      });
    }

    Object.entries(parsed.clinicalAxes || {}).forEach(([axis, value]) => {
      if (value == null || value === "" || value === "unknown") return;
      const assertion = ["no", "negative", "wild_type", "without_risk_factors"].includes(String(value).toLowerCase()) ? "absent" : "present";
      add({
        concept: axis,
        display: axis.replace(/([a-z])([A-Z])/g, "$1 $2"),
        predicate: "has",
        value,
        assertion,
        sourceSpan: findSourceSpan(text, AXIS_SOURCE_PATTERNS[axis] || [new RegExp(String(value).replace(/_/g, "[ _-]"), "i")], assertionText)
      });
    });

    (parsed.therapyHistory?.receivedTherapies || []).forEach(therapy => {
      const escaped = therapy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]?");
      const sourceSpan = findSourceSpan(text, [new RegExp(`(?:received|prior|on|after|treated with)?[^.;]{0,20}${escaped}`, "i")], assertionText);
      add({
        concept: "treatment_exposure",
        display: "Treatment exposure",
        predicate: "received",
        value: therapy,
        sourceSpan,
        status: "historical",
        temporality: { eventTime: eventTimeNearSpan(text, sourceSpan), relativeTo: "screening" }
      });
    });
    // Retain separate explicit occurrences, including denials, so a global
    // negation cannot erase a conflicting statement about the same drug.
    EXPLICIT_THERAPIES.forEach(therapy => {
      const escaped = therapy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[ _-]?');
      const pattern = new RegExp(`\\b(?:no(?: prior)?|never received|received|previously received|prior|treated with)\\s+${escaped}\\b`, 'gi');
      for (const match of assertionText.matchAll(pattern)) {
        const sourceSpan = { start: match.index, end: match.index + match[0].length, text: text.slice(match.index, match.index + match[0].length) };
        add({ concept: 'treatment_exposure', display: 'Treatment exposure', predicate: 'received', value: therapy,
          assertion: /^(?:no|never)/i.test(match[0]) ? 'absent' : 'present', status: 'historical', sourceSpan,
          temporality: { eventTime: eventTimeNearSpan(text, sourceSpan), relativeTo: 'screening' } });
      }
    });
    (parsed.therapyHistory?.progressedOnTherapies || []).forEach(therapy => {
      const escaped = therapy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]?");
      const sourceSpan = findSourceSpan(text, [new RegExp(`progress(?:ed|ion)? (?:on|after|following)[^.;]{0,20}${escaped}`, "i")], assertionText);
      add({
        concept: "treatment_exposure",
        display: "Treatment exposure",
        predicate: "progressed_on",
        value: therapy,
        sourceSpan,
        status: "historical",
        temporality: { eventTime: eventTimeNearSpan(text, sourceSpan), relativeTo: "screening" }
      });
    });
    (parsed.therapyHistory?.plannedTherapies || []).forEach(therapy => {
      const escaped = therapy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]?");
      const sourceSpan = findSourceSpan(text, [
        new RegExp(`(?:considering|planning|planned|may start|might start|candidate for|recommended|will start|to start)[^.;]{0,24}${escaped}`, "i"),
        new RegExp(`${escaped}[^.;]{0,24}(?:planned|being considered|under consideration)`, "i")
      ]);
      add({
        concept: "treatment_exposure",
        display: "Planned treatment (not prior exposure)",
        predicate: "planned",
        value: therapy,
        assertion: "hypothetical",
        status: "planned",
        sourceSpan
      });
    });

    const screeningMap = {
      ecogStatus: [/\b(?:ecog|performance status|ps)\s*(?:of\s*)?[0-4](?:\s*(?:-|to|or|\/)\s*[0-4])?/i],
      labState: [/\b(?:labs?|cbc|cmp|hemoglobin|platelets|anc)\b[^.]{0,28}\b(?:normal|abnormal|wnl|adequate|low|high)\b|\b(?:normal|abnormal) (?:labs?|cbc|cmp)/i],
      organFunctionState: [/adequate organ function|renal function[^.]{0,20}(?:normal|adequate|impaired)|hepatic function[^.]{0,20}(?:normal|adequate|impaired)|dialysis|creatinine clearance[^.]{0,16}\d+/i]
    };
    Object.entries(parsed.screeningFacts || {}).forEach(([field, value]) => {
      if (field === "laboratoryResults") return;
      if (!value) return;
      const sourceSpan = findSourceSpan(text, screeningMap[field] || [], assertionText);
      if (field === 'ecogStatus') {
        const exact = sourceSpan.text.match(/^(?:ecog|performance status|ps)\s*(?:of\s*)?([0-4])$/i);
        if (!exact) return;
        add({ concept: field, display: 'ECOG performance status', predicate: 'has', value: Number(exact[1]), sourceSpan, observedAt: eventTimeNearSpan(text, sourceSpan) });
      } else {
        add({ concept: field, display: field.replace(/([a-z])([A-Z])/g, "$1 $2"), predicate: "has", value, sourceSpan });
      }
    });

    (parsed.screeningFacts?.laboratoryResults || []).forEach(result => {
      add({
        concept: result.concept,
        display: result.display,
        predicate: "has",
        value: result.value,
        unit: result.unit,
        observedAt: result.observedAt,
        normalization: result.normalization,
        sourceSpan: result.sourceSpan
      });
    });

    const temporalMap = {
      sinceLastSystemicTherapyDays: [/last (?:systemic )?(?:therapy|treatment)[^.]{0,24}(?:ago|prior)|\d+\s*(?:days?|weeks?|months?)\s*(?:since|after) (?:systemic )?(?:therapy|treatment)/i],
      sinceLastRadiationDays: [/last (?:radiation|radiotherapy|rt)[^.]{0,24}(?:ago|prior)|\d+\s*(?:days?|weeks?|months?)\s*(?:since|after) (?:radiation|radiotherapy|rt)/i],
      sinceLastSurgeryDays: [/last surgery[^.]{0,24}(?:ago|prior)|\d+\s*(?:days?|weeks?|months?)\s*(?:since|after) surgery/i],
      recentImagingDays: [/(?:imaging|scan|pet|ct|mri)[^.]{0,24}(?:ago|within|prior)/i]
    };
    Object.entries(parsed.temporalFacts || {}).forEach(([field, value]) => {
      if (!Number.isFinite(value)) return;
      add({ concept: field, display: field.replace(/([a-z])([A-Z])/g, "$1 $2"), predicate: "has", value, validAt: new Date().toISOString(), sourceSpan: findSourceSpan(text, temporalMap[field] || [], assertionText), temporality: { eventTime: null, relativeTo: "screening", daysBefore: value } });
    });

    return facts;
  }

  function detectDirectIdentifierWarnings(text) {
    const warnings = [];
    const rules = [
      ["medical_record_number", /\b(?:mrn|medical record(?: number)?)[\s:#-]*[a-z0-9-]{4,}\b/i],
      ["email_address", /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i],
      ["phone_number", /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/],
      ["date_of_birth", /\b(?:dob|date of birth|born)\s*[:#-]?\s*(?:\d{1,2}[/-]){2}\d{2,4}\b/i],
      ["postal_address", /\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln)\b/i]
    ];
    rules.forEach(([code, pattern]) => {
      if (pattern.test(text)) warnings.push({ code, message: `Possible ${code.replace(/_/g, " ")} detected. Remove direct identifiers before matching.` });
    });
    return warnings;
  }

  function deriveIgnoredText(text, facts) {
    const used = (facts || []).map(fact => fact.sourceSpan).filter(span => span && span.end > span.start);
    const ignored = [];
    const sentencePattern = /[^.!?\n]+[.!?]?/g;
    let match;
    while ((match = sentencePattern.exec(text))) {
      const sentence = match[0].trim();
      if (!sentence) continue;
      const start = match.index + match[0].indexOf(sentence);
      const end = start + sentence.length;
      const overlaps = used.some(span => span.start < end && span.end > start);
      if (!overlaps) ignored.push({ text: sentence, start, end, status: "not_modeled" });
    }
    return ignored;
  }

  function buildCriticalQuestions(parsed) {
    const questions = [];
    const add = (code, question) => {
      if (!questions.some(item => item.code === code)) questions.push({ code, question, critical: true });
    };
    if (!parsed.diseaseGroup) add("disease_context", "What is the current disease setting and stage?");
    if (!parsed.screeningFacts?.ecogStatus) add("ecog_status", "What is the current ECOG performance status?");
    if (parsed.cancerType === "Prostate" && parsed.diseaseGroup === "metastatic_unspecified") add("castration_status", "Is the metastatic disease castration-sensitive or castration-resistant?");
    if (parsed.cancerType === "Bladder" && /nmibc/i.test(parsed.diseaseLabel || "") && !parsed.clinicalAxes?.bcgStatus) add("bcg_status", "Was BCG adequate, and when did high-grade disease recur or persist?");
    if (parsed.cancerType === "Kidney" && !parsed.clinicalAxes?.histology) add("kidney_histology", "What is the RCC histologic subtype?");
    if (parsed.cancerType === "Testicular" && !parsed.clinicalAxes?.histology) add("gct_histology", "Is the tumor pure seminoma, NSGCT, or mixed GCT?");
    const receivedFacts = (parsed.candidateFacts || []).filter(fact => fact?.concept?.code === "treatment_exposure" && fact.predicate === "received");
    if (receivedFacts.some(fact => !fact.temporality?.eventTime)) {
      add("treatment_dates", "What are the exact start/stop or last-administration dates for each prior systemic therapy?");
    }
    if ((parsed.contextWarnings || []).some(item => item.code === "uncertain_assertion_excluded")) {
      add("uncertain_assertion", "Can the uncertain disease finding be confirmed, ruled out, or dated from definitive imaging/pathology?");
    }
    return questions;
  }

  function applyFactDecisions(parsed, decisions) {
    const decisionMap = decisions || {};
    const enteredAt = new Date().toISOString();
    const facts = (parsed?.candidateFacts || []).flatMap((fact, index) => {
      const decision = typeof decisionMap === "object" ? decisionMap[fact.factId] : null;
      if (!decision) return [{ ...fact }];
      if (typeof decision === "string") return [{ ...fact, confirmation: decision, enteredAt }];
      const confirmation = decision.confirmation || "confirmed";
      if (confirmation !== "corrected") {
        return [{ ...fact, ...decision, confirmation, enteredAt }];
      }
      const correctedFact = {
        ...fact,
        ...decision,
        factId: `${fact.factId}-manual-correction-${index + 1}`,
        confirmation: "corrected",
        sourceType: "manual",
        extractor: { type: "manual", version: "physician-fact-review-1.0.0" },
        supersedes: fact.factId,
        enteredAt
      };
      const originalFact = {
        ...fact,
        confirmation: "rejected",
        rejectionReason: "superseded_by_physician_correction",
        supersededBy: correctedFact.factId,
        enteredAt
      };
      return [originalFact, correctedFact];
    });
    const contradictions = schemaApi?.detectContradictions ? schemaApi.detectContradictions(facts) : [];
    return {
      schemaVersion: schemaApi?.SCHEMA_VERSION || "1.0.0",
      patientVersion: `patient-${Date.now()}`,
      facts,
      contradictions,
      ignoredText: parsed?.ignoredText || [],
      directIdentifierWarnings: parsed?.directIdentifierWarnings || [],
      confirmedAt: enteredAt
    };
  }

  function reconcileReviewedFacts(parsed, patientFactSet) {
    const facts = Array.isArray(patientFactSet?.facts) ? patientFactSet.facts : [];
    const candidateFacts = Array.isArray(parsed?.candidateFacts) ? parsed.candidateFacts : [];
    const token = value => schemaApi?.canonicalToken
      ? schemaApi.canonicalToken(value)
      : String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const reviewed = facts.filter(fact =>
      ["confirmed", "corrected"].includes(token(fact?.confirmation)) &&
      token(fact?.experiencer || "patient") === "patient"
    );
    const definite = reviewed.filter(fact =>
      ["present", "absent", "positive", "negative"].includes(token(fact?.assertion)) &&
      !["planned", "unknown"].includes(token(fact?.status))
    );
    const originalConcepts = new Set(candidateFacts.map(fact => token(fact?.concept?.code || fact?.conceptId)));
    const lastFact = (collection, concept, predicate) => {
      const matches = collection.filter(fact =>
        token(fact?.concept?.code || fact?.conceptId) === token(concept) &&
        (!predicate || token(fact?.predicate) === token(predicate))
      );
      return matches.length ? matches[matches.length - 1] : null;
    };
    const cloneMap = value => ({ ...(value || {}) });
    const next = {
      ...parsed,
      clinicalAxes: cloneMap(parsed?.clinicalAxes),
      temporalFacts: cloneMap(parsed?.temporalFacts),
      therapyHistory: {
        ...cloneMap(parsed?.therapyHistory),
        receivedTherapies: [...(parsed?.therapyHistory?.receivedTherapies || [])],
        progressedOnTherapies: [...(parsed?.therapyHistory?.progressedOnTherapies || [])],
        plannedTherapies: [...(parsed?.therapyHistory?.plannedTherapies || [])]
      },
      screeningFacts: {
        ...cloneMap(parsed?.screeningFacts),
        laboratoryResults: [...(parsed?.screeningFacts?.laboratoryResults || [])]
      },
      demographics: cloneMap(parsed?.demographics),
      patientFactSet,
      reviewReconciled: true
    };

    const cancerFact = lastFact(definite.filter(fact => ["present", "positive"].includes(token(fact.assertion))), "cancer_type", "has_diagnosis");
    if (originalConcepts.has("cancer_type")) {
      const cancerMap = { prostate: "Prostate", bladder: "Bladder", bladder_urothelial: "Bladder", kidney: "Kidney", kidney_rcc: "Kidney", testicular: "Testicular", testicular_gct: "Testicular" };
      const reviewedCancer = cancerMap[token(cancerFact?.value)] || "";
      const cancerDecisionMade = facts.some(fact => token(fact?.concept?.code) === 'cancer_type' && token(fact.confirmation) !== 'unreviewed');
      if (!reviewedCancer && cancerDecisionMade) {
        next.supported = false;
        next.unsupportedReason = "The patient's own supported cancer diagnosis was rejected or remains uncertain.";
        next.cancerType = "";
        next.diseaseGroup = "";
        next.diseaseLabel = "";
        next.diseaseSettingIds = [];
      } else if (reviewedCancer && reviewedCancer !== parsed.cancerType) {
        next.cancerType = reviewedCancer;
        next.diseaseGroup = "";
        next.diseaseLabel = "";
        next.diseaseSettingIds = [];
      }
    }

    const diseaseFact = lastFact(definite.filter(fact => ["present", "positive"].includes(token(fact.assertion))), "disease_context", "has_diagnosis");
    if (originalConcepts.has("disease_context")) {
      const diseaseDecisionMade = facts.some(fact => token(fact?.concept?.code) === 'disease_context' && token(fact.confirmation) !== 'unreviewed');
      if (!diseaseFact && diseaseDecisionMade) {
        next.diseaseGroup = "";
        next.diseaseLabel = "";
        next.diseaseSettingIds = [];
      } else if (diseaseFact && token(diseaseFact.value) !== token(parsed.diseaseGroup || parsed.diseaseLabel)) {
        next.diseaseGroup = String(diseaseFact.value || "");
        next.diseaseLabel = String(diseaseFact.value || "").replace(/_/g, " ");
        // A manual free-text correction cannot safely inherit IDs derived from
        // the original phrase. Broad same-cancer retrieval avoids a false miss.
        next.diseaseSettingIds = [];
      }
    }

    const applyMappedFields = (target, defaults) => {
      Object.keys(defaults).forEach(field => {
        const concept = token(field);
        if (!originalConcepts.has(concept)) return;
        const fact = lastFact(definite, concept, "has");
        target[field] = fact ? fact.value : defaults[field];
      });
    };
    applyMappedFields(next.clinicalAxes, createClinicalAxes());
    applyMappedFields(next.demographics, { ageYears: null, administrativeSex: "" });
    applyMappedFields(next.screeningFacts, { ecogStatus: "", labState: "", organFunctionState: "" });
    applyMappedFields(next.temporalFacts, {
      sinceLastSystemicTherapyDays: null,
      sinceLastRadiationDays: null,
      sinceLastSurgeryDays: null,
      recentImagingDays: null
    });

    const originalLabConcepts = new Set((parsed?.screeningFacts?.laboratoryResults || []).map(item => token(item.concept)));
    if (originalLabConcepts.size > 0) {
      next.screeningFacts.laboratoryResults = definite
        .filter(fact => originalLabConcepts.has(token(fact?.concept?.code || fact?.conceptId)) && token(fact?.predicate) === "has")
        .map(fact => ({
          concept: fact.concept.code,
          display: fact.concept.display,
          value: fact.value,
          unit: fact.unit || null,
          observedAt: fact.observedAt || null,
          normalization: fact.normalization || null,
          sourceSpan: fact.sourceSpan
        }));
    }

    if (originalConcepts.has("treatment_exposure")) {
      const positiveTherapyFacts = reviewed.filter(fact =>
        token(fact?.concept?.code || fact?.conceptId) === "treatment_exposure" &&
        token(fact?.experiencer || "patient") === "patient"
      );
      next.therapyHistory.receivedTherapies = Array.from(new Set(positiveTherapyFacts
        .filter(fact => token(fact.predicate) === "received" && ["present", "positive"].includes(token(fact.assertion)) && !["planned", "unknown"].includes(token(fact.status)))
        .map(fact => fact.value)));
      next.therapyHistory.progressedOnTherapies = Array.from(new Set(positiveTherapyFacts
        .filter(fact => token(fact.predicate) === "progressed_on" && ["present", "positive"].includes(token(fact.assertion)) && !["planned", "unknown"].includes(token(fact.status)))
        .map(fact => fact.value)));
      next.therapyHistory.plannedTherapies = Array.from(new Set(positiveTherapyFacts
        .filter(fact => token(fact.predicate) === "planned" || token(fact.status) === "planned")
        .map(fact => fact.value)));
      next.temporalFacts.progressedAfterTherapies = next.therapyHistory.progressedOnTherapies.slice();
    }

    const semanticallyChanged = facts.some(fact => token(fact.confirmation) === "corrected" || token(fact.confirmation) === "rejected");
    const changedDiseaseLogic = facts.some(fact => {
      const concept = token(fact?.concept?.code || fact?.conceptId);
      return ["corrected", "rejected"].includes(token(fact.confirmation)) && (concept === "cancer_type" || concept === "disease_context" || Object.keys(createClinicalAxes()).some(axis => token(axis) === concept));
    });
    if (changedDiseaseLogic) {
      next.diseaseSettingIds = [];
      next.diseaseLabel = next.diseaseGroup ? String(next.diseaseGroup).replace(/_/g, " ") : "";
    }
    if (semanticallyChanged) {
      next.chips = definite.slice(0, 10).map(fact => ({
        group: "Reviewed",
        label: `${fact.concept?.display || fact.concept?.code}: ${String(fact.value ?? "confirmed").replace(/_/g, " ")}`
      }));
    }
    next.criticalQuestions = buildCriticalQuestions(next);
    next.requiresConfirmation = facts.some(fact => token(fact.confirmation) === "unreviewed") || (patientFactSet?.contradictions || []).length > 0;
    return next;
  }

  function parse(query) {
    const rawQuery = String(query || '');
    const parsed = {
      rawQuery,
      supported: false,
      unsupportedReason: "",
      cancerType: "",
      diseaseGroup: "",
      diseaseLabel: "",
      diseaseSettingIds: [],
      clinicalAxes: createClinicalAxes(),
      temporalFacts: createTemporalFacts(),
      therapyHistory: createTherapyHistory(),
      screeningFacts: createScreeningFacts(),
      demographics: { ageYears: null, administrativeSex: "" },
      treatmentPreferences: [],
      phasePreference: "",
      locationPreferences: [],
      chips: [],
      notes: [],
      ignoredDiseaseSettingIds: [],
      candidateFacts: [],
      contradictions: [],
      ignoredText: [],
      criticalQuestions: [],
      contextWarnings: [],
      directIdentifierWarnings: [],
      parserVersion: "2.0.0"
    };

    if (!rawQuery) {
      parsed.unsupportedReason = "Enter a patient description to run matching.";
      return parsed;
    }

    const assertionContext = buildAssertionText(rawQuery);
    const assertionText = assertionContext.text;
    parsed.contextWarnings = assertionContext.warnings;
    parsed.cancerType = detectCancerType(assertionText);
    if (!parsed.cancerType) {
      parsed.unsupportedReason = parsed.contextWarnings.some(item => item.code === "family_history_excluded")
        ? "Only a family-history cancer mention was found. Include the patient's own confirmed diagnosis and current disease setting."
        : "Patient search currently supports prostate, bladder, kidney, and testicular queries. Include the cancer type or a disease-specific term.";
      return parsed;
    }

    parsed.supported = true;
    parsed.treatmentPreferences = detectTreatmentPreferences(rawQuery);
    parsed.phasePreference = detectPhasePreference(rawQuery);
    parsed.locationPreferences = detectLocationTerms(rawQuery);
    parsed.demographics = detectDemographics(assertionText);

    if (parsed.cancerType === "Prostate") {
      parseProstate(parsed, assertionText);
    } else if (parsed.cancerType === "Bladder") {
      parseBladder(parsed, assertionText);
    } else if (parsed.cancerType === "Kidney") {
      parseKidney(parsed, assertionText);
    } else if (parsed.cancerType === "Testicular") {
      parseTesticular(parsed, assertionText);
    }

    populateTemporalFacts(parsed, assertionText);
    populateTherapyHistory(parsed, assertionText);
    populatePlannedTherapies(parsed, rawQuery);
    populateScreeningFacts(parsed, assertionText);
    addChip(parsed.chips, "Cancer", parsed.cancerType);
    if (parsed.phasePreference) addChip(parsed.chips, "Preference", parsed.phasePreference);
    parsed.treatmentPreferences.forEach(pref => addChip(parsed.chips, "Preference", pref.replace(/_/g, " ")));
    parsed.locationPreferences.forEach(location => addChip(parsed.chips, "Location", location));
    parsed.notes.forEach(note => addChip(parsed.chips, "Note", note));
    addTemporalChips(parsed);
    addScreeningChips(parsed);

    parsed.candidateFacts = buildCandidateFacts(parsed, rawQuery, assertionText);
    parsed.contradictions = schemaApi?.detectContradictions
      ? schemaApi.detectContradictions(parsed.candidateFacts)
      : [];
    parsed.ignoredText = deriveIgnoredText(rawQuery, parsed.candidateFacts);
    parsed.criticalQuestions = buildCriticalQuestions(parsed);
    parsed.directIdentifierWarnings = detectDirectIdentifierWarnings(rawQuery);
    parsed.requiresConfirmation = parsed.candidateFacts.some(fact => fact.confirmation !== "confirmed") || parsed.contradictions.length > 0;

    return parsed;
  }

  const api = {
    parse,
    applyFactDecisions,
    reconcileReviewedFacts,
    detectDirectIdentifierWarnings
  };

  global.PatientQueryParser = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
