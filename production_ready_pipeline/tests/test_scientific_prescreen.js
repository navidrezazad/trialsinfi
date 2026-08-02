#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const Schema = require(path.join(ROOT, 'js/clinical-trial-schema.js'));
const Parser = require(path.join(ROOT, 'js/patient-query-parser.js'));
const Matcher = require(path.join(ROOT, 'js/patient-trial-matcher.js'));
const Retrieval = require(path.join(ROOT, 'js/trial-retrieval.js'));

function trial(overrides = {}) {
  return {
    id: 'NCT-SCIENCE',
    nctId: 'NCT-SCIENCE',
    title: 'Scientific prescreen test trial',
    description: '',
    cancerType: 'Prostate',
    cancerTypes: ['Prostate'],
    status: 'recruiting',
    phase: 'Phase I/II',
    diseaseSettingAllIds: [],
    clinicalAxes: {},
    sourceTags: {},
    eligibilityCriteria: [],
    inclusionCriteria: '',
    exclusionCriteria: '',
    sites: [{ locationStatus: 'recruiting' }],
    ...overrides
  };
}

function matchOne(query, trialValue) {
  const parsedQuery = Parser.parse(query);
  const result = Matcher.matchTrials({ trials: [trialValue], parsedQuery });
  assert.equal(result.totalConsidered, 1);
  return result.evaluatedCohorts[0].match;
}

function confirmAll(parsed) {
  const decisions = Object.fromEntries(parsed.candidateFacts.map(fact => [fact.factId, { confirmation: 'confirmed' }]));
  parsed.patientFactSet = Parser.applyFactDecisions(parsed, decisions);
  return parsed;
}

function testFactReviewAudit() {
  const parsed = Parser.parse('72-year-old man with mCRPC. ECOG 1.');
  const age = parsed.candidateFacts.find(fact => fact.concept.code === 'age_years');
  const sex = parsed.candidateFacts.find(fact => fact.concept.code === 'administrative_sex');
  const decisions = Object.fromEntries(parsed.candidateFacts.map(fact => [fact.factId, { confirmation: 'confirmed' }]));
  decisions[age.factId] = { confirmation: 'corrected', value: 73 };
  decisions[sex.factId] = { confirmation: 'rejected' };
  const factSet = Parser.applyFactDecisions(parsed, decisions);
  const originalAge = factSet.facts.find(fact => fact.factId === age.factId);
  const correctedAge = factSet.facts.find(fact => fact.supersedes === age.factId);
  assert.equal(originalAge.confirmation, 'rejected');
  assert.equal(originalAge.supersededBy, correctedAge.factId);
  assert.equal(correctedAge.confirmation, 'corrected');
  assert.equal(correctedAge.value, 73);
  assert.equal(factSet.facts.find(fact => fact.factId === sex.factId).confirmation, 'rejected');
  const reviewed = Parser.reconcileReviewedFacts(parsed, factSet);
  assert.equal(reviewed.demographics.ageYears, 73, 'Physician corrections must replace parser values for all matching paths.');
  assert.equal(reviewed.demographics.administrativeSex, '', 'Rejected parser facts must not remain in legacy fields.');

  const diseaseParsed = Parser.parse('mCRPC after enzalutamide.');
  const diseaseFact = diseaseParsed.candidateFacts.find(fact => fact.concept.code === 'disease_context');
  const diseaseDecisions = Object.fromEntries(diseaseParsed.candidateFacts.map(fact => [fact.factId, { confirmation: 'confirmed' }]));
  diseaseDecisions[diseaseFact.factId] = { confirmation: 'corrected', value: 'cspc' };
  const diseaseFactSet = Parser.applyFactDecisions(diseaseParsed, diseaseDecisions);
  const diseaseReviewed = Parser.reconcileReviewedFacts(diseaseParsed, diseaseFactSet);
  assert.equal(diseaseReviewed.diseaseGroup, 'cspc');
  assert.deepEqual(diseaseReviewed.diseaseSettingIds, [], 'A corrected disease context must fall back to broad same-cancer retrieval.');
}

function testAdversarialParser() {
  let parsed = Parser.parse('Metastatic clear-cell RCC, no prior nivolumab, no prior cabozantinib.');
  assert.equal(parsed.clinicalAxes.priorIo, 'no');
  assert.equal(parsed.clinicalAxes.priorVegfTki, 'no');

  parsed = Parser.parse('Muscle-invasive bladder cancer.');
  assert.equal(parsed.locationPreferences.includes('usc'), false, 'Substrings must not create location preferences.');

  parsed = Parser.parse('Mixed seminoma and nonseminomatous GCT, stage I.');
  assert.equal(parsed.clinicalAxes.histology, 'mixed_seminoma_nsgct');

  parsed = Parser.parse('Metastatic urothelial carcinoma. FGFR3 mutation negative.');
  assert.equal(parsed.clinicalAxes.fgfr3Status, 'wild_type');

  parsed = Parser.parse('mCRPC. Labs not normal.');
  assert.equal(parsed.screeningFacts.labState, 'abnormal_unspecified');

  parsed = Parser.parse('Localized prostate cancer. Gleason score 8.');
  assert.equal(parsed.clinicalAxes.genomicClassifier, '');

  parsed = Parser.parse('mCRPC. FGFR3 wild-type.');
  assert.equal(parsed.clinicalAxes.biomarkerHrr, '', 'Unrelated wild-type text must not set HRR status.');

  parsed = Parser.parse('Metastatic prostate cancer, Gleason 9.');
  assert.equal(parsed.diseaseGroup, 'metastatic_unspecified');

  parsed = Parser.parse('mCSPC with 4 bone metastases confined to spine and pelvis, no visceral disease.');
  assert.notEqual(parsed.clinicalAxes.diseaseVolume, 'high_volume');

  parsed = Parser.parse('Metastatic clear-cell RCC with somatic VHL mutation.');
  assert.equal(parsed.clinicalAxes.vhlStatus, 'somatic_vhl_mutation');

  parsed = Parser.parse('Testicular NSGCT stage I with no LVI.');
  assert.equal(parsed.clinicalAxes.stage1RiskFactors, 'without_risk_factors');

  parsed = Parser.parse('mCRPC. Labs on 2026-08-01: hemoglobin 9.5 g/dL, ANC 1.5 x 10^9/L, platelets 125 K/uL, CrCl 55 mL/min.');
  const labs = parsed.screeningFacts.laboratoryResults;
  assert.deepEqual(labs.map(item => [item.concept, item.value, item.unit]), [
    ['hemoglobinGdl', 9.5, 'g/dL'],
    ['absoluteNeutrophilCount', 1500, 'cells/uL'],
    ['plateletCount', 125000, 'cells/uL'],
    ['creatinineClearanceMlMin', 55, 'mL/min']
  ]);
  assert.equal(parsed.candidateFacts.find(fact => fact.unit === 'g/dL').assertion, 'present', 'Axis aliases must not corrupt assertion semantics.');

  parsed = Parser.parse('72-year-old man with mCRPC considering pembrolizumab.');
  assert.equal(parsed.therapyHistory.receivedTherapies.includes('pembrolizumab'), false, 'Planned therapy must not become prior exposure.');
  assert.equal(parsed.therapyHistory.plannedTherapies.includes('pembrolizumab'), true);
  assert.equal(parsed.candidateFacts.some(fact => fact.concept.code === 'age_years' && fact.value === 72), true);
  assert.equal(parsed.candidateFacts.some(fact => fact.concept.code === 'administrative_sex' && fact.value === 'male'), true);
  assert.equal(parsed.candidateFacts.some(fact => fact.predicate === 'planned' && fact.assertion === 'hypothetical'), true);

  parsed = Parser.parse('Known prostate cancer. Cannot rule out brain metastases.');
  assert.notEqual(parsed.diseaseGroup, 'metastatic_unspecified', 'Uncertain metastasis language must not create a positive disease-state fact.');
  assert.equal(parsed.contextWarnings.some(item => item.code === 'uncertain_assertion_excluded'), true);

  parsed = Parser.parse('Family history of prostate cancer in father.');
  assert.equal(parsed.supported, false, 'Family history alone must not be treated as the patient diagnosis.');

  parsed = Parser.parse('72-year-old woman with metastatic clear-cell RCC after nivolumab on 2026-06-01.');
  const nivolumab = parsed.candidateFacts.find(fact => fact.concept.code === 'treatment_exposure' && fact.value === 'nivolumab');
  assert.equal(nivolumab.temporality.eventTime, '2026-06-01T00:00:00.000Z');

  parsed = Parser.parse('MRN 123456. Metastatic prostate cancer.');
  assert.equal(parsed.directIdentifierWarnings.some(item => item.code === 'medical_record_number'), true);
}

function testSafeResultSemantics() {
  const missingTrialData = matchOne('mCRPC after enzalutamide.', trial({ diseaseSettingAllIds: [] }));
  assert.equal(missingTrialData.reviewTier, 'MANUAL_REVIEW_TRIAL_DATA');
  assert.equal(missingTrialData.hardExcluded, false);
  assert.equal(/Strong match/i.test(missingTrialData.badge), false);

  const washoutTrial = trial({
    inclusionCriteria: 'ECOG 0 or 1.',
    exclusionCriteria: 'No systemic anti-cancer therapy within 28 days before enrollment.'
  });
  const tooSoon = matchOne('mCRPC after enzalutamide. ECOG 1. Last systemic therapy 21 days ago.', washoutTrial);
  assert.ok(tooSoon.potentialConflicts.includes('washout_window'));
  assert.equal(tooSoon.hardExcluded, false, 'Unreviewed regex evidence cannot hard-exclude.');

  const sufficient = matchOne('mCRPC after enzalutamide. ECOG 1. Last systemic therapy 35 days ago.', washoutTrial);
  assert.equal(sufficient.potentialConflicts.includes('washout_window'), false);
  assert.ok(sufficient.resolvedFacts.some(value => value.includes('protocol requires 28d')));

  const labs = matchOne('mCRPC after enzalutamide. Labs normal. Adequate organ function.', trial({
    inclusionCriteria: 'ANC >= 1500/mm3, platelets >= 100000/mm3, and hemoglobin >= 9 g/dL.'
  }));
  assert.ok(labs.flags.some(flag => flag.code === 'lab_organ_function'));

  const allComerHer2 = matchOne('Metastatic urothelial carcinoma. HER2 negative.', trial({
    cancerType: 'Bladder',
    cancerTypes: ['Bladder'],
    title: 'Trastuzumab deruxtecan all-comer urothelial study',
    interventions: ['trastuzumab deruxtecan'],
    sourceTags: { clinicalAxes: { her2Status: 'Deterministic rule-inferred' } },
    clinicalAxes: { her2Status: 'ihc_3_plus' },
    inclusionCriteria: 'Metastatic urothelial carcinoma; archival tissue requested for exploratory analysis.'
  }));
  assert.equal(allComerHer2.potentialConflicts.includes('her2_status'), false, 'Intervention names are retrieval signals, not eligibility criteria.');
}

function testReviewedHardExclusionGate() {
  const parsed = confirmAll(Parser.parse('Metastatic prostate cancer.'));
  const ageFact = Schema.createPatientFact({
    factId: 'pf-age',
    concept: { system: 'local', code: 'ageYears', display: 'Age' },
    predicate: 'has',
    value: 17,
    assertion: 'present',
    confirmation: 'confirmed',
    sourceText: 'age 17'
  });
  parsed.patientFactSet.facts.push(ageFact);
  const reviewedCriterion = {
    criterionId: 'NCT-SCIENCE:age',
    scope: 'cohort',
    kind: 'inclusion',
    criticality: 'hard',
    predicate: { op: 'FACT', concept: 'ageYears', predicate: 'has', operator: 'GE', value: 18 },
    sourceSpan: { field: 'minimumAge', text: '18 Years', start: 0, end: 8 },
    provenance: { source: 'ClinicalTrials.gov' },
    reviewStatus: 'clinician_reviewed',
    modeledStatus: 'modeled'
  };
  const reviewedTrial = trial({
    registryVersion: new Date().toISOString(),
    cohorts: [{
      cohortId: 'NCT-SCIENCE:cohort-a',
      label: 'Cohort A',
      enrollmentStatus: 'recruiting',
      diseaseConcepts: [],
      sites: [{ locationStatus: 'recruiting' }],
      sharedCriteria: [reviewedCriterion],
      cohortSpecificCriteria: [],
      cohortExtraction: { method: 'manual', confidence: 1, reviewedBy: 'clinician-1', reviewedAt: new Date().toISOString() }
    }]
  });
  const result = Matcher.matchTrials({ trials: [reviewedTrial], parsedQuery: parsed });
  const match = result.evaluatedCohorts[0].match;
  assert.equal(match.reviewTier, 'MODELED_CONFLICT');
  assert.equal(match.hardExcluded, true);
  assert.equal(result.modeledConflicts.length, 1, 'Hard conflicts remain visible for audit.');

  reviewedCriterion.reviewStatus = 'unreviewed';
  const unreviewed = Matcher.matchTrials({ trials: [reviewedTrial], parsedQuery: parsed }).evaluatedCohorts[0].match;
  assert.equal(unreviewed.hardExcluded, false);

  const hemoglobinFact = Schema.createPatientFact({
    factId: 'pf-hgb',
    concept: 'hemoglobinGdl',
    predicate: 'has',
    value: 9.5,
    unit: 'g/dL',
    assertion: 'present',
    confirmation: 'confirmed',
    sourceText: 'hemoglobin 9.5 g/dL'
  });
  const labCriterion = {
    criterionId: 'NCT-SCIENCE:hgb',
    criticality: 'hard',
    predicate: { op: 'FACT', concept: 'hemoglobinGdl', predicate: 'has', operator: 'GE', value: 9, unit: 'g/dL' },
    reviewStatus: 'clinician_reviewed',
    modeledStatus: 'modeled'
  };
  const labEvaluation = Schema.evaluateCriterion(labCriterion, { facts: [hemoglobinFact], contradictions: [] }, { trialSourceIsCurrent: true });
  assert.equal(labEvaluation.status, 'SATISFIED');
  const wrongUnit = Schema.evaluateCriterion({ ...labCriterion, predicate: { ...labCriterion.predicate, unit: 'mmol/L' } }, { facts: [hemoglobinFact], contradictions: [] }, { trialSourceIsCurrent: true });
  assert.equal(wrongUnit.status, 'UNKNOWN', 'Unit mismatches must abstain.');

  const possibleFact = Schema.createPatientFact({
    factId: 'pf-possible-metastasis',
    concept: 'metastaticStatus',
    predicate: 'has',
    value: 'metastatic',
    assertion: 'possible',
    confirmation: 'confirmed',
    sourceText: 'possible metastasis'
  });
  const metastasisCriterion = {
    criterionId: 'NCT-SCIENCE:metastasis',
    criticality: 'hard',
    predicate: { op: 'FACT', concept: 'metastaticStatus', predicate: 'has', operator: 'EQ', value: 'metastatic' },
    reviewStatus: 'clinician_reviewed',
    modeledStatus: 'modeled'
  };
  const possibleEvaluation = Schema.evaluateCriterion(metastasisCriterion, { facts: [possibleFact], contradictions: [] }, { trialSourceIsCurrent: true });
  assert.equal(possibleEvaluation.status, 'UNKNOWN');
  assert.equal(possibleEvaluation.unknownReason, 'PATIENT_FACT_UNCERTAIN');
  assert.equal(possibleEvaluation.hardExclusionAllowed, false);

  const familyFact = Schema.createPatientFact({
    factId: 'pf-family-metastasis',
    concept: 'metastaticStatus',
    predicate: 'has',
    value: 'metastatic',
    assertion: 'present',
    experiencer: 'family_member',
    confirmation: 'confirmed',
    sourceText: 'father had metastatic disease'
  });
  const familyEvaluation = Schema.evaluateCriterion(metastasisCriterion, { facts: [familyFact], contradictions: [] }, { trialSourceIsCurrent: true });
  assert.equal(familyEvaluation.status, 'UNKNOWN', 'Non-patient experiencers cannot satisfy patient criteria.');

  const disabledEvaluation = Schema.evaluateCriterion(
    { ...metastasisCriterion, modeledStatus: 'not_modeled' },
    { facts: [Schema.createPatientFact({ ...possibleFact, assertion: 'present' })], contradictions: [] },
    { trialSourceIsCurrent: true }
  );
  assert.equal(disabledEvaluation.status, 'NOT_MODELED', 'Criterion-level modeledStatus must be authoritative.');

  const freshSite = { sourceVerifiedDate: new Date().toISOString(), statusStale: false };
  const qualityCohort = {
    ...reviewedTrial.cohorts[0],
    sites: [{ ...freshSite, locationStatus: 'active_not_recruiting' }]
  };
  assert.equal(Schema.calculateTrialDataQuality(qualityCohort, reviewedTrial).currentLocalCohort, false, 'Active-not-recruiting is not current enrollment evidence.');
  qualityCohort.sites = [{ ...freshSite, locationStatus: 'recruiting' }];
  assert.equal(Schema.calculateTrialDataQuality(qualityCohort, reviewedTrial).currentLocalCohort, true);
}

function testContractsAndRetrieval() {
  const proposalSource = 'No systemic therapy within 28 days.';
  const proposal = {
    criterionType: 'washout',
    normalizedPredicate: { op: 'FACT', concept: 'test_fact', predicate: 'has', operator: 'EQ', value: true },
    sourceSpan: { start: 0, end: proposalSource.length, text: proposalSource },
    confidence: 0.9,
    ambiguities: [],
    modelVersion: 'test-model'
  };
  assert.equal(Schema.validateModelProposal(proposal, proposalSource).valid, true);
  assert.equal(Schema.validateModelProposal({ ...proposal, decision: 'eligible' }, proposalSource).valid, false);

  const candidates = Retrieval.structuredCandidates([
    trial({ id: 'p1', nctId: 'p1' }),
    trial({ id: 'b1', nctId: 'b1', cancerType: 'Bladder', cancerTypes: ['Bladder'] })
  ], { cancerType: 'Prostate', diseaseSettingIds: [] });
  assert.deepEqual(candidates.map(item => item.trial.id), ['p1']);

  for (const file of ['patient-fact.schema.json', 'trial-cohort.schema.json', 'model-proposal.schema.json', 'cohort-segmentation-proposal.schema.json', 'clinical-vocabulary.json']) {
    JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', file), 'utf8'));
  }

  const mainSource = fs.readFileSync(path.join(ROOT, 'js/main-php.js'), 'utf8');
  assert.equal(/localStorage\.setItem\(['"]cts_patient_query/.test(mainSource), false, 'Raw narratives must not be persisted.');
}

function main() {
  testFactReviewAudit();
  testAdversarialParser();
  testSafeResultSemantics();
  testReviewedHardExclusionGate();
  testContractsAndRetrieval();
  console.log('Scientific prescreen safety tests passed.');
}

main();
