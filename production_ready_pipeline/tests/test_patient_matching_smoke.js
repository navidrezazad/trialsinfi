#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');

const PatientQueryParser = require(path.resolve(__dirname, '../../js/patient-query-parser.js'));
const PatientTrialMatcher = require(path.resolve(__dirname, '../../js/patient-trial-matcher.js'));

function buildTrial(overrides = {}) {
  return {
    id: 'trial',
    title: 'Synthetic Trial',
    description: 'Synthetic trial for smoke testing.',
    cancerType: 'Prostate',
    phase: 'Phase II',
    classificationConfidence: 'HIGH',
    siteCount: 1,
    diseaseSettingPrimaryId: '',
    diseaseSettingAllIds: [],
    diseaseSettingAll: [],
    clinicalAxes: {},
    sourceTags: {},
    conditions: [],
    interventions: [],
    eligibilityCriteria: [],
    inclusionCriteria: '',
    exclusionCriteria: '',
    ...overrides
  };
}

function findEntry(result, trialId) {
  return [
    ...(result.strongMatches || []),
    ...(result.possibleMatches || [])
  ].find(entry => entry.trial.id === trialId);
}

function flagCodes(entry) {
  return (entry?.match?.flags || []).map(flag => flag.code).sort();
}

function runQuery(trials, query) {
  const parsedQuery = PatientQueryParser.parse(query);
  assert.equal(parsedQuery.supported, true, `Expected supported query: ${query}`);
  return PatientTrialMatcher.matchTrials({ trials, parsedQuery });
}

function buildProstateTrials() {
  const radioligandTrial = buildTrial({
    id: 'radioligand',
    title: '177Lu-PSMA Radioligand Study',
    description: 'PSMA radioligand treatment for metastatic castration-resistant prostate cancer.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes',
      priorDocetaxel: 'no',
      biomarkerHrr: 'not_required',
      psmaStatus: 'required'
    },
    conditions: ['prostate cancer'],
    interventions: ['177Lu-PSMA-617']
  });

  const parpTrial = buildTrial({
    id: 'parp',
    title: 'PARP Trial for BRCA/HRR Positive mCRPC',
    description: 'Olaparib-based treatment for biomarker-selected metastatic castration-resistant prostate cancer.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes',
      priorDocetaxel: 'no',
      biomarkerHrr: 'positive',
      psmaStatus: 'not_required'
    },
    conditions: ['prostate cancer'],
    interventions: ['olaparib']
  });

  const classifierTrial = buildTrial({
    id: 'classifier',
    title: 'Genomic Classifier Guided Radiation Intensification',
    description: 'Localized unfavorable intermediate-risk prostate cancer trial using Decipher-style selection.',
    cancerType: 'Prostate',
    phase: 'Phase III',
    diseaseSettingPrimaryId: 'localized_unfavorable_ir',
    diseaseSettingAllIds: ['localized_unfavorable_ir', 'localized_general'],
    clinicalAxes: {
      metastaticStatus: 'localized',
      genomicClassifier: 'classifier_required'
    },
    conditions: ['prostate cancer']
  });

  const tripletTrial = buildTrial({
    id: 'triplet',
    title: 'Triplet Intensification in High-Volume mCSPC',
    description: 'Triplet therapy in metastatic castration-sensitive prostate cancer.',
    cancerType: 'Prostate',
    phase: 'Phase III',
    diseaseSettingPrimaryId: 'cspc_high_volume',
    diseaseSettingAllIds: ['cspc_high_volume', 'cspc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_sensitive',
      metastaticStatus: 'metastatic',
      diseaseVolume: 'high_volume',
      priorDocetaxel: 'no'
    },
    conditions: ['prostate cancer'],
    interventions: ['docetaxel', 'darolutamide']
  });

  const brca2McspcTrial = buildTrial({
    id: 'brca2-mcspc',
    title: 'BRCA2-Mutated mCSPC Trial',
    description: 'Precision treatment for metastatic castration-sensitive prostate cancer with BRCA2 mutation.',
    cancerType: 'Prostate',
    phase: 'Phase III',
    diseaseSettingPrimaryId: 'cspc_brca2_mutated',
    diseaseSettingAllIds: ['cspc_brca2_mutated', 'cspc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_sensitive',
      metastaticStatus: 'metastatic',
      biomarkerHrr: 'positive',
      hrrGene: 'brca2'
    },
    conditions: ['prostate cancer']
  });

  const screeningTrial = buildTrial({
    id: 'screening-gated',
    title: 'mCRPC Trial With Standard Screening Gates',
    description: 'Metastatic castration-resistant prostate cancer study.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Eastern Cooperative Oncology Group (ECOG) Performance Status 0 or 1. Adequate renal, liver, and bone marrow function.',
    exclusionCriteria: 'Systemic anti-cancer therapy within 2 weeks of Day 1.'
  });

  const exactSequenceTrial = buildTrial({
    id: 'post-triplet-sequence',
    title: 'mCRPC Trial After ADT, Enzalutamide, and Docetaxel',
    description: 'Later-line study for metastatic castration-resistant prostate cancer after defined prior therapy progression.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes',
      priorDocetaxel: 'yes'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have progressed on ADT, enzalutamide, and docetaxel.'
  });

  const genericPostArpiTrial = buildTrial({
    id: 'post-arpi-generic',
    title: 'Generic Post-ARPI mCRPC Trial',
    description: 'Study for metastatic castration-resistant prostate cancer after enzalutamide.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have progressed on enzalutamide.'
  });

  const classPostArpiTrial = buildTrial({
    id: 'post-arpi-class',
    title: 'Class-Level Post-ARPI mCRPC Trial',
    description: 'Study for metastatic castration-resistant prostate cancer after progression on any ARPI.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have progressed on a prior ARPI.'
  });

  const exactAbiTrial = buildTrial({
    id: 'post-abiraterone-exact',
    title: 'Exact Post-Abiraterone mCRPC Trial',
    description: 'Study for metastatic castration-resistant prostate cancer after abiraterone progression.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have progressed on abiraterone.'
  });

  const postEnzaDocetaxelTrial = buildTrial({
    id: 'post-enza-docetaxel',
    title: 'mCRPC Trial After Enzalutamide and Docetaxel',
    description: 'Study for metastatic castration-resistant prostate cancer after progression on enzalutamide and docetaxel.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes',
      priorDocetaxel: 'yes'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have progressed on enzalutamide and docetaxel.'
  });

  const postEnzaDocetaxelAllowedTrial = buildTrial({
    id: 'post-enza-docetaxel-allowed',
    title: 'mCRPC Trial After Enzalutamide',
    description: 'Study for metastatic castration-resistant prostate cancer after enzalutamide progression.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes',
      priorDocetaxel: 'unknown'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have progressed on enzalutamide. May have received prior docetaxel.'
  });

  const noCabazitaxelTrial = buildTrial({
    id: 'post-enza-docetaxel-no-cabazitaxel',
    title: 'mCRPC Trial After Enzalutamide and Docetaxel',
    description: 'Study for metastatic castration-resistant prostate cancer after defined prior therapy progression.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'yes',
      priorDocetaxel: 'yes'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have progressed on enzalutamide and docetaxel.',
    exclusionCriteria: 'No prior cabazitaxel.'
  });

  const generalCrpcTrial = buildTrial({
    id: 'general-crpc',
    title: 'General mCRPC Trial',
    description: 'Study for metastatic castration-resistant prostate cancer.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_general',
    diseaseSettingAllIds: ['crpc_general'],
    clinicalAxes: {
      castrationStatus: 'castration_resistant',
      metastaticStatus: 'metastatic',
      priorArpi: 'unknown'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have metastatic castration-resistant prostate cancer.'
  });

  const misclassifiedLocalizedTrial = buildTrial({
    id: 'misclassified-localized',
    title: 'Localized Prostatectomy Trial',
    description: 'Study for men undergoing radical prostatectomy after biopsy-proven localized prostate cancer.',
    cancerType: 'Prostate',
    diseaseSettingPrimaryId: 'crpc_metastatic_postARPI',
    diseaseSettingAllIds: ['crpc_metastatic_postARPI', 'crpc_general'],
    clinicalAxes: {
      castrationStatus: 'unknown',
      metastaticStatus: 'unknown'
    },
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must be scheduled to undergo radical prostatectomy in the next 4 weeks.'
  });

  return [
    radioligandTrial,
    parpTrial,
    classifierTrial,
    tripletTrial,
    screeningTrial,
    exactSequenceTrial,
    genericPostArpiTrial,
    classPostArpiTrial,
    exactAbiTrial,
    postEnzaDocetaxelTrial,
    postEnzaDocetaxelAllowedTrial,
    noCabazitaxelTrial,
    generalCrpcTrial,
    brca2McspcTrial,
    misclassifiedLocalizedTrial
  ];
}

function buildBladderTrials() {
  const nmibcTrial = buildTrial({
    id: 'nmibc-bcg',
    title: 'BCG-Unresponsive NMIBC Study',
    description: 'Intravesical therapy for BCG-unresponsive NMIBC with CIS.',
    cancerType: 'Bladder',
    diseaseSettingPrimaryId: 'nmibc_bcg_unresponsive',
    diseaseSettingAllIds: ['nmibc_bcg_unresponsive', 'nmibc_general'],
    clinicalAxes: {
      bcgStatus: 'BCG-Unresponsive',
      cisPapillaryPattern: 'cis_only'
    },
    conditions: ['bladder cancer'],
    interventions: ['intravesical therapy']
  });

  const metastatic1LTrial = buildTrial({
    id: 'muc-1l-cis-ineligible',
    title: 'First-Line Cisplatin-Ineligible mUC Trial',
    description: 'Systemic treatment for first-line cisplatin-ineligible metastatic urothelial carcinoma.',
    cancerType: 'Bladder',
    diseaseSettingPrimaryId: 'metastatic_1l_cisplatin_ineligible',
    diseaseSettingAllIds: ['metastatic_1l_cisplatin_ineligible', 'metastatic_1l_general', 'metastatic_general'],
    clinicalAxes: {
      cisplatinStatus: 'Cisplatin-Ineligible'
    },
    conditions: ['urothelial carcinoma']
  });

  const metastatic2LTrial = buildTrial({
    id: 'muc-2l',
    title: 'Post-Platinum mUC Trial',
    description: 'Second-line treatment for metastatic urothelial carcinoma after platinum.',
    cancerType: 'Bladder',
    diseaseSettingPrimaryId: 'metastatic_2l_plus',
    diseaseSettingAllIds: ['metastatic_2l_plus', 'metastatic_general'],
    clinicalAxes: {},
    conditions: ['urothelial carcinoma']
  });

  const maintenanceTrial = buildTrial({
    id: 'muc-maintenance',
    title: 'Avelumab Maintenance for Metastatic UC',
    description: 'Maintenance immunotherapy for metastatic urothelial carcinoma with no progression after first-line platinum chemotherapy.',
    cancerType: 'Bladder',
    diseaseSettingPrimaryId: 'metastatic_maintenance_post_platinum_nonprogressing',
    diseaseSettingAllIds: ['metastatic_maintenance_post_platinum_nonprogressing', 'metastatic_general'],
    clinicalAxes: {},
    conditions: ['urothelial carcinoma'],
    interventions: ['avelumab']
  });

  const fgfr3Trial = buildTrial({
    id: 'muc-fgfr3',
    title: 'Erdafitinib for FGFR3-Altered Metastatic Urothelial Cancer',
    description: 'Targeted therapy for post-platinum metastatic urothelial carcinoma with susceptible FGFR3 alteration.',
    cancerType: 'Bladder',
    diseaseSettingPrimaryId: 'metastatic_2l_plus',
    diseaseSettingAllIds: ['metastatic_2l_plus', 'metastatic_general'],
    clinicalAxes: {
      fgfr3Status: 'susceptible_alteration'
    },
    conditions: ['urothelial carcinoma'],
    interventions: ['erdafitinib']
  });

  const her2Trial = buildTrial({
    id: 'muc-her2',
    title: 'HER2-Directed ADC for Later-Line Metastatic Urothelial Cancer',
    description: 'Trastuzumab deruxtecan for later-line metastatic urothelial carcinoma with HER2 IHC 3+ disease.',
    cancerType: 'Bladder',
    diseaseSettingPrimaryId: 'metastatic_2l_plus',
    diseaseSettingAllIds: ['metastatic_2l_plus', 'metastatic_general'],
    clinicalAxes: {
      her2Status: 'ihc_3_plus'
    },
    conditions: ['urothelial carcinoma'],
    interventions: ['trastuzumab deruxtecan']
  });

  return [nmibcTrial, metastatic1LTrial, metastatic2LTrial, maintenanceTrial, fgfr3Trial, her2Trial];
}

function buildKidneyTrials() {
  const ccRccTrial = buildTrial({
    id: 'ccrcc-1l',
    title: 'Intermediate/Poor Risk mccRCC Trial',
    description: 'First-line immunotherapy combination for metastatic clear-cell RCC.',
    cancerType: 'Kidney',
    diseaseSettingPrimaryId: 'metastatic_ccrcc_int_poor_1l',
    diseaseSettingAllIds: ['metastatic_ccrcc_int_poor_1l', 'metastatic_ccrcc_1l_all_risk', 'metastatic_ccrcc_general'],
    clinicalAxes: {
      histology: 'clear_cell',
      imdcRisk: 'intermediate_poor',
      priorSystemicLines: '0',
      priorIo: 'no',
      priorVegfTki: 'no',
      nephrectomyStatus: 'prior_nephrectomy',
      sarcomatoid: 'yes'
    },
    conditions: ['renal cell carcinoma']
  });

  const papillaryTrial = buildTrial({
    id: 'papillary-met',
    title: 'MET-Directed Papillary RCC Trial',
    description: 'Targeted therapy for metastatic papillary type 2 RCC with MET alteration.',
    cancerType: 'Kidney',
    diseaseSettingPrimaryId: 'metastatic_ncrcc_papillary',
    diseaseSettingAllIds: ['metastatic_ncrcc_papillary', 'metastatic_ncrcc_general'],
    clinicalAxes: {
      histology: 'papillary_type2',
      priorSystemicLines: '0',
      metAlteration: 'met_mutation'
    },
    conditions: ['papillary renal cell carcinoma']
  });

  const chromophobeTrial = buildTrial({
    id: 'chromophobe-met',
    title: 'Chromophobe RCC Study',
    description: 'Systemic study for metastatic chromophobe RCC.',
    cancerType: 'Kidney',
    diseaseSettingPrimaryId: 'metastatic_ncrcc_chromophobe',
    diseaseSettingAllIds: ['metastatic_ncrcc_chromophobe', 'metastatic_ncrcc_general'],
    clinicalAxes: {
      histology: 'chromophobe',
      priorSystemicLines: '0'
    },
    conditions: ['chromophobe renal cell carcinoma']
  });

  const medullaryTrial = buildTrial({
    id: 'medullary-met',
    title: 'Renal Medullary Carcinoma Trial',
    description: 'Study for renal medullary carcinoma and SMARCB1-deficient kidney cancer.',
    cancerType: 'Kidney',
    diseaseSettingPrimaryId: 'metastatic_ncrcc_collecting_duct',
    diseaseSettingAllIds: ['metastatic_ncrcc_collecting_duct', 'metastatic_ncrcc_general'],
    clinicalAxes: {
      histology: 'medullary',
      priorSystemicLines: '0'
    },
    conditions: ['renal medullary carcinoma']
  });

  const nccrccBasketTrial = buildTrial({
    id: 'nccrcc-basket',
    title: 'Non-Clear-Cell RCC Basket Trial',
    description: 'Basket study for metastatic non-clear-cell RCC of any subtype.',
    cancerType: 'Kidney',
    diseaseSettingPrimaryId: 'metastatic_ncrcc_general',
    diseaseSettingAllIds: ['metastatic_ncrcc_general'],
    clinicalAxes: {
      priorSystemicLines: '0'
    },
    conditions: ['non-clear-cell renal cell carcinoma']
  });

  const belzutifanSequenceTrial = buildTrial({
    id: 'ccrcc-belzutifan-sequence',
    title: 'Belzutifan After PD-1 and VEGF-TKI for Advanced RCC',
    description: 'Later-line belzutifan study for metastatic clear-cell RCC after prior PD-1/PD-L1 inhibitor and VEGF-TKI therapy.',
    cancerType: 'Kidney',
    diseaseSettingPrimaryId: 'metastatic_ccrcc_post_pd1_vegf_tki_belzutifan',
    diseaseSettingAllIds: ['metastatic_ccrcc_post_pd1_vegf_tki_belzutifan', 'metastatic_ccrcc_general'],
    clinicalAxes: {
      histology: 'clear_cell',
      priorSystemicLines: '1',
      priorIo: 'yes',
      priorVegfTki: 'yes'
    },
    conditions: ['renal cell carcinoma'],
    interventions: ['belzutifan']
  });

  return [ccRccTrial, papillaryTrial, chromophobeTrial, medullaryTrial, nccrccBasketTrial, belzutifanSequenceTrial];
}

function buildTesticularTrials() {
  const seminomaTrial = buildTrial({
    id: 'seminoma-stage1',
    title: 'Seminoma Stage I Surveillance Trial',
    description: 'Management study for stage I seminoma after orchiectomy.',
    cancerType: 'Testicular',
    diseaseSettingPrimaryId: 'seminoma_stage1',
    diseaseSettingAllIds: ['seminoma_stage1', 'gct_stage1_general'],
    clinicalAxes: {
      histology: 'pure_seminoma',
      clinicalStage: 'stage_1_unspecified',
      markerStatus: 'markers_normal'
    },
    conditions: ['testicular seminoma']
  });

  const recurrentTrial = buildTrial({
    id: 'nsgct-2l',
    title: 'Relapsed NSGCT Salvage Trial',
    description: 'Second-line salvage treatment for relapsed NSGCT.',
    cancerType: 'Testicular',
    diseaseSettingPrimaryId: 'nsgct_recurrent_2l',
    diseaseSettingAllIds: ['nsgct_recurrent_2l', 'gct_advanced_general'],
    clinicalAxes: {
      histology: 'nsgct',
      priorChemoLines: '1',
      priorHdct: 'no'
    },
    conditions: ['nonseminomatous germ cell tumor']
  });

  const stageIsTrial = buildTrial({
    id: 'nsgct-stage-is',
    title: 'NSGCT Stage IS Trial',
    description: 'First-line treatment study for NSGCT with persistently elevated AFP after orchiectomy.',
    cancerType: 'Testicular',
    diseaseSettingPrimaryId: 'nsgct_stage_is',
    diseaseSettingAllIds: ['nsgct_stage_is', 'gct_advanced_general'],
    clinicalAxes: {
      histology: 'nsgct',
      clinicalStage: 'stage_is',
      markerStatus: 'afp_elevated',
      priorChemoLines: '0'
    },
    conditions: ['nonseminomatous germ cell tumor']
  });

  const postFirstLineTrial = buildTrial({
    id: 'nsgct-post1l',
    title: 'Post-Chemotherapy NSGCT Management Trial',
    description: 'Study for NSGCT residual-mass management after first-line BEP.',
    cancerType: 'Testicular',
    diseaseSettingPrimaryId: 'nsgct_post_first_line',
    diseaseSettingAllIds: ['nsgct_post_first_line', 'gct_advanced_general'],
    clinicalAxes: {
      histology: 'nsgct',
      priorChemoLines: '1',
      markerStatus: 'markers_normal'
    },
    conditions: ['nonseminomatous germ cell tumor']
  });

  const mediastinalTrial = buildTrial({
    id: 'mediastinal-poor',
    title: 'Primary Mediastinal NSGCT Trial',
    description: 'Study for primary mediastinal NSGCT poor-risk disease.',
    cancerType: 'Testicular',
    diseaseSettingPrimaryId: 'gct_advanced_general',
    diseaseSettingAllIds: ['extragonadal_gct', 'gct_advanced_general'],
    clinicalAxes: {
      histology: 'nsgct',
      primarySite: 'mediastinal',
      igcccgRisk: 'poor',
      priorChemoLines: '0'
    },
    conditions: ['mediastinal germ cell tumor']
  });

  return [seminomaTrial, recurrentTrial, stageIsTrial, postFirstLineTrial, mediastinalTrial];
}

function testProstate() {
  const trials = buildProstateTrials();
  let parsed = PatientQueryParser.parse(
    'Male, 65. mCRPC. Progressed on enzalutamide. Last systemic therapy 10 days ago. PSMA PET 21 days ago. ECOG 1. Labs normal. Adequate organ function.'
  );
  assert.deepEqual(parsed.temporalFacts.progressedAfterTherapies, ['enzalutamide']);
  assert.equal(parsed.temporalFacts.sinceLastSystemicTherapyDays, 10);
  assert.equal(parsed.temporalFacts.recentImagingDays, 21);
  assert.equal(parsed.screeningFacts.ecogStatus, 'ecog_1');
  assert.equal(parsed.screeningFacts.labState, 'within_range');
  assert.equal(parsed.screeningFacts.organFunctionState, 'adequate');

  parsed = PatientQueryParser.parse(
    'Male, 65. mCRPC. Progressed on ADT and enzalutamide and docetaxel.'
  );
  assert.deepEqual(parsed.temporalFacts.progressedAfterTherapies, ['adt', 'enzalutamide', 'docetaxel']);
  assert.deepEqual(parsed.therapyHistory.progressedOnTherapies, ['adt', 'enzalutamide', 'docetaxel']);

  parsed = PatientQueryParser.parse(
    'Male, 65. mCRPC. Received docetaxel. Progressed on enzalutamide.'
  );
  assert.deepEqual(parsed.therapyHistory.progressedOnTherapies, ['enzalutamide']);
  assert.deepEqual([...parsed.therapyHistory.receivedTherapies].sort(), ['docetaxel', 'enzalutamide']);

  parsed = PatientQueryParser.parse(
    'Male, 65. mCRPC. Currently on enzalutamide.'
  );
  assert.deepEqual(parsed.therapyHistory.progressedOnTherapies, []);
  assert.deepEqual(parsed.therapyHistory.receivedTherapies, ['enzalutamide']);

  let result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide. BRCA2+. PSMA-positive PET. No prior docetaxel.'
  );
  assert.deepEqual(
    result.strongMatches.map(entry => entry.trial.id).sort(),
    ['parp', 'post-arpi-class', 'post-arpi-generic', 'post-enza-docetaxel-allowed', 'radioligand'],
    'Full biomarker-complete mCRPC query should strongly match radioligand, PARP, and the ARPI-directed later-line cohorts that do not prohibit prior docetaxel.'
  );

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide. PSMA-positive PET. No prior docetaxel.'
  );
  assert.equal(findEntry(result, 'radioligand').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'parp').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'parp')), ['brca_hrr']);

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide. BRCA2+. No prior docetaxel.'
  );
  assert.equal(findEntry(result, 'parp').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'radioligand').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'radioligand')), ['psma_status']);

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide. BRCA2+. No prior docetaxel. Last systemic therapy 10 days ago.'
  );
  assert.equal(findEntry(result, 'parp').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'parp')), ['washout_window']);

  result = runQuery(
    trials,
    'Man with unfavorable intermediate-risk localized prostate cancer considering radiation. Phase III only.'
  );
  assert.equal(findEntry(result, 'classifier').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'classifier')), ['genomic_classifier']);

  result = runQuery(
    trials,
    'Male with mCSPC high-volume prostate cancer. No prior docetaxel.'
  );
  assert.equal(findEntry(result, 'triplet').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'triplet')), ['adt_history']);

  parsed = PatientQueryParser.parse(
    'Male with de novo mCSPC, 4 bone metastases including one rib lesion, no visceral disease. No prior docetaxel.'
  );
  assert.equal(parsed.clinicalAxes.prostateVolumeClass, 'high_volume_chaarted');
  assert.ok(parsed.diseaseSettingIds.includes('cspc_high_volume_chaarted'));

  result = runQuery(
    trials,
    'Male with mCSPC, 3 bone metastases, no visceral disease. No prior docetaxel. ADT-naive.'
  );
  assert.equal(findEntry(result, 'triplet'), undefined, 'Low-volume mCSPC should not match high-volume-only cohorts.');

  result = runQuery(
    trials,
    'Male with mCSPC prostate cancer. BRCA2 mutation. ADT-naive.'
  );
  assert.equal(findEntry(result, 'brca2-mcspc').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Male with mCSPC prostate cancer. ATM mutation. ADT-naive.'
  );
  assert.equal(findEntry(result, 'brca2-mcspc'), undefined, 'ATM-mutated disease should not strongly match BRCA2-specific mCSPC cohorts.');

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide.'
  );
  assert.equal(findEntry(result, 'screening-gated').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'screening-gated')), ['ecog_status', 'lab_organ_function', 'washout_window']);
  assert.equal(findEntry(result, 'post-arpi-generic').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'post-arpi-class').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'post-abiraterone-exact'), undefined);
  assert.equal(findEntry(result, 'general-crpc').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'general-crpc')), ['therapy_sequence']);

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on abiraterone.'
  );
  assert.equal(findEntry(result, 'post-abiraterone-exact').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'post-arpi-class').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'post-arpi-generic'), undefined, 'Exact enzalutamide-only trials should not strongly match abiraterone progression queries.');

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Received docetaxel. Progressed on enzalutamide.'
  );
  assert.equal(findEntry(result, 'post-enza-docetaxel').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'post-enza-docetaxel')), ['taxane_setting_needed', 'therapy_sequence']);
  assert.equal(findEntry(result, 'post-enza-docetaxel-allowed').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide and docetaxel.'
  );
  assert.equal(findEntry(result, 'post-enza-docetaxel').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'post-enza-docetaxel-no-cabazitaxel').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide and docetaxel and cabazitaxel.'
  );
  assert.equal(findEntry(result, 'post-enza-docetaxel').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'post-enza-docetaxel')), ['therapy_sequence']);
  assert.equal(findEntry(result, 'post-enza-docetaxel-no-cabazitaxel'), undefined, 'Trials excluding prior cabazitaxel should not match patients who already received it.');

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Currently on enzalutamide.'
  );
  assert.equal(findEntry(result, 'post-arpi-generic').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'post-arpi-generic')), ['therapy_sequence']);

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide. ECOG 1. Labs normal. Adequate organ function. Last systemic therapy 21 days ago.'
  );
  assert.equal(findEntry(result, 'screening-gated').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on enzalutamide. ECOG 3. Labs normal. Adequate organ function. Last systemic therapy 21 days ago.'
  );
  assert.equal(findEntry(result, 'screening-gated'), undefined, 'Explicit ECOG 3 should exclude a trial requiring ECOG 0-1.');

  result = runQuery(
    trials,
    'Male, 65. mCRPC.'
  );
  assert.ok(result.possibleMatches.length >= 2, 'Broad mCRPC query should still surface possible matches.');
  assert.equal(findEntry(result, 'misclassified-localized'), undefined, 'Localized prostatectomy studies should not surface for advanced prostate queries.');

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on ADT and enzalutamide and docetaxel.'
  );
  assert.equal(findEntry(result, 'post-triplet-sequence').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'post-arpi-generic').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'post-arpi-generic')), ['therapy_sequence']);
  assert.equal(findEntry(result, 'radioligand'), undefined, 'Docetaxel-treated patient should not match a docetaxel-naive radioligand cohort.');
  assert.equal(findEntry(result, 'parp'), undefined, 'Docetaxel-treated patient should not match a docetaxel-naive PARP cohort.');

  result = runQuery(
    trials,
    'Male, 65. mCRPC. Progressed on ADT and enzalutamide.'
  );
  assert.equal(findEntry(result, 'post-triplet-sequence'), undefined, 'Exact sequence trial should exclude when required docetaxel progression is missing.');

  const degradedGeneralTrial = buildTrial({
    id: 'degraded-general',
    title: 'Generic mCRPC Trial After Enzalutamide',
    description: 'Study for metastatic castration-resistant prostate cancer after enzalutamide.',
    cancerType: 'Prostate',
    diseaseSettingPrimary: 'CRPC — General / Unspecified Stage',
    diseaseSettingPrimaryId: '',
    diseaseSettingAllIds: [],
    clinicalAxes: null,
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Participants must have progressed on enzalutamide.'
  });
  const degradedGeneralResult = PatientTrialMatcher.matchSingleTrial(
    degradedGeneralTrial,
    PatientQueryParser.parse('mCRPC. Progressed on enzalutamide.')
  );
  assert.equal(degradedGeneralResult.included, true, 'General CRPC fallback labels should still match advanced CRPC queries.');

  const degradedLocalizedTrial = buildTrial({
    id: 'degraded-localized',
    title: 'ILLUSION Localized Prostate SBRT Trial',
    description: 'This study evaluates stereotactic body radiotherapy for prostate cancer that has not spread to other parts of the body (localized).',
    cancerType: 'Prostate',
    diseaseSettingPrimary: 'CRPC — Metastatic, Post-ARPI (mCRPC 2L+)',
    diseaseSettingPrimaryId: '',
    diseaseSettingAllIds: [],
    clinicalAxes: null,
    conditions: ['prostate cancer'],
    inclusionCriteria: 'Histologically confirmed, clinically localized adenocarcinoma of the prostate with no evidence of metastatic disease.'
  });
  const degradedLocalizedResult = PatientTrialMatcher.matchSingleTrial(
    degradedLocalizedTrial,
    PatientQueryParser.parse('mCRPC. Progressed on enzalutamide.')
  );
  assert.equal(degradedLocalizedResult.included, false, 'Localized prostate trials should be excluded from advanced prostate queries even when structured fields are missing.');
}

function testBladder() {
  const trials = buildBladderTrials();

  let result = runQuery(
    trials,
    'Bladder cancer, BCG-unresponsive NMIBC with CIS after adequate BCG.'
  );
  assert.equal(findEntry(result, 'nmibc-bcg').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Bladder cancer, BCG-unresponsive NMIBC with papillary-only recurrence after adequate BCG.'
  );
  assert.equal(findEntry(result, 'nmibc-bcg'), undefined, 'CIS-only NMIBC cohort should exclude papillary-only disease.');

  result = runQuery(
    trials,
    'Bladder cancer, NMIBC with CIS after BCG failure.'
  );
  assert.equal(findEntry(result, 'nmibc-bcg').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'nmibc-bcg')), ['bcg_adequacy_timing_needed']);

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma, first-line.'
  );
  assert.equal(findEntry(result, 'muc-1l-cis-ineligible').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'muc-1l-cis-ineligible')), ['cisplatin_eligibility']);

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma, cisplatin-ineligible, first-line.'
  );
  assert.equal(findEntry(result, 'muc-1l-cis-ineligible').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'muc-2l'), undefined, 'First-line metastatic query should exclude 2L bladder trials.');

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma after prior platinum. FGFR3 mutation.'
  );
  assert.equal(findEntry(result, 'muc-fgfr3').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma after prior platinum. FGFR alteration.'
  );
  assert.equal(findEntry(result, 'muc-fgfr3').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'muc-fgfr3')), ['fgfr3_specificity_needed']);

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma after prior platinum. FGFR2 fusion.'
  );
  assert.equal(findEntry(result, 'muc-fgfr3'), undefined, 'FGFR2-only disease should not match FGFR3-specific cohorts.');

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma after prior platinum.'
  );
  assert.equal(findEntry(result, 'muc-fgfr3').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'muc-fgfr3')), ['fgfr3_status']);

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma stable after gem/carbo first-line platinum.'
  );
  assert.equal(findEntry(result, 'muc-maintenance').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma progressed after gem/cis first-line platinum.'
  );
  assert.equal(findEntry(result, 'muc-maintenance'), undefined, 'Maintenance cohorts should exclude known post-platinum progression.');

  result = runQuery(
    trials,
    'Metastatic urothelial carcinoma after prior platinum. HER2 IHC 3+.'
  );
  assert.equal(findEntry(result, 'muc-her2').match.badge, 'Strong match');
}

function testKidney() {
  const trials = buildKidneyTrials();
  let parsed = PatientQueryParser.parse(
    'Metastatic renal medullary carcinoma, treatment-naive.'
  );
  assert.equal(parsed.clinicalAxes.histology, 'medullary');

  parsed = PatientQueryParser.parse(
    'Metastatic non-clear-cell RCC, treatment-naive.'
  );
  assert.equal(parsed.clinicalAxes.histology, 'non_clear_cell');

  let result = runQuery(
    trials,
    'Metastatic clear-cell RCC, IMDC intermediate risk, treatment-naive, no prior IO, no prior VEGF-TKI, prior nephrectomy, sarcomatoid.'
  );
  assert.equal(findEntry(result, 'ccrcc-1l').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'papillary-met'), undefined);
  assert.equal(findEntry(result, 'chromophobe-met'), undefined);

  result = runQuery(
    trials,
    'Metastatic clear-cell RCC, treatment-naive, no prior IO, no prior VEGF-TKI, prior nephrectomy, sarcomatoid.'
  );
  assert.equal(findEntry(result, 'ccrcc-1l').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'ccrcc-1l')), ['imdc_risk']);

  result = runQuery(
    trials,
    'Metastatic papillary type 2 RCC, MET mutation, treatment-naive.'
  );
  assert.equal(findEntry(result, 'papillary-met').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Metastatic papillary RCC, MET mutation, treatment-naive.'
  );
  assert.equal(findEntry(result, 'papillary-met').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'papillary-met')), ['histology']);

  result = runQuery(
    trials,
    'Metastatic chromophobe RCC, treatment-naive.'
  );
  assert.equal(findEntry(result, 'chromophobe-met').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'papillary-met'), undefined);
  assert.equal(findEntry(result, 'nccrcc-basket').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Metastatic non-clear-cell RCC, treatment-naive.'
  );
  assert.equal(findEntry(result, 'nccrcc-basket').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'chromophobe-met').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'chromophobe-met')), ['histology']);

  result = runQuery(
    trials,
    'Metastatic renal medullary carcinoma, treatment-naive.'
  );
  assert.equal(findEntry(result, 'medullary-met').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'chromophobe-met'), undefined);

  result = runQuery(
    trials,
    'Metastatic clear-cell RCC progressed after pembrolizumab/axitinib.'
  );
  assert.equal(findEntry(result, 'ccrcc-belzutifan-sequence').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Metastatic clear-cell RCC after nivolumab, no prior VEGF-TKI.'
  );
  assert.equal(findEntry(result, 'ccrcc-belzutifan-sequence'), undefined, 'Belzutifan-sequence cohorts should not match when VEGF-TKI exposure is explicitly absent.');
}

function testTesticular() {
  const trials = buildTesticularTrials();
  let parsed = PatientQueryParser.parse(
    'Relapsed NSGCT after first-line BEP. AFP remains elevated after orchiectomy.'
  );
  assert.equal(parsed.temporalFacts.persistentMarkersAfterOrchiectomy, 'yes');
  assert.equal(parsed.clinicalAxes.markerStatus, 'afp_elevated');

  parsed = PatientQueryParser.parse(
    'Pure seminoma with AFP elevated after orchiectomy.'
  );
  assert.equal(parsed.clinicalAxes.histology, 'nsgct');

  parsed = PatientQueryParser.parse(
    'Primary mediastinal NSGCT, advanced disease.'
  );
  assert.equal(parsed.clinicalAxes.primarySite, 'mediastinal');
  assert.equal(parsed.clinicalAxes.igcccgRisk, 'poor');

  parsed = PatientQueryParser.parse(
    'NSGCT after first-line BEP with 2 cm residual mass after chemotherapy, markers normal.'
  );
  assert.equal(parsed.diseaseGroup, 'post_first_line');
  assert.equal(parsed.clinicalAxes.gctResidualMassSizeCm, '2');
  assert.ok(parsed.diseaseSettingIds.includes('nsgct_post_first_line'));

  let result = runQuery(
    trials,
    'Seminoma stage I after orchiectomy, no prior chemotherapy, markers normal.'
  );
  assert.equal(findEntry(result, 'seminoma-stage1').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Seminoma stage I after orchiectomy, no prior chemotherapy.'
  );
  assert.equal(findEntry(result, 'seminoma-stage1').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'seminoma-stage1')), ['marker_status']);

  result = runQuery(
    trials,
    'Relapsed NSGCT after first-line BEP, no prior HDCT.'
  );
  assert.equal(findEntry(result, 'nsgct-2l').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Relapsed NSGCT after first-line BEP.'
  );
  assert.equal(findEntry(result, 'nsgct-2l').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'nsgct-2l')), ['hdct_history']);

  result = runQuery(
    trials,
    'NSGCT with AFP elevated after orchiectomy and no prior chemotherapy.'
  );
  assert.equal(findEntry(result, 'nsgct-stage-is').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'seminoma-stage1'), undefined);

  result = runQuery(
    trials,
    'NSGCT after first-line BEP with 2 cm residual mass after chemotherapy, markers normal.'
  );
  assert.equal(findEntry(result, 'nsgct-post1l').match.badge, 'Strong match');
  assert.equal(findEntry(result, 'nsgct-2l'), undefined);

  result = runQuery(
    trials,
    'NSGCT after first-line BEP with residual mass after chemotherapy, markers normal.'
  );
  assert.equal(findEntry(result, 'nsgct-post1l').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'nsgct-post1l')), ['gct_residual_mass_size_needed']);

  result = runQuery(
    trials,
    'Primary mediastinal NSGCT, advanced disease, no prior chemotherapy.'
  );
  assert.equal(findEntry(result, 'mediastinal-poor').match.badge, 'Strong match');

  result = runQuery(
    trials,
    'Primary mediastinal NSGCT, advanced disease.'
  );
  assert.equal(findEntry(result, 'mediastinal-poor').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'mediastinal-poor')), ['chemo_lines']);

  result = runQuery(
    trials,
    'Extragonadal NSGCT, advanced disease.'
  );
  assert.equal(findEntry(result, 'mediastinal-poor').match.badge, 'Possible match');
  assert.deepEqual(flagCodes(findEntry(result, 'mediastinal-poor')), ['chemo_lines', 'igcccg_risk', 'primary_site']);
}

function main() {
  testProstate();
  testBladder();
  testKidney();
  testTesticular();
  console.log('Patient matching smoke tests passed.');
}

main();
