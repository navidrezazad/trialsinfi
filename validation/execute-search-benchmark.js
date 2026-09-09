#!/usr/bin/env node
// Executes the production service, never trusts submitted predicted outputs.
const fs = require('node:fs');
const crypto = require('node:crypto');
const Parser = require('../js/patient-query-parser.js');
const Service = require('../js/prescreen-search-service.js');
const Metrics = require('./benchmark-runner.js');
async function execute(benchmark, catalog) {
  if (!benchmark.asOf || !Number.isFinite(Date.parse(benchmark.asOf))) throw new Error('A locked asOf timestamp is required');
  const cases = [];
  for (const row of benchmark.cases || []) {
    if (typeof row.query !== 'string') throw new Error(`Missing query for ${row.caseId}`);
    let parsedQuery = Parser.parse(row.query);
    if (row.factDecisions) parsedQuery = Parser.reconcileReviewedFacts(parsedQuery, Parser.applyFactDecisions(parsedQuery, row.factDecisions));
    const output = await Service.search({ trials: catalog.trials, parsedQuery, asOf: benchmark.asOf });
    const predictions = new Map(output.evaluatedCohorts.flatMap(entry => entry.match.evaluations.map(evaluation => [
      `${entry.match.cohortId}|${evaluation.criterionId}`, evaluation
    ])));
    cases.push({
      caseId: row.caseId, cancerType: parsedQuery.cancerType, subgroups: row.subgroups || {},
      goldCohorts: row.goldCohorts || [],
      candidateCohortIds: output.evaluatedCohorts.map(entry => entry.match.cohortId),
      rankedCohortIds: output.evaluatedCohorts.map(entry => entry.match.cohortId),
      criteria: (row.criteria || []).map(gold => {
        const actual = predictions.get(`${gold.cohortId}|${gold.criterionId}`);
        return { ...gold, predictedState: actual?.status || 'NOT_MODELED', predictedUnknownReason: actual?.unknownReason || null, hardExcluded: actual?.hardExclusionAllowed === true };
      })
    });
  }
  const metrics = Metrics.evaluateBenchmark({ ...benchmark, cases });
  return {
    serviceVersion: Service.VERSION, asOf: benchmark.asOf,
    catalogSha256: crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),
    metrics, releaseAssessment: Metrics.assessGoNo(metrics)
  };
}
module.exports = { execute };
if (require.main === module) {
  const [benchmarkPath, catalogPath] = process.argv.slice(2);
  if (!benchmarkPath || !catalogPath) throw new Error('Usage: node validation/execute-search-benchmark.js benchmark.json catalog.json');
  execute(JSON.parse(fs.readFileSync(benchmarkPath, 'utf8')), JSON.parse(fs.readFileSync(catalogPath, 'utf8')))
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
