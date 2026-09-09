(function (global) {
  "use strict";
  const retrieval = global.TrialRetrieval || (typeof require === "function" && require('./trial-retrieval.js'));
  const matcher = global.PatientTrialMatcher || (typeof require === "function" && require('./patient-trial-matcher.js'));
  const VERSION = 'deterministic-prescreen-2.0.0';
  async function search(options) {
    const candidates = await retrieval.retrieve({ trials: options.trials, parsedQuery: options.parsedQuery, queryText: options.parsedQuery?.rawQuery || options.query || '' });
    const parsedQuery = { ...options.parsedQuery, referenceTime: options.asOf || new Date().toISOString(), retrievalCandidateIds: candidates.map(item => item.trial.nctId || item.trial.id) };
    const result = matcher.matchTrials({ trials: candidates.map(item => item.trial), parsedQuery });
    const lexical = candidates.filter(item => item.retrieval.some(source => source.method === 'bm25')).sort((a, b) => {
      const score = item => item.retrieval.find(source => source.method === 'bm25')?.score || 0;
      return score(b) - score(a);
    });
    const rank = new Map(lexical.map((item, index) => [item.trial.nctId || item.trial.id, index + 1]));
    for (const entry of result.evaluatedCohorts) {
      const id = entry.trial.nctId || entry.trial.id;
      entry.match.retrieval = candidates.find(item => (item.trial.nctId || item.trial.id) === id)?.retrieval || [];
      // Rank fusion contributes review order only; never changes criterion truth.
      entry.match.sortScore += rank.has(id) ? 500 / (60 + rank.get(id)) : 0;
    }
    for (const key of ['priorityReview','potentiallyRelevant','manualReview','modeledConflicts','diseaseContextOnly','evaluatedCohorts']) {
      result[key].sort((a, b) => b.match.sortScore - a.match.sortScore || a.match.cohortId.localeCompare(b.match.cohortId));
    }
    result.serviceVersion = VERSION;
    result.totalCatalogRecords = options.trials.length;
    result.candidateTrialIds = parsedQuery.retrievalCandidateIds;
    return result;
  }
  const api = { search, VERSION };
  global.PrescreenSearchService = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
