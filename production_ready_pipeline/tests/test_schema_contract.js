#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const Vocabulary = require(path.join(ROOT, 'js/clinical-vocabulary.js'));
const Schema = require(path.join(ROOT, 'js/clinical-trial-schema.js'));
const Parser = require(path.join(ROOT, 'js/patient-query-parser.js'));

const AXIS_KEY_MAP = {
  bcgStatus: 'bcg_status',
  cisplatinStatus: 'cisplatin_status',
  cisPapillaryPattern: 'cis_papillary_pattern',
  fgfr3Status: 'fgfr3_status',
  her2Status: 'her2_status',
  castrationStatus: 'castration_status',
  metastaticStatus: 'metastatic_status',
  diseaseVolume: 'disease_volume',
  priorArpi: 'prior_arpi',
  priorDocetaxel: 'prior_docetaxel',
  biomarkerHrr: 'biomarker_hrr',
  psmaStatus: 'psma_status',
  genomicClassifier: 'genomic_classifier',
  histology: 'histology',
  imdcRisk: 'imdc_risk',
  priorSystemicLines: 'prior_systemic_lines',
  priorIo: 'prior_io',
  priorVegfTki: 'prior_vegf_tki',
  nephrectomyStatus: 'nephrectomy_status',
  vhlStatus: 'vhl_status',
  metAlteration: 'met_alteration',
  sarcomatoid: 'sarcomatoid',
  clinicalStage: 'clinical_stage',
  igcccgRisk: 'igcccg_risk',
  primarySite: 'primary_site',
  priorChemoLines: 'prior_chemo_lines',
  priorHdct: 'prior_hdct',
  rplndStatus: 'rplnd_status',
  markerStatus: 'marker_status',
  stage1RiskFactors: 'stage1_risk_factors'
};

function normalizedKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function testGeneratedVocabulary() {
  assert.equal(Schema.SCHEMA_VERSION, Vocabulary.schemaVersion);
  assert.deepEqual(Object.values(Schema.CRITERION_STATES).sort(), Vocabulary.criterionStates.slice().sort());
  assert.deepEqual(Object.values(Schema.REVIEW_TIERS).sort(), Vocabulary.reviewTiers.slice().sort());
  assert.equal(Object.hasOwn(Vocabulary.globalAliases, 'present'), false, 'Assertion words cannot be global axis aliases.');
  assert.equal(Object.hasOwn(Vocabulary.globalAliases, 'absent'), false, 'Assertion words cannot be global axis aliases.');
  const assertion = Schema.createPatientFact({ concept: 'test', value: true, assertion: 'present', sourceText: 'present' });
  assert.equal(assertion.assertion, 'present');
  assert.equal(Schema.normalizeAxisValue('stage1RiskFactors', 'absent'), 'without_risk_factors');
  assert.equal(Schema.normalizeAxisValue('clinicalStage', 'stage_is'), 'stage_1s');

  for (const filename of ['patient-fact.schema.json', 'trial-cohort.schema.json', 'model-proposal.schema.json', 'cohort-segmentation-proposal.schema.json', 'cohort-review.schema.json', 'clinical-vocabulary.json']) {
    JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', filename), 'utf8'));
  }

  const modelDir = path.join(ROOT, 'production_ready_pipeline/nccn_input/models');
  for (const filename of fs.readdirSync(modelDir).filter(name => name.endsWith('.json'))) {
    const taxonomy = JSON.parse(fs.readFileSync(path.join(modelDir, filename), 'utf8'));
    const cancer = { bladder_urothelial: 'Bladder', prostate: 'Prostate', kidney: 'Kidney', testicular: 'Testicular' }[taxonomy.disease];
    assert.ok(cancer, `Unknown taxonomy disease: ${taxonomy.disease}`);
    const defined = new Set(Vocabulary.diseaseSettings[cancer]);
    for (const category of taxonomy.categories || []) {
      assert.ok(defined.has(category.id), `${filename} category ${category.id} is absent from generated vocabulary.`);
    }
  }
}

function testParserContract() {
  const narratives = [
    'mCRPC after enzalutamide with BRCA2 mutation. ECOG 1.',
    'Metastatic urothelial carcinoma, FGFR3 mutation negative, cisplatin-ineligible.',
    'Metastatic clear-cell RCC, no prior nivolumab, somatic VHL mutation.',
    'Mixed seminoma and nonseminomatous GCT, stage IIA, no prior chemotherapy.',
    'mCRPC. Hemoglobin 9.5 g/dL, ANC 1.5 x 10^9/L, platelets 125 K/uL, CrCl 55 mL/min.',
    '72-year-old man with mCRPC considering pembrolizumab.'
  ];
  const definedConcepts = new Set(Vocabulary.patientConcepts.map(normalizedKey));
  narratives.forEach(narrative => {
    const parsed = Parser.parse(narrative);
    assert.equal(parsed.supported, true);
    for (const fact of parsed.candidateFacts) {
      assert.ok(definedConcepts.has(normalizedKey(fact.concept.code)), `Undefined patient concept ${fact.concept.code}`);
      assert.ok(fact.sourceSpan && Number.isInteger(fact.sourceSpan.start) && fact.sourceSpan.end >= fact.sourceSpan.start);
    }
    const allowedAxes = Vocabulary.clinicalAxes[parsed.cancerType] || {};
    for (const [key, value] of Object.entries(parsed.clinicalAxes)) {
      if (!value || value === 'unknown' || !AXIS_KEY_MAP[key] || !allowedAxes[AXIS_KEY_MAP[key]]) continue;
      const canonical = Schema.normalizeAxisValue(key, value);
      assert.ok(allowedAxes[AXIS_KEY_MAP[key]].includes(canonical), `${parsed.cancerType}.${key} emitted undefined value ${value} -> ${canonical}`);
    }
  });
}

function testLiveCatalogContract() {
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trials.json'), 'utf8'));
  assert.equal(payload.metadata.schemaVersion, Vocabulary.schemaVersion);
  assert.equal(payload.metadata.rawPatientNarrativePersisted, false);
  assert.equal(payload.metadata.trialCount, payload.trials.length);
  let cohortCount = 0;
  let criterionCount = 0;
  const definedConcepts = new Set(Vocabulary.patientConcepts);
  const criterionConcepts = expression => expression?.op === 'FACT'
    ? [expression.concept]
    : (expression?.args || []).flatMap(criterionConcepts);
  for (const trial of payload.trials) {
    assert.equal(trial.schemaVersion, Vocabulary.schemaVersion, `${trial.id} schema version`);
    assert.match(trial.rawRecordHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(trial.classificationIsProbability, false);
    assert.ok(Array.isArray(trial.cohorts) && trial.cohorts.length > 0, `${trial.id} has no cohort fallback.`);
    assert.ok(Array.isArray(trial.criteria), `${trial.id} has no criteria array.`);
    assert.equal(JSON.stringify(trial.sourceTags).includes('AI-extracted'), false);
    const allowedSettings = new Set(Vocabulary.diseaseSettings[trial.cancerType] || []);
    for (const settingId of trial.diseaseSettingAllIds || []) {
      assert.ok(allowedSettings.has(settingId), `${trial.id} has undefined disease setting ${settingId}`);
    }
    const allowedAxes = Vocabulary.clinicalAxes[trial.cancerType] || {};
    for (const [key, value] of Object.entries(trial.clinicalAxes || {})) {
      const schemaKey = AXIS_KEY_MAP[key];
      assert.ok(schemaKey && allowedAxes[schemaKey], `${trial.id} has undefined axis ${key}`);
      assert.ok(allowedAxes[schemaKey].includes(value), `${trial.id}.${key} has undefined value ${value}`);
    }
    for (const site of trial.sites || []) {
      assert.ok(Object.hasOwn(site, 'locationStatus'));
      assert.ok(Object.hasOwn(site, 'statusSource'));
      assert.ok(Object.hasOwn(site, 'sourceVerifiedDate'));
    }
    for (const criterion of trial.criteria) {
      assert.ok(criterion.sourceSpan && typeof criterion.sourceSpan.text === 'string', `${criterion.criterionId} lacks a source span.`);
      const sourceField = criterion.sourceSpan.field;
      if (sourceField === 'inclusionCriteria' || sourceField === 'exclusionCriteria') {
        const source = trial[sourceField] || '';
        assert.equal(source.slice(criterion.sourceSpan.start, criterion.sourceSpan.end), criterion.sourceSpan.text, `${criterion.criterionId} span mismatch`);
      }
      if (criterion.modeledStatus === 'modeled') {
        for (const concept of criterionConcepts(criterion.predicate)) {
          assert.ok(definedConcepts.has(concept), `${criterion.criterionId} has undefined concept ${concept}`);
          assert.equal(/[A-Z]/.test(concept), false, `${criterion.criterionId} concept is not canonical snake_case`);
        }
      } else {
        assert.equal(criterion.predicate.op, 'NOT_MODELED', `${criterion.criterionId} is unmodeled but retains an executable predicate.`);
      }
    }
    cohortCount += trial.cohorts.length;
    criterionCount += trial.criteria.length;
  }
  assert.equal(payload.metadata.cohortCount, cohortCount);
  assert.equal(payload.metadata.criterionCount, criterionCount);
}

testGeneratedVocabulary();
testParserContract();
testLiveCatalogContract();
console.log('Canonical schema contract tests passed.');
