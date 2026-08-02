#!/usr/bin/env node
(function (global) {
  "use strict";
  const fs = typeof require === "function" ? require("node:fs") : null;

  function pairKey(pair) { return `${pair.caseId}|${pair.cohortId}`; }
  function requireValue(condition, message) { if (!condition) throw new Error(message); }

  function mergeIndependentReviews(benchmark, reviewerAArtifact, reviewerBArtifact) {
    requireValue(benchmark?.benchmarkVersion && Array.isArray(benchmark?.worklist), "Benchmark requires benchmarkVersion and worklist[].");
    const artifacts = [reviewerAArtifact, reviewerBArtifact];
    const expectedRoles = ["reviewerA", "reviewerB"];
    artifacts.forEach((artifact, index) => {
      requireValue(artifact?.artifactType === "independent_review", `${expectedRoles[index]} artifactType must be independent_review.`);
      requireValue(artifact?.role === expectedRoles[index], `Expected role ${expectedRoles[index]}.`);
      requireValue(artifact?.benchmarkVersion === benchmark.benchmarkVersion, "Benchmark versions do not match.");
      requireValue(artifact?.trialSnapshot === benchmark.trialSnapshot, "Trial snapshots do not match.");
      requireValue(artifact?.annotationManualVersion === benchmark.annotationManualVersion, "Annotation manual versions do not match.");
      requireValue(artifact?.reviewerId, `${expectedRoles[index]} reviewerId is required.`);
    });
    requireValue(reviewerAArtifact.reviewerId !== reviewerBArtifact.reviewerId, "Independent reviewer IDs must differ.");

    const merged = {};
    benchmark.worklist.forEach(pair => {
      const key = pairKey(pair);
      const left = reviewerAArtifact.annotations?.[key];
      const right = reviewerBArtifact.annotations?.[key];
      requireValue(left?.reviewerA, `Reviewer A is missing ${key}.`);
      requireValue(right?.reviewerB, `Reviewer B is missing ${key}.`);
      requireValue(left.reviewerA.relevance && left.reviewerA.relevance !== "UNLABELED", `Reviewer A left ${key} unlabeled.`);
      requireValue(right.reviewerB.relevance && right.reviewerB.relevance !== "UNLABELED", `Reviewer B left ${key} unlabeled.`);
      requireValue(left.caseId === pair.caseId && left.cohortId === pair.cohortId, `Reviewer A pair identity mismatch for ${key}.`);
      requireValue(right.caseId === pair.caseId && right.cohortId === pair.cohortId, `Reviewer B pair identity mismatch for ${key}.`);
      merged[key] = {
        caseId: pair.caseId,
        cohortId: pair.cohortId,
        reviewerA: left.reviewerA,
        reviewerB: right.reviewerB,
        annotationManualVersion: benchmark.annotationManualVersion
      };
    });

    return {
      ...benchmark,
      annotations: merged,
      annotationMerge: {
        mergedAt: new Date().toISOString(),
        reviewerAId: reviewerAArtifact.reviewerId,
        reviewerBId: reviewerBArtifact.reviewerId,
        pairCount: benchmark.worklist.length,
        blindedIndependentReview: true
      }
    };
  }

  const api = { mergeIndependentReviews };
  global.AnnotationMerge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof require === "function" && require.main === module) {
    const [benchmarkPath, reviewerAPath, reviewerBPath, outputPath] = process.argv.slice(2);
    if (!benchmarkPath || !reviewerAPath || !reviewerBPath || !outputPath) {
      console.error("Usage: node validation/merge-annotations.js <benchmark.json> <reviewer-a.json> <reviewer-b.json> <merged.json>");
      process.exitCode = 2;
    } else {
      try {
        const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
        const merged = mergeIndependentReviews(read(benchmarkPath), read(reviewerAPath), read(reviewerBPath));
        fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
        console.log(JSON.stringify({ output: outputPath, pairCount: merged.annotationMerge.pairCount }, null, 2));
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
