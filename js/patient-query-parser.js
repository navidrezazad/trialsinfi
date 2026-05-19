(function (global) {
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
      progressedOnTherapies: []
    };
  }

  function createScreeningFacts() {
    return {
      ecogStatus: "",
      labState: "",
      organFunctionState: ""
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

    if (/wild[- ]type|hrr wild[- ]type|brca negative|hrr negative/i.test(text)) {
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

    const scoreMatch = text.match(/score[: ]+([0-9]+(?:\.[0-9]+)?)/i);
    if (scoreMatch) {
      return {
        value: "available",
        label: `Genomic score ${scoreMatch[1]}`
      };
    }

    return { value: "", label: "" };
  }

  function detectDiseaseVolume(text) {
    if (/oligometastatic|oligo[- ]metastatic/i.test(text)) {
      return "oligometastatic";
    }

    if (/high[- ]volume|high[- ]burden/i.test(text)) {
      return "high_volume";
    }

    if (/low[- ]volume|low[- ]burden/i.test(text)) {
      return "low_volume";
    }

    const boneMatch = text.match(/(\d+)\s+(?:bone mets?|bone metastases|bone lesions?)/i);
    if (boneMatch) {
      const count = Number(boneMatch[1]);
      if (Number.isFinite(count)) {
        if (count >= 4) {
          return "high_volume";
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
    return new RegExp(`(?:no prior|without prior|never received|not previously treated with|naive to)[^.;,\\n]{0,24}${escaped}`, "i").test(text)
      || new RegExp(`${escaped}[- ]naive`, "i").test(text);
  }

  function detectExplicitTherapyMentions(text) {
    const mentions = [];
    const explicitTherapies = [
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
    ];

    explicitTherapies.forEach(therapy => {
      const escaped = therapy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]?");
      if (!hasExplicitNegativeTherapyContext(text, therapy) && new RegExp(escaped, "i").test(text)) {
        addTherapy(mentions, therapy);
      }
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
    if (/adequate bcg|induction plus maintenance|at least 5 of 6 induction|2 of 3 maintenance|two induction courses/i.test(text)) {
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
    if (/fgfr3.{0,24}(susceptible alteration|mutation|mutated|fusion|altered|positive)|erdafitinib candidate|fgfr inhibitor candidate/i.test(text)) {
      return "susceptible_alteration";
    }
    if (/fgfr3.{0,24}(wild[- ]type|negative)|no fgfr3 alteration|without fgfr3 alteration/i.test(text)) {
      return "wild_type";
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
    if (/imdc.{0,12}(intermediate|poor)|intermediate[- ]poor/i.test(text)) {
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
    if (/io[- ]naive|no prior io|no prior immunotherapy|no prior pd-?1|no prior pd-?l1/i.test(text)) {
      return "no";
    }
    if (/prior io|prior immunotherapy|prior pd-?1|prior pd-?l1|received nivolumab|received pembrolizumab|received ipilimumab|post[- ]io|after (?:nivolumab|pembrolizumab|ipilimumab)|progressed on (?:nivolumab|pembrolizumab|ipilimumab)|\b(?:nivolumab|pembrolizumab|ipilimumab)\b/i.test(text)) {
      return "yes";
    }
    return "";
  }

  function detectPriorVegfTki(text) {
    if (/vegf[- ]tki[- ]naive|tki[- ]naive|no prior vegf|no prior tki|no prior vegf\/tki/i.test(text)) {
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
    if (/von hippel[- ]lindau|\bvhl\b.{0,16}(mut|altered|associated|disease)|vhl-associated/i.test(text)) {
      return "vhl_altered";
    }
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
    if (/pure seminoma|seminoma only|\bseminoma\b/i.test(text)) {
      return "pure_seminoma";
    }
    if (/mixed germ cell|mixed nonseminoma|mixed seminoma.*nsgct/i.test(text)) {
      return "mixed_gct";
    }
    if (/nonseminoma|non[- ]seminomatous|\bnsgct\b|yolk sac|embryonal|choriocarcinoma|teratoma/i.test(text)) {
      return "nsgct";
    }
    return "";
  }

  function detectClinicalStage(text) {
    if (/stage is|clinical stage is|persistently elevated markers/i.test(text)) {
      return "stage_is";
    }
    if (/stage ia|stage ib|clinical stage i\b|stage i\b/i.test(text)) {
      if (/stage ia/i.test(text)) {
        return "stage_1a";
      }
      return "stage_1_unspecified";
    }
    if (/stage iia|stage iib|cs iia|cs iib/i.test(text)) {
      return "stage_2a_2b";
    }
    if (/stage iic|stage iii|advanced gct|metastatic gct|metastatic seminoma|metastatic nonseminoma/i.test(text)) {
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
      return "absent";
    }
    if (/lymphovascular invasion|\blvi\b|spermatic cord invasion|rete testis|risk factors?/i.test(text)) {
      return "present";
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
    const lowered = text.toLowerCase();
    return LOCATION_TERMS.filter(term => lowered.includes(term));
  }

  function detectTreatmentPreferences(text) {
    const preferences = [];

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
              ids.push("crpc_metastatic_postARPI_taxane_naive_psma_positive");
            }
            if (axes.priorDocetaxel === "yes") {
              ids.push("crpc_metastatic_postARPI_post_taxane");
            }
            if (axes.hrrGene === "brca1" || axes.hrrGene === "brca2" || axes.hrrGene === "brca_unspecified") {
              ids.push("crpc_metastatic_brca_mutated");
            } else if (axes.biomarkerHrr === "positive") {
              ids.push("crpc_metastatic_hrr_mutated_nonbrca");
            }
            ids.push("crpc_metastatic_postARPI", "crpc_general");
          } else if (axes.priorArpi === "no") {
            ids.push("crpc_metastatic_preARPI", "crpc_general");
          } else {
            ids.push("crpc_metastatic_preARPI", "crpc_metastatic_postARPI", "crpc_general");
          }
        } else {
          ids.push("crpc_nonmetastatic", "crpc_metastatic_preARPI", "crpc_metastatic_postARPI", "crpc_general");
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

    parsed.diseaseSettingIds = Array.from(new Set(ids.filter(Boolean)));
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

    if (/hereditary|von hippel|vhl[- ]associated|hereditary rcc/i.test(text) || parsed.clinicalAxes.vhlStatus) {
      parsed.diseaseGroup = "hereditary";
      parsed.diseaseLabel = "Hereditary RCC";
      pushDiseaseIds(parsed.diseaseSettingIds, ["hereditary_rcc"]);
    } else if (/adjuvant|post[- ]nephrectomy|after nephrectomy|m1 ned|disease[- ]free after nephrectomy|resected high[- ]risk/i.test(text)) {
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

    if (!parsed.clinicalAxes.clinicalStage && persistentMarkersAfterOrchiectomy === "yes" && (parsed.clinicalAxes.histology === "nsgct" || parsed.clinicalAxes.histology === "mixed_gct")) {
      parsed.clinicalAxes.clinicalStage = "stage_is";
    }

    if (!parsed.clinicalAxes.igcccgRisk && parsed.clinicalAxes.primarySite === "mediastinal" && (parsed.clinicalAxes.histology === "nsgct" || parsed.clinicalAxes.histology === "mixed_gct")) {
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
      } else if (histology === "nsgct" || histology === "mixed_gct") {
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
      } else if (histology === "nsgct" || histology === "mixed_gct") {
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
    } else if (stage === "stage_is" && (histology === "nsgct" || histology === "mixed_gct")) {
      parsed.diseaseGroup = "stage_is";
      parsed.diseaseLabel = "NSGCT — stage IS";
      pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage_is", "gct_advanced_general"]);
    } else if (stage === "stage_1a" || stage === "stage_1_unspecified") {
      parsed.diseaseGroup = "stage1";
      if (histology === "pure_seminoma") {
        parsed.diseaseLabel = "Seminoma — stage I";
        pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_stage1_surveillance", "seminoma_stage1", "gct_stage1_general"]);
      } else if (histology === "nsgct" || histology === "mixed_gct") {
        parsed.diseaseLabel = "NSGCT — stage I";
        if (parsed.clinicalAxes.stage1RiskFactors === "present") {
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage1_lvi_positive"]);
        } else if (parsed.clinicalAxes.stage1RiskFactors === "absent") {
          pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage1_lvi_negative"]);
        }
        pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage1", "gct_stage1_general"]);
      } else {
        parsed.diseaseLabel = "GCT — stage I";
        pushDiseaseIds(parsed.diseaseSettingIds, ["gct_stage1_general"]);
      }
    } else if (stage === "stage_2a_2b") {
      parsed.diseaseGroup = "stage2";
      if (histology === "pure_seminoma") {
        parsed.diseaseLabel = "Seminoma — stage IIA/IIB";
        pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_stage2a_2b", "gct_advanced_general"]);
      } else if (histology === "nsgct" || histology === "mixed_gct") {
        parsed.diseaseLabel = "NSGCT — stage IIA/IIB";
        pushDiseaseIds(parsed.diseaseSettingIds, ["nsgct_stage2a_2b", "gct_advanced_general"]);
      } else {
        parsed.diseaseLabel = "GCT — stage IIA/IIB";
        pushDiseaseIds(parsed.diseaseSettingIds, ["gct_advanced_general"]);
      }
    } else if (stage === "stage_3_unspecified" || /advanced|metastatic/i.test(text)) {
      parsed.diseaseGroup = "advanced";
      if (histology === "pure_seminoma") {
        parsed.diseaseLabel = "Seminoma — advanced";
        pushDiseaseIds(parsed.diseaseSettingIds, ["seminoma_stage2c_3", "gct_advanced_general"]);
      } else if (histology === "nsgct" || histology === "mixed_gct") {
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

    if (parsed.cancerType === "Prostate" && /\badt\b|androgen deprivation|lhrh|gnrh|leuprolide|goserelin|degarelix|relugolix/i.test(text)) {
      addTherapy(history.receivedTherapies, "adt");
    }
  }

  function populateScreeningFacts(parsed, text) {
    parsed.screeningFacts.ecogStatus = detectEcogStatus(text);
    parsed.screeningFacts.labState = detectLabState(text);
    parsed.screeningFacts.organFunctionState = detectOrganFunctionState(text);
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

  function parse(query) {
    const rawQuery = normalizeWhitespace(query);
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
      treatmentPreferences: [],
      phasePreference: "",
      locationPreferences: [],
      chips: [],
      notes: []
    };

    if (!rawQuery) {
      parsed.unsupportedReason = "Enter a patient description to run matching.";
      return parsed;
    }

    parsed.cancerType = detectCancerType(rawQuery);
    if (!parsed.cancerType) {
      parsed.unsupportedReason = "Patient search currently supports prostate, bladder, kidney, and testicular queries. Include the cancer type or a disease-specific term.";
      return parsed;
    }

    parsed.supported = true;
    parsed.treatmentPreferences = detectTreatmentPreferences(rawQuery);
    parsed.phasePreference = detectPhasePreference(rawQuery);
    parsed.locationPreferences = detectLocationTerms(rawQuery);

    if (parsed.cancerType === "Prostate") {
      parseProstate(parsed, rawQuery);
    } else if (parsed.cancerType === "Bladder") {
      parseBladder(parsed, rawQuery);
    } else if (parsed.cancerType === "Kidney") {
      parseKidney(parsed, rawQuery);
    } else if (parsed.cancerType === "Testicular") {
      parseTesticular(parsed, rawQuery);
    }

    populateTemporalFacts(parsed, rawQuery);
    populateTherapyHistory(parsed, rawQuery);
    populateScreeningFacts(parsed, rawQuery);
    addChip(parsed.chips, "Cancer", parsed.cancerType);
    if (parsed.phasePreference) addChip(parsed.chips, "Preference", parsed.phasePreference);
    parsed.treatmentPreferences.forEach(pref => addChip(parsed.chips, "Preference", pref.replace(/_/g, " ")));
    parsed.locationPreferences.forEach(location => addChip(parsed.chips, "Location", location));
    parsed.notes.forEach(note => addChip(parsed.chips, "Note", note));
    addTemporalChips(parsed);
    addScreeningChips(parsed);

    return parsed;
  }

  const api = {
    parse
  };

  global.PatientQueryParser = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
