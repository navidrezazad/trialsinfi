#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const Schema = require(path.join(ROOT, 'js/clinical-trial-schema.js'));
const ModelAssisted = require(path.join(ROOT, 'js/model-assisted-prescreen.js'));
const Interop = require(path.join(ROOT, 'js/interoperability.js'));
const Telemetry = require(path.join(ROOT, 'js/safety-telemetry.js'));
const Benchmark = require(path.join(ROOT, 'validation/benchmark-runner.js'));
const AnnotationMerge = require(path.join(ROOT, 'validation/merge-annotations.js'));
const Agreement = require(path.join(ROOT, 'validation/annotation-agreement.js'));
const TrialManager = require(path.join(ROOT, 'js/trial-manager-php.js'));

async function testGuardedModelExtensions() {
  await assert.rejects(() => ModelAssisted.proposeCriteria({ enabled: false }), /disabled/);
  const sourceText = 'No systemic therapy within 28 days.';
  const rows = await ModelAssisted.proposeCriteria({
    enabled: true,
    modelVersion: 'extractor@sha256:test',
    validationVersion: 'held-out-v1',
    sourceText,
    provider: async () => [{
      criterionType: 'washout',
      normalizedPredicate: { op: 'FACT', concept: 'sinceLastSystemicTherapyDays', predicate: 'has', operator: 'GE', value: 28 },
      sourceSpan: { start: 0, end: sourceText.length, text: sourceText },
      confidence: 0.93,
      ambiguities: [],
      modelVersion: 'extractor@sha256:test'
    }]
  });
  assert.equal(rows[0].valid, true);
  assert.equal(rows[0].disposition, 'requires_clinician_review');
  assert.equal(rows[0].mayHardExclude, false);

  const cohortRows = await ModelAssisted.proposeCohorts({
    enabled: true,
    modelVersion: 'segmenter@sha256:test',
    validationVersion: 'held-out-v1',
    sourceText: 'Cohort A: mCRPC after ARPI.',
    criterionIds: ['c1'],
    provider: async ({ sourceText: text }) => [{ label: 'Cohort A', sourceSpan: { start: 0, end: text.length, text }, criterionIds: ['c1'], confidence: 0.88, ambiguities: [], modelVersion: 'segmenter@sha256:test' }]
  });
  assert.equal(cohortRows[0].valid, true);
  assert.equal(cohortRows[0].autoApplied, false);
  assert.equal(cohortRows[0].disposition, 'requires_curator_review');

  const queue = ModelAssisted.buildActiveLearningQueue([
    { recordId: 'safe-1', cancerType: 'Prostate', errorCategory: 'negation', uncertainty: 0.9, overrideCount: 2 },
    { recordId: 'unsafe', rawQuery: 'patient narrative', uncertainty: 1 }
  ]);
  assert.deepEqual(queue.map(item => item.recordId), ['safe-1']);
}

function testLosslessInterop() {
  const factSet = {
    schemaVersion: Schema.SCHEMA_VERSION,
    patientVersion: 'patient-test-v1',
    facts: [Schema.createPatientFact({ factId: 'pf-1', concept: { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }, predicate: 'has', value: 9.5, unit: 'g/dL', sourceText: 'hemoglobin 9.5 g/dL', confirmation: 'confirmed' })],
    contradictions: []
  };
  const patientBundle = Interop.patientFactSetToFhir(factSet);
  assert.equal(patientBundle.resourceType, 'Bundle');
  assert.deepEqual(Interop.patientFactSetFromFhir(patientBundle), factSet);

  const cohort = {
    schemaVersion: Schema.SCHEMA_VERSION,
    cohortId: 'NCT-TEST:cohort-a',
    label: 'Cohort A',
    enrollmentStatus: 'recruiting',
    sharedCriteria: [{ criterionId: 'c1', kind: 'inclusion', predicate: { op: 'FACT', concept: 'ecogStatus', operator: 'LE', value: 1 }, sourceSpan: { text: 'ECOG <= 1' } }],
    cohortSpecificCriteria: [],
    cohortExtraction: { method: 'manual', confidence: 1, reviewedBy: 'reviewer', reviewedAt: '2026-08-01T00:00:00Z' }
  };
  const evidenceBundle = Interop.cohortToFhirEvidenceVariable(cohort);
  assert.ok(evidenceBundle.entry.some(entry => entry.resource.resourceType === 'EvidenceVariable'));
  assert.deepEqual(Interop.cohortFromFhir(evidenceBundle), cohort);
  const odm = Interop.cohortToCdiscOdm(cohort);
  assert.equal(odm.ODM.ODMVersion, '1.3.2');
  assert.deepEqual(Interop.cohortFromCdiscOdm(odm), cohort);
}

function testBenchmarkAndTelemetry() {
  const cases = Array.from({ length: 400 }, (_, index) => ({
    caseId: `case-${index + 1}`,
    subgroups: { cancer: ['Prostate', 'Bladder', 'Kidney', 'Testicular'][index % 4] },
    goldCohorts: [{ cohortId: `cohort-${index + 1}`, relevance: 2 }],
    candidateCohortIds: [`cohort-${index + 1}`],
    rankedCohortIds: [`cohort-${index + 1}`],
    rankedResults: [{ cohortId: `cohort-${index + 1}`, relevanceProbability: 0.99 }],
    priorityResults: [{ cohortId: `cohort-${index + 1}`, goldRelevant: true, hasCriticalNotModeled: false, lowQualityTrial: false }],
    criteria: [{
      cohortId: `cohort-${index + 1}`,
      criterionId: `criterion-${index + 1}`,
      goldState: 'VIOLATED',
      predictedState: 'VIOLATED',
      critical: true,
      hardExcluded: true,
      hardExclusionGold: true,
      tags: ['numeric', 'temporal', 'negation', 'contradiction', 'cohort_scope'],
      goldPositive: true,
      predictedPositive: true
    }]
  }));
  const metrics = Benchmark.evaluateBenchmark({
    benchmarkVersion: 'test-perfect-v1',
    trialSnapshot: 'snapshot-v1',
    interRaterAgreement: 0.85,
    maximumRegistryIngestionHours: 12,
    sentinelFailures: 0,
    cases
  });
  assert.equal(metrics.retrieval.macroRecallAt10, 1);
  assert.equal(metrics.retrieval.candidateFalseNegativeRate, 0);
  assert.equal(metrics.retrieval.numberNeededToReviewAt10, 1);
  assert.equal(metrics.criteria.criticalViolationSensitivity, 1);
  assert.equal(metrics.coverage.selectiveErrorRate, 0);
  assert.ok(metrics.calibration.brier < 0.001);
  assert.equal(Benchmark.assessGoNo(metrics).decision, 'NO_GO', 'Synthetic perfect outputs do not establish independent clinical validation.');
  const boundaryMetrics = structuredClone(metrics);
  boundaryMetrics.criteria.unsafeHardExclusion95.upper = 0.02;
  assert.equal(Benchmark.assessGoNo(boundaryMetrics).decision, 'NO_GO', 'The unsafe-exclusion upper bound is strictly below 2%.');

  const aggregate = Telemetry.createAggregate();
  Telemetry.record(aggregate, { eventType: 'abstention', cancerType: 'Kidney', reviewTier: 'MANUAL_REVIEW_TRIAL_DATA', errorCategory: 'trial_data_missing' });
  assert.equal(aggregate.total, 1);
  assert.equal(aggregate.byReviewTier.MANUAL_REVIEW_TRIAL_DATA, 1);
  assert.throws(() => Telemetry.assertNoPatientPayload({ rawQuery: 'secret' }), /prohibited/);
  assert.equal(JSON.stringify(aggregate).includes('secret'), false);

  assert.equal(Benchmark.normalizeCriterionState({ predictedState: 'UNKNOWN', predictedUnknownReason: 'TRIAL_SOURCE_AMBIGUOUS' }, 'predictedState'), 'AMBIGUOUS_TRIAL');
}

function testBlindedAnnotationMergeAndAgreement() {
  const benchmark = {
    benchmarkVersion: 'annotation-v1',
    trialSnapshot: 'snapshot-v1',
    annotationManualVersion: '1.0.0',
    worklist: [
      { caseId: 'case-1', cohortId: 'cohort-1' },
      { caseId: 'case-2', cohortId: 'cohort-2' }
    ]
  };
  const artifact = (role, reviewerId, labels) => ({
    artifactType: 'independent_review', role, reviewerId,
    benchmarkVersion: benchmark.benchmarkVersion,
    trialSnapshot: benchmark.trialSnapshot,
    annotationManualVersion: benchmark.annotationManualVersion,
    annotations: Object.fromEntries(benchmark.worklist.map((pair, index) => {
      const field = role;
      return [`${pair.caseId}|${pair.cohortId}`, {
        ...pair,
        [field]: { reviewerId, relevance: labels[index], criteria: [{ criterionId: `c-${index}`, state: index ? 'UNKNOWN_PATIENT' : 'SATISFIED' }] }
      }];
    }))
  });
  const left = artifact('reviewerA', 'reviewer-a', ['PRIORITY_REVIEW', 'PLAUSIBLE']);
  const right = artifact('reviewerB', 'reviewer-b', ['PRIORITY_REVIEW', 'NOT_RELEVANT']);
  const merged = AnnotationMerge.mergeIndependentReviews(benchmark, left, right);
  assert.equal(merged.annotationMerge.blindedIndependentReview, true);
  const agreement = Agreement.fromMergedArtifact(merged);
  assert.equal(agreement.relevance.count, 2);
  assert.equal(agreement.relevance.value, 0.5);
  assert.ok(Number.isFinite(agreement.relevance.gwetAc1));
  assert.ok(Number.isFinite(agreement.relevance.krippendorffAlphaNominal));
  assert.throws(() => AnnotationMerge.mergeIndependentReviews(benchmark, left, { ...right, reviewerId: 'reviewer-a' }), /must differ/);
}

async function testCanonicalCatalogSkipsLegacyRepair() {
  const manager = new TrialManager();
  const trials = [{ id: 'NCT-CANONICAL', cohorts: [], criteria: [], provenance: { schemaVersion: '1.0.0' } }];
  const metadata = { schemaVersion: '1.0.0' };
  const result = await manager.attemptStructuredRepair(trials, metadata);
  assert.strictEqual(result.trials, trials, 'Canonical catalogs must not trigger redundant repair downloads.');
  assert.strictEqual(result.metadata, metadata);
}

async function main() {
  await testGuardedModelExtensions();
  testLosslessInterop();
  testBenchmarkAndTelemetry();
  testBlindedAnnotationMergeAndAgreement();
  await testCanonicalCatalogSkipsLegacyRepair();
  console.log('Guarded research-extension tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
