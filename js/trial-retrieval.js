(function (global) {
  "use strict";

  const DEFAULT_K = 50;
  const STOPWORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "of", "on", "or", "that", "the", "to", "with"]);

  function normalize(value) {
    return (value == null ? "" : String(value)).toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
  }

  function tokenize(value) {
    return normalize(value).split(/\s+/).filter(token => token.length > 1 && !STOPWORDS.has(token));
  }

  function trialText(trial) {
    return [
      trial?.title,
      trial?.description,
      trial?.qualification,
      trial?.conditions,
      trial?.interventions,
      trial?.diseaseSettingAll,
      trial?.diseaseSettingAllIds,
      trial?.inclusionCriteria,
      trial?.exclusionCriteria
    ].flat().filter(Boolean).join(" ");
  }

  function sameCancer(trial, cancerType) {
    const requested = normalize(cancerType);
    const values = [trial?.cancerType].concat(trial?.cancerTypes || []).map(normalize);
    return !requested || values.includes(requested);
  }

  function isOpenOrUncertain(trial) {
    return ["recruiting", "active_not_recruiting", "not_yet_recruiting", "not_specified", "unknown", ""].includes(normalize(trial?.status).replace(/ /g, "_"));
  }

  function buildBm25Index(trials) {
    const documents = (Array.isArray(trials) ? trials : []).map(trial => {
      const terms = tokenize(trialText(trial));
      const frequencies = new Map();
      terms.forEach(term => frequencies.set(term, (frequencies.get(term) || 0) + 1));
      return { trial, terms, frequencies, length: terms.length };
    });
    const documentFrequency = new Map();
    documents.forEach(document => {
      new Set(document.terms).forEach(term => documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1));
    });
    const averageLength = documents.length
      ? documents.reduce((sum, document) => sum + document.length, 0) / documents.length
      : 0;
    return { documents, documentFrequency, averageLength, size: documents.length };
  }

  function bm25Search(index, query, limit) {
    const terms = tokenize(query);
    const k1 = 1.2;
    const b = 0.75;
    return index.documents.map(document => {
      let score = 0;
      terms.forEach(term => {
        const frequency = document.frequencies.get(term) || 0;
        if (!frequency) return;
        const df = index.documentFrequency.get(term) || 0;
        const idf = Math.log(1 + (index.size - df + 0.5) / (df + 0.5));
        const denominator = frequency + k1 * (1 - b + b * document.length / Math.max(index.averageLength, 1));
        score += idf * (frequency * (k1 + 1)) / denominator;
      });
      return { trial: document.trial, score };
    }).filter(item => item.score > 0).sort((a, bValue) => bValue.score - a.score).slice(0, limit || DEFAULT_K);
  }

  function structuredCandidates(trials, parsedQuery) {
    const requestedIds = new Set(parsedQuery?.diseaseSettingIds || []);
    return (Array.isArray(trials) ? trials : [])
      .filter(trial => sameCancer(trial, parsedQuery?.cancerType) && isOpenOrUncertain(trial))
      .map(trial => {
        const trialIds = new Set(trial?.diseaseSettingAllIds || []);
        const overlap = requestedIds.size > 0 && Array.from(requestedIds).some(id => trialIds.has(id));
        return { trial, score: overlap ? 1 : 0.25, reason: overlap ? "structured_overlap" : "same_cancer_recall" };
      });
  }

  function unionCandidates(candidateSets) {
    const union = new Map();
    (candidateSets || []).flat().forEach(item => {
      const trial = item?.trial || item;
      const id = trial?.nctId || trial?.id;
      if (!id) return;
      if (!union.has(id)) union.set(id, { trial, retrieval: [], retrievalScore: 0 });
      const entry = union.get(id);
      entry.retrieval.push({
        method: item?.method || item?.reason || "unknown",
        score: Number(item?.score || 0)
      });
      entry.retrievalScore = Math.max(entry.retrievalScore, Number(item?.score || 0));
    });
    return Array.from(union.values());
  }

  function structuredPatientQuery(parsedQuery) {
    const facts = parsedQuery?.patientFactSet?.facts || [];
    const confirmed = facts
      .filter(fact => ["confirmed", "corrected"].includes(normalize(fact.confirmation)) && normalize(fact.experiencer || "patient") === "patient")
      .map(fact => ({
        concept: fact?.concept?.code || fact?.conceptId,
        predicate: fact?.predicate,
        value: fact?.value,
        unit: fact?.unit || null,
        assertion: fact?.assertion,
        status: fact?.status
      }));
    return {
      cancerType: parsedQuery?.cancerType || "",
      diseaseSettingIds: (parsedQuery?.diseaseSettingIds || []).slice(),
      confirmedFacts: confirmed
    };
  }

  async function retrieve(options) {
    const trials = Array.isArray(options?.trials) ? options.trials : [];
    const parsedQuery = options?.parsedQuery || {};
    const sameCancerSet = structuredCandidates(trials, parsedQuery).map(item => ({ ...item, method: item.reason }));

    // Exhaustive same-cancer evaluation is the default while this catalog remains small.
    if (sameCancerSet.length <= Number(options?.exhaustiveThreshold || 500)) {
      return unionCandidates([sameCancerSet]);
    }

    const queryText = options?.queryText || parsedQuery?.deidentifiedQuery || parsedQuery?.rawQuery || "";
    const lexical = bm25Search(buildBm25Index(trials.filter(trial => sameCancer(trial, parsedQuery?.cancerType))), queryText, options?.lexicalLimit || DEFAULT_K)
      .map(item => ({ ...item, method: "bm25" }));
    let dense = [];
    if (typeof options?.denseProvider === "function") {
      // Never pass raw narrative or source spans to an injected retrieval
      // provider. The provider receives confirmed, source-free structure only.
      const proposed = await options.denseProvider({
        trials,
        structuredPatientQuery: structuredPatientQuery(parsedQuery),
        limit: options?.denseLimit || DEFAULT_K
      });
      dense = (Array.isArray(proposed) ? proposed : []).map(item => ({ ...item, method: "dense" }));
    }
    return unionCandidates([sameCancerSet, lexical, dense]);
  }

  const api = { tokenize, trialText, sameCancer, isOpenOrUncertain, buildBm25Index, bm25Search, structuredCandidates, unionCandidates, structuredPatientQuery, retrieve };
  global.TrialRetrieval = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
