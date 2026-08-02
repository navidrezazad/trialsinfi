#!/usr/bin/env node
(function (global) {
  "use strict";
  const fs = typeof require === "function" ? require("node:fs") : null;
  const RELEVANCE_ORDER = Object.freeze(["NOT_RELEVANT", "INDETERMINATE_TRIAL_DATA", "PLAUSIBLE", "PRIORITY_REVIEW"]);

  function safeDivide(numerator, denominator) { return denominator ? numerator / denominator : null; }
  function completePairs(rows) { return rows.filter(row => row.a != null && row.b != null && row.a !== "UNLABELED" && row.b !== "UNLABELED"); }

  function percentAgreement(rows) {
    const pairs = completePairs(rows);
    return { count: pairs.length, value: safeDivide(pairs.filter(row => row.a === row.b).length, pairs.length) };
  }

  function quadraticWeightedKappa(rows, orderedLabels = RELEVANCE_ORDER) {
    const pairs = completePairs(rows).filter(row => orderedLabels.includes(row.a) && orderedLabels.includes(row.b));
    if (!pairs.length) return null;
    const index = new Map(orderedLabels.map((label, position) => [label, position]));
    const denominator = Math.max(1, orderedLabels.length - 1) ** 2;
    const weight = (left, right) => 1 - ((index.get(left) - index.get(right)) ** 2) / denominator;
    const observed = pairs.reduce((sum, row) => sum + weight(row.a, row.b), 0) / pairs.length;
    const countsA = new Map(orderedLabels.map(label => [label, 0]));
    const countsB = new Map(orderedLabels.map(label => [label, 0]));
    pairs.forEach(row => { countsA.set(row.a, countsA.get(row.a) + 1); countsB.set(row.b, countsB.get(row.b) + 1); });
    let expected = 0;
    orderedLabels.forEach(left => orderedLabels.forEach(right => {
      expected += (countsA.get(left) / pairs.length) * (countsB.get(right) / pairs.length) * weight(left, right);
    }));
    return expected === 1 ? (observed === 1 ? 1 : null) : (observed - expected) / (1 - expected);
  }

  function gwetAc1(rows) {
    const pairs = completePairs(rows);
    if (!pairs.length) return null;
    const labels = Array.from(new Set(pairs.flatMap(row => [row.a, row.b])));
    if (labels.length <= 1) return 1;
    const observed = pairs.filter(row => row.a === row.b).length / pairs.length;
    const chance = labels.reduce((sum, label) => {
      const left = pairs.filter(row => row.a === label).length / pairs.length;
      const right = pairs.filter(row => row.b === label).length / pairs.length;
      const pooled = (left + right) / 2;
      return sum + pooled * (1 - pooled);
    }, 0) / (labels.length - 1);
    return chance === 1 ? (observed === 1 ? 1 : null) : (observed - chance) / (1 - chance);
  }

  function krippendorffAlphaNominal(rows) {
    const pairs = completePairs(rows);
    if (!pairs.length) return null;
    const observedDisagreement = pairs.filter(row => row.a !== row.b).length / pairs.length;
    const values = pairs.flatMap(row => [row.a, row.b]);
    if (values.length < 2) return null;
    const counts = new Map();
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    const total = values.length;
    const expectedDisagreement = Array.from(counts.values())
      .reduce((sum, count) => sum + count * (total - count), 0) / (total * (total - 1));
    return expectedDisagreement === 0 ? (observedDisagreement === 0 ? 1 : null) : 1 - observedDisagreement / expectedDisagreement;
  }

  function criterionState(row) {
    return String(row?.state || row?.goldState || row?.label || "").toUpperCase() || null;
  }

  function fromMergedArtifact(artifact) {
    const annotations = Object.values(artifact?.annotations || {});
    const relevanceRows = annotations.map(item => ({
      id: `${item.caseId}|${item.cohortId}`,
      a: item.reviewerA?.relevance,
      b: item.reviewerB?.relevance
    }));
    const criterionRows = [];
    annotations.forEach(item => {
      const left = new Map((item.reviewerA?.criteria || []).map(row => [row.criterionId, criterionState(row)]));
      const right = new Map((item.reviewerB?.criteria || []).map(row => [row.criterionId, criterionState(row)]));
      new Set([...left.keys(), ...right.keys()]).forEach(criterionId => {
        criterionRows.push({ id: `${item.caseId}|${item.cohortId}|${criterionId}`, a: left.get(criterionId), b: right.get(criterionId) });
      });
    });
    const summarize = (rows, ordered) => ({
      ...percentAgreement(rows),
      quadraticWeightedKappa: ordered ? quadraticWeightedKappa(rows, ordered) : null,
      gwetAc1: gwetAc1(rows),
      krippendorffAlphaNominal: krippendorffAlphaNominal(rows),
      missingPairs: rows.filter(row => row.a == null || row.b == null).length
    });
    return {
      benchmarkVersion: artifact?.benchmarkVersion || "unversioned",
      trialSnapshot: artifact?.trialSnapshot || null,
      relevance: summarize(relevanceRows, RELEVANCE_ORDER),
      criteria: summarize(criterionRows, null),
      interpretation: {
        relevanceOrder: RELEVANCE_ORDER,
        primaryAgreementTarget: 0.80,
        refineBelow: 0.70,
        note: "Agreement is descriptive; disagreements still require independent adjudication."
      }
    };
  }

  const api = { RELEVANCE_ORDER, percentAgreement, quadraticWeightedKappa, gwetAc1, krippendorffAlphaNominal, fromMergedArtifact };
  global.AnnotationAgreement = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof require === "function" && require.main === module) {
    const inputPath = process.argv[2];
    if (!inputPath) {
      console.error("Usage: node validation/annotation-agreement.js <merged-annotations.json>");
      process.exitCode = 2;
    } else {
      try {
        console.log(JSON.stringify(fromMergedArtifact(JSON.parse(fs.readFileSync(inputPath, "utf8"))), null, 2));
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
