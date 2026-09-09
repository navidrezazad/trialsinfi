const assert = require('node:assert/strict');
const S = require('../../js/clinical-trial-schema.js');
const P = require('../../js/patient-query-parser.js');
const Service = require('../../js/prescreen-search-service.js');
const B = require('../../validation/benchmark-runner.js');
const asOf = '2026-09-08T12:00:00Z';
const fact = (value, extra = {}) => S.createPatientFact({ concept: 'treatment_exposure', predicate: 'received', value, confirmation: 'confirmed', sourceText: String(value), ...extra });
const exposure = drug => ({ op: 'FACT', concept: 'treatment_exposure', predicate: 'received', value: drug });
const evaluate = (expression, facts) => S.evaluateExpression(expression, facts, S.detectContradictions(facts), { asOf });
async function main() {
  assert.equal(evaluate(exposure('docetaxel'), [fact('enzalutamide')]).status, 'UNKNOWN');
  assert.equal(evaluate(exposure('docetaxel'), [fact('docetaxel', { status: 'planned' })]).status, 'UNKNOWN');
  const docetaxel = fact('docetaxel');
  const negative = fact('docetaxel', { factId: 'negative', assertion: 'absent' });
  assert.equal(evaluate(exposure('docetaxel'), [docetaxel, negative]).status, 'UNKNOWN');
  assert.equal(evaluate({ op: 'NONE_OF', args: [exposure('docetaxel')] }, [docetaxel]).status, 'VIOLATED');
  assert.equal(evaluate({ op: 'NONE_OF', args: [exposure('docetaxel')] }, [negative]).status, 'SATISFIED');
  const bothAbsent = [negative, fact('enzalutamide', { factId: 'enz-negative', assertion: 'absent' })];
  const or = evaluate({ op: 'OR', args: [exposure('docetaxel'), exposure('enzalutamide')] }, bothAbsent);
  assert.equal(or.status, 'VIOLATED');
  assert.equal(or.patientFactIds.length, 2);
  for (const expr of [{ op: 'AND', args: [] }, { op: 'BOGUS', args: [exposure('docetaxel')] }]) assert.equal(evaluate(expr, [docetaxel]).status, 'NOT_MODELED');
  const lab = (value, observedAt, extra = {}) => fact(value, { concept: 'hemoglobin_gdl', predicate: 'has', unit: 'g/dL', observedAt, ...extra });
  const hgb = { op: 'FACT', concept: 'hemoglobin_gdl', predicate: 'has', operator: 'GE', value: 9, unit: 'g/dL' };
  assert.equal(evaluate(hgb, [lab(12, '2020-01-01')]).status, 'UNKNOWN');
  assert.equal(evaluate(hgb, [lab(12, '2026-09-01'), lab(8, '2026-09-07')]).status, 'VIOLATED');
  assert.equal(evaluate(hgb, [lab(12, '2026-09-07'), lab(8, '2026-09-07')]).status, 'UNKNOWN');
  assert.equal(evaluate(hgb, [lab(12, '2026-09-09')]).status, 'UNKNOWN');
  assert.notEqual(P.parse('Metastatic prostate cancer. No liver metastases.').clinicalAxes.diseaseVolume, 'high_volume');
  assert.equal(P.parse('Bladder cancer. Inadequate BCG.').clinicalAxes.bcgAdequacy, 'inadequate');
  assert.equal(P.parse('Metastatic RCC, IMDC intermediate risk.').clinicalAxes.imdcRisk, 'intermediate');
  assert.notEqual(P.parse('Metastatic RCC with somatic VHL mutation.').diseaseGroup, 'hereditary');
  assert.equal(P.parse('Prostate cancer. No ADT.').therapyHistory.receivedTherapies.includes('adt'), false);
  const planned = P.parse('Metastatic RCC considering nivolumab + cabozantinib.');
  assert.equal(planned.therapyHistory.receivedTherapies.includes('cabozantinib'), false);
  assert.equal(planned.therapyHistory.plannedTherapies.includes('cabozantinib'), true);
  const parsed = P.parse('72-year-old man with mCRPC.\n  ECOG 1.');
  for (const f of parsed.candidateFacts) assert.equal(parsed.rawQuery.slice(f.sourceSpan.start, f.sourceSpan.end), f.sourceSpan.text);
  const age = parsed.candidateFacts.find(f => f.concept.code === 'age_years');
  const partial = P.reconcileReviewedFacts(parsed, P.applyFactDecisions(parsed, { [age.factId]: { confirmation: 'corrected', value: 73 } }));
  assert.equal(partial.supported, true);
  assert.deepEqual(partial.diseaseSettingIds, parsed.diseaseSettingIds);
  const trials = [
    { id: 'multi', cancerType: 'Bladder', cancerTypes: ['Bladder','Prostate'], status: 'recruiting', title: 'Multiple cancers' },
    { id: 'basket', cancerType: 'Other', status: 'recruiting', title: 'Basket study for advanced solid tumors' },
    { id: 'closed', cancerType: 'Prostate', status: 'completed', title: 'Prostate trial' }
  ];
  const small = await Service.search({ trials, parsedQuery: parsed, asOf });
  assert.deepEqual(small.candidateTrialIds.sort(), ['basket','multi']);
  assert.equal(small.evaluatedCohorts.length, 2);
  const large = await Service.search({ trials: [...trials, ...Array.from({ length: 501 }, (_, i) => ({ id: `filler-${i}`, cancerType: 'Other', status: 'completed' }))], parsedQuery: parsed, asOf });
  assert.deepEqual(large.candidateTrialIds.sort(), small.candidateTrialIds);
  assert.equal(small.evaluatedCohorts.some(row => row.match.hardExcluded), false);
  const empty = { rankedCohortIds: [], goldCohorts: [{ cohortId: 'a', relevance: 1 }] };
  assert.equal(B.numberNeededToReviewAtK(empty, 10), 11);
  assert.throws(() => B.ndcgAtK({ ...empty, rankedCohortIds: ['a','a'] }, 10), /Duplicate/);
  console.log('Pro-review deterministic regressions passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
