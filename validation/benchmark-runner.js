#!/usr/bin/env node
(function (global) {
  "use strict";

  const fs = typeof require === "function" ? require("node:fs") : null;

  const DEFAULT_THRESHOLDS = Object.freeze({
    macroRecallAt50: 0.98,
    candidateRecallLower95: 0.95,
    recallAt10: 0.95,
    subgroupRecallAt10: 0.90,
    unsafeHardExclusionRate: 0.005,
    unsafeHardExclusionUpper95: 0.02,
    criticalViolationSensitivity: 0.97,
    criticalFalseSatisfactionRate: 0.01,
    negationSensitivity: 0.95,
    temporalWindowAccuracy: 0.95,
    contradictionSensitivity: 0.95,
    priorityPrecision: 0.90,
    priorityCriticalNotModeled: 0,
    priorityLowQuality: 0,
    interRaterAgreement: 0.80,
    sentinelFailures: 0,
    maximumRegistryIngestionHours: 24
  });

  function safeDivide(numerator, denominator) {
    return denominator ? numerator / denominator : null;
  }

  function mean(values) {
    const finite = (values || []).filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  }

  function wilsonInterval(successes, total, z = 1.959963984540054) {
    if (!total) return { lower: null, upper: null };
    const p = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = (p + (z * z) / (2 * total)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total)) / denominator;
    return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
  }

  function relevantIds(testCase) {
    return new Set((testCase.goldCohorts || []).filter(item => Number(item.relevance || 0) > 0).map(item => item.cohortId));
  }

  function recallAtK(testCase, k) {
    const relevant = relevantIds(testCase);
    if (!relevant.size) return null;
    const retrieved = new Set((testCase.rankedCohortIds || []).slice(0, k));
    return Array.from(relevant).filter(id => retrieved.has(id)).length / relevant.size;
  }

  function precisionAtK(testCase, k) {
    const ranked = (testCase.rankedCohortIds || []).slice(0, k);
    if (!ranked.length) return null;
    const relevant = relevantIds(testCase);
    return ranked.filter(id => relevant.has(id)).length / ranked.length;
  }

  function dcg(values) {
    return values.reduce((score, relevance, index) => score + ((2 ** relevance) - 1) / Math.log2(index + 2), 0);
  }

  function ndcgAtK(testCase, k) {
    const relevance = new Map((testCase.goldCohorts || []).map(item => [item.cohortId, Number(item.relevance || 0)]));
    const actual = (testCase.rankedCohortIds || []).slice(0, k).map(id => relevance.get(id) || 0);
    const ideal = Array.from(relevance.values()).sort((a, b) => b - a).slice(0, k);
    const idealScore = dcg(ideal);
    return idealScore ? dcg(actual) / idealScore : null;
  }

  function reciprocalRank(testCase) {
    const relevant = relevantIds(testCase);
    const index = (testCase.rankedCohortIds || []).findIndex(id => relevant.has(id));
    return index >= 0 ? 1 / (index + 1) : 0;
  }

  function numberNeededToReviewAtK(testCase, k) {
    const ranked = (testCase.rankedCohortIds || []).slice(0, k);
    const relevant = relevantIds(testCase);
    if (!relevant.size) return null;
    const found = ranked.filter(id => relevant.has(id)).length;
    // k+1 is a conservative censored value when no relevant cohort is found.
    return found ? ranked.length / found : ranked.length + 1;
  }

  function normalizeCriterionState(row, field) {
    const raw = String(row?.[field] || "").toUpperCase();
    if (raw !== "UNKNOWN") return raw;
    const reasonField = field === "goldState" ? "goldUnknownReason" : "predictedUnknownReason";
    const reason = String(row?.[reasonField] || "").toUpperCase();
    if (reason === "TRIAL_SOURCE_AMBIGUOUS") return "AMBIGUOUS_TRIAL";
    if (reason === "CRITERION_NOT_REPRESENTABLE") return "NOT_MODELED";
    return "UNKNOWN_PATIENT";
  }

  function classificationMetrics(gold, predicted, positiveLabel) {
    let tp = 0; let fp = 0; let fn = 0; let tn = 0;
    const keys = new Set([...gold.keys(), ...predicted.keys()]);
    keys.forEach(key => {
      const actual = gold.get(key) === positiveLabel;
      const guess = predicted.get(key) === positiveLabel;
      if (actual && guess) tp += 1;
      else if (!actual && guess) fp += 1;
      else if (actual && !guess) fn += 1;
      else tn += 1;
    });
    const precision = safeDivide(tp, tp + fp);
    const sensitivity = safeDivide(tp, tp + fn);
    return {
      tp, fp, fn, tn,
      precision,
      sensitivity,
      specificity: safeDivide(tn, tn + fp),
      f1: precision == null || sensitivity == null || precision + sensitivity === 0 ? null : (2 * precision * sensitivity) / (precision + sensitivity)
    };
  }

  function calibrationMetrics(predictions, bins = 10) {
    const rows = (predictions || []).filter(item => Number.isFinite(item.probability) && [0, 1].includes(item.label));
    if (!rows.length) return { count: 0, brier: null, ece: null, note: "No calibrated relevance-probability output supplied." };
    const brier = mean(rows.map(item => (item.probability - item.label) ** 2));
    let ece = 0;
    for (let index = 0; index < bins; index += 1) {
      const low = index / bins;
      const high = (index + 1) / bins;
      const bucket = rows.filter(item => item.probability >= low && (index === bins - 1 ? item.probability <= high : item.probability < high));
      if (!bucket.length) continue;
      ece += (bucket.length / rows.length) * Math.abs(mean(bucket.map(item => item.probability)) - mean(bucket.map(item => item.label)));
    }
    return { count: rows.length, brier, ece, semantics: "relevance probability; never eligibility probability" };
  }

  function evaluateBenchmark(benchmark) {
    const cases = benchmark?.cases || [];
    const ks = [5, 10, 20, 50];
    const retrieval = {};
    ks.forEach(k => {
      retrieval[`macroRecallAt${k}`] = mean(cases.map(item => recallAtK(item, k)));
      retrieval[`macroPrecisionAt${k}`] = mean(cases.map(item => precisionAtK(item, k)));
    });
    retrieval.ndcgAt10 = mean(cases.map(item => ndcgAtK(item, 10)));
    retrieval.ndcgAt20 = mean(cases.map(item => ndcgAtK(item, 20)));
    retrieval.meanReciprocalRank = mean(cases.map(reciprocalRank));
    retrieval.numberNeededToReviewAt10 = mean(cases.map(item => numberNeededToReviewAtK(item, 10)));
    retrieval.numberNeededToReviewAt20 = mean(cases.map(item => numberNeededToReviewAtK(item, 20)));
    retrieval.numberNeededToReviewAt50 = mean(cases.map(item => numberNeededToReviewAtK(item, 50)));
    retrieval.numberNeededToReviewNote = "No-hit cases use a right-censored value of evaluated K + 1.";

    let candidateSuccesses = 0;
    let candidateOpportunities = 0;
    cases.forEach(item => {
      const relevant = relevantIds(item);
      const candidates = new Set(item.candidateCohortIds || item.rankedCohortIds || []);
      relevant.forEach(id => {
        candidateOpportunities += 1;
        if (candidates.has(id)) candidateSuccesses += 1;
      });
    });
    retrieval.candidateRecall = safeDivide(candidateSuccesses, candidateOpportunities);
    retrieval.candidateSensitivity = retrieval.candidateRecall;
    retrieval.candidateFalseNegativeRate = retrieval.candidateRecall == null ? null : 1 - retrieval.candidateRecall;
    retrieval.candidateRecall95 = wilsonInterval(candidateSuccesses, candidateOpportunities);
    retrieval.omittedRelevantCohorts = candidateOpportunities - candidateSuccesses;

    const criterionGold = new Map();
    const criterionPredicted = new Map();
    const criterionRows = [];
    cases.forEach(testCase => {
      (testCase.criteria || []).forEach(row => {
        const key = `${testCase.caseId}|${row.cohortId}|${row.criterionId}`;
        const normalizedRow = {
          ...row,
          goldState: normalizeCriterionState(row, "goldState"),
          predictedState: normalizeCriterionState(row, "predictedState")
        };
        criterionGold.set(key, normalizedRow.goldState);
        criterionPredicted.set(key, normalizedRow.predictedState);
        criterionRows.push(normalizedRow);
      });
    });
    const labels = ["SATISFIED", "VIOLATED", "UNKNOWN_PATIENT", "AMBIGUOUS_TRIAL", "NOT_MODELED", "NOT_APPLICABLE"];
    const byClass = Object.fromEntries(labels.map(label => [label, classificationMetrics(criterionGold, criterionPredicted, label)]));
    const macroF1 = mean(Object.values(byClass).map(item => item.f1));
    const criticalViolations = criterionRows.filter(row => row.critical === true && row.goldState === "VIOLATED");
    const criticalViolationSensitivity = safeDivide(criticalViolations.filter(row => row.predictedState === "VIOLATED").length, criticalViolations.length);
    const nonSatisfied = criterionRows.filter(row => row.goldState !== "SATISFIED");
    const criticalFalseSatisfactionRate = safeDivide(nonSatisfied.filter(row => row.critical === true && row.predictedState === "SATISFIED").length, nonSatisfied.filter(row => row.critical === true).length);
    const unsafeHard = criterionRows.filter(row => row.hardExcluded === true && row.hardExclusionGold !== true);
    const hardExclusionOpportunities = criterionRows.filter(row => row.hardExcluded === true || row.hardExclusionGold === true);
    const unsafeHardExclusionRate = safeDivide(unsafeHard.length, hardExclusionOpportunities.length);
    const unsafeHard95 = wilsonInterval(unsafeHard.length, hardExclusionOpportunities.length);

    const taggedAccuracy = tag => {
      const rows = criterionRows.filter(row => (row.tags || []).includes(tag));
      return safeDivide(rows.filter(row => row.goldState === row.predictedState).length, rows.length);
    };
    const taggedSensitivity = tag => {
      const rows = criterionRows.filter(row => (row.tags || []).includes(tag) && row.goldPositive === true);
      return safeDivide(rows.filter(row => row.predictedPositive === true).length, rows.length);
    };

    const priority = cases.flatMap(item => item.priorityResults || []);
    const priorityPrecision = safeDivide(priority.filter(item => item.goldRelevant === true).length, priority.length);
    const subgroupNames = Array.from(new Set(cases.flatMap(item => Object.entries(item.subgroups || {}).map(([key, value]) => `${key}:${value}`))));
    const subgroups = Object.fromEntries(subgroupNames.map(name => {
      const [key, value] = name.split(':');
      const rows = cases.filter(item => String(item.subgroups?.[key]) === value);
      return [name, { caseCount: rows.length, recallAt10: mean(rows.map(item => recallAtK(item, 10))), recallAt50: mean(rows.map(item => recallAtK(item, 50))) }];
    }));

    const calibrationRows = cases.flatMap(item => (item.rankedResults || []).filter(row => Number.isFinite(row.relevanceProbability)).map(row => ({
      probability: row.relevanceProbability,
      label: relevantIds(item).has(row.cohortId) ? 1 : 0
    })));

    const definitiveRows = criterionRows.filter(row => ["SATISFIED", "VIOLATED"].includes(row.predictedState));
    return {
      benchmarkVersion: benchmark?.benchmarkVersion || "unversioned",
      trialSnapshot: benchmark?.trialSnapshot || null,
      caseCount: cases.length,
      retrieval,
      criteria: {
        count: criterionRows.length,
        byClass,
        macroF1,
        criticalViolationSensitivity,
        criticalFalseSatisfactionRate,
        unsafeHardExclusionCount: unsafeHard.length,
        unsafeHardExclusionRate,
        unsafeHardExclusion95: unsafeHard95,
        numericThresholdAccuracy: taggedAccuracy("numeric"),
        temporalWindowAccuracy: taggedAccuracy("temporal"),
        negationSensitivity: taggedSensitivity("negation"),
        contradictionSensitivity: taggedSensitivity("contradiction"),
        cohortScopeAccuracy: taggedAccuracy("cohort_scope")
      },
      workflow: {
        priorityCount: priority.length,
        priorityPrecision,
        priorityCriticalNotModeled: priority.filter(item => item.hasCriticalNotModeled === true).length,
        priorityLowQuality: priority.filter(item => item.lowQualityTrial === true).length,
        sentinelFailures: Number(benchmark?.sentinelFailures || 0),
        interRaterAgreement: benchmark?.interRaterAgreement ?? null,
        maximumRegistryIngestionHours: benchmark?.maximumRegistryIngestionHours ?? null
      },
      coverage: {
        supported: safeDivide(definitiveRows.length, criterionRows.length),
        abstention: safeDivide(criterionRows.filter(row => ["UNKNOWN_PATIENT", "AMBIGUOUS_TRIAL", "NOT_MODELED"].includes(row.predictedState)).length, criterionRows.length),
        selectiveErrorRate: safeDivide(definitiveRows.filter(row => row.goldState !== row.predictedState).length, definitiveRows.length),
        note: "Selective error is measured only where the system did not abstain."
      },
      subgroups,
      calibration: calibrationMetrics(calibrationRows)
    };
  }

  function assessGoNo(metrics, thresholds = DEFAULT_THRESHOLDS) {
    const checks = [];
    const check = (name, value, threshold, comparison, evaluable = value != null) => {
      const passed = !evaluable
        ? false
        : comparison === "min" ? value >= threshold : comparison === "lt" ? value < threshold : value <= threshold;
      checks.push({ name, value, threshold, comparison, evaluable, passed });
    };
    check("macro Recall@50", metrics.retrieval.macroRecallAt50, thresholds.macroRecallAt50, "min");
    check("candidate recall lower 95% CI", metrics.retrieval.candidateRecall95.lower, thresholds.candidateRecallLower95, "min");
    check("Recall@10", metrics.retrieval.macroRecallAt10, thresholds.recallAt10, "min");
    const reportedSubgroups = Object.values(metrics.subgroups || {});
    check("minimum reported subgroup Recall@10", reportedSubgroups.length ? Math.min(...reportedSubgroups.map(item => item.recallAt10 ?? -1)) : null, thresholds.subgroupRecallAt10, "min");
    check("unsafe hard-exclusion rate", metrics.criteria.unsafeHardExclusionRate, thresholds.unsafeHardExclusionRate, "max");
    check("unsafe hard-exclusion upper 95% CI", metrics.criteria.unsafeHardExclusion95.upper, thresholds.unsafeHardExclusionUpper95, "lt");
    check("critical violation sensitivity", metrics.criteria.criticalViolationSensitivity, thresholds.criticalViolationSensitivity, "min");
    check("critical false-satisfaction rate", metrics.criteria.criticalFalseSatisfactionRate, thresholds.criticalFalseSatisfactionRate, "max");
    check("negation sensitivity", metrics.criteria.negationSensitivity, thresholds.negationSensitivity, "min");
    check("temporal-window accuracy", metrics.criteria.temporalWindowAccuracy, thresholds.temporalWindowAccuracy, "min");
    check("contradiction sensitivity", metrics.criteria.contradictionSensitivity, thresholds.contradictionSensitivity, "min");
    check("priority precision", metrics.workflow.priorityPrecision, thresholds.priorityPrecision, "min");
    check("priority critical NOT_MODELED", metrics.workflow.priorityCriticalNotModeled, thresholds.priorityCriticalNotModeled, "max");
    check("priority low-quality records", metrics.workflow.priorityLowQuality, thresholds.priorityLowQuality, "max");
    check("inter-rater agreement", metrics.workflow.interRaterAgreement, thresholds.interRaterAgreement, "min");
    check("sentinel failures", metrics.workflow.sentinelFailures, thresholds.sentinelFailures, "max");
    check("registry ingestion hours", metrics.workflow.maximumRegistryIngestionHours, thresholds.maximumRegistryIngestionHours, "max");
    const failed = checks.filter(item => !item.passed);
    return {
      decision: failed.length ? "NO_GO" : "GO",
      checks,
      automaticNoGoReasons: failed.map(item => item.evaluable ? `${item.name} missed threshold` : `${item.name} was not evaluable`)
    };
  }

  const api = { DEFAULT_THRESHOLDS, wilsonInterval, recallAtK, precisionAtK, ndcgAtK, numberNeededToReviewAtK, normalizeCriterionState, calibrationMetrics, evaluateBenchmark, assessGoNo };
  global.BenchmarkRunner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof require === "function" && require.main === module) {
    const inputPath = process.argv[2];
    if (!inputPath) {
      console.error("Usage: node validation/benchmark-runner.js <benchmark.json>");
      process.exitCode = 2;
    } else {
      const benchmark = JSON.parse(fs.readFileSync(inputPath, "utf8"));
      const metrics = evaluateBenchmark(benchmark);
      const goNo = assessGoNo(metrics);
      console.log(JSON.stringify({ metrics, goNo }, null, 2));
      if (goNo.decision !== "GO") process.exitCode = 1;
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
