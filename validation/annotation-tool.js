(function () {
  "use strict";
  const LABELS = ["UNLABELED", "PRIORITY_REVIEW", "PLAUSIBLE", "NOT_RELEVANT", "INDETERMINATE_TRIAL_DATA"];
  const state = { benchmark: null, worklist: [], index: 0, annotations: {}, role: "reviewerA" };
  const byId = id => document.getElementById(id);
  const roleField = { reviewerA: "reviewerA", reviewerB: "reviewerB", adjudicator: "adjudication" };

  ["reviewerA", "reviewerB", "adjudicated"].forEach(id => {
    byId(id).innerHTML = LABELS.map(label => `<option value="${label}">${label.replace(/_/g, " ")}</option>`).join("");
    byId(id).addEventListener("change", updateAgreement);
  });

  function pairKey(pair) { return `${pair.caseId}|${pair.cohortId}`; }
  function parseJsonArray(text, label) {
    const value = JSON.parse(text || "[]");
    if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array.`);
    return value;
  }
  function currentPair() { return state.worklist[state.index]; }
  function reviewerId() {
    const value = byId("reviewerId").value.trim();
    if (!value) throw new Error("Enter a pseudonymous reviewer ID before saving or exporting.");
    return value;
  }

  function updateRoleVisibility() {
    state.role = byId("annotationRole").value;
    byId("reviewerAPanel").hidden = state.role !== "reviewerA";
    byId("reviewerBPanel").hidden = state.role !== "reviewerB";
    byId("adjudicationPanel").hidden = state.role !== "adjudicator";
    const adjudicating = state.role === "adjudicator";
    byId("reviewerA").disabled = adjudicating;
    byId("criteriaA").readOnly = adjudicating;
    byId("reviewerB").disabled = adjudicating;
    byId("criteriaB").readOnly = adjudicating;
    if (state.benchmark) render();
  }

  function updateAgreement() {
    const a = byId("reviewerA").value;
    const b = byId("reviewerB").value;
    const complete = a !== "UNLABELED" && b !== "UNLABELED";
    byId("agreementState").className = complete && a === b ? "agreement" : complete ? "disagreement" : "";
    byId("agreementState").textContent = !complete
      ? "Two independent labels are required before adjudication."
      : a === b ? "Independent reviewers agree; adjudicator still confirms the final label." : "Disagreement requires adjudication.";
  }

  function saveCurrent() {
    const pair = currentPair();
    if (!pair) return;
    const id = reviewerId();
    const key = pairKey(pair);
    const existing = state.annotations[key] || { caseId: pair.caseId, cohortId: pair.cohortId };
    if (state.role === "reviewerA") {
      if (byId("reviewerA").value === "UNLABELED") throw new Error("Select a Reviewer A relevance label before saving.");
      existing.reviewerA = {
        reviewerId: id,
        relevance: byId("reviewerA").value,
        criteria: parseJsonArray(byId("criteriaA").value, "Reviewer A criteria"),
        savedAt: new Date().toISOString()
      };
    } else if (state.role === "reviewerB") {
      if (byId("reviewerB").value === "UNLABELED") throw new Error("Select a Reviewer B relevance label before saving.");
      existing.reviewerB = {
        reviewerId: id,
        relevance: byId("reviewerB").value,
        criteria: parseJsonArray(byId("criteriaB").value, "Reviewer B criteria"),
        savedAt: new Date().toISOString()
      };
    } else {
      if (!existing.reviewerA || !existing.reviewerB) throw new Error("Adjudication requires imported Reviewer A and Reviewer B artifacts.");
      if (existing.reviewerA.reviewerId === existing.reviewerB.reviewerId) throw new Error("Independent reviewer IDs must differ.");
      if ([existing.reviewerA.reviewerId, existing.reviewerB.reviewerId].includes(id)) throw new Error("The adjudicator must be independent from both reviewers.");
      existing.adjudication = {
        reviewerId: id,
        relevance: byId("adjudicated").value,
        rationale: byId("rationale").value.trim(),
        criteria: parseJsonArray(byId("criteriaFinal").value, "Final criteria"),
        savedAt: new Date().toISOString()
      };
      if (existing.adjudication.relevance === "UNLABELED") throw new Error("Select an adjudicated relevance label.");
      if (!existing.adjudication.rationale) throw new Error("Adjudication rationale is required.");
    }
    existing.annotationManualVersion = state.benchmark.annotationManualVersion || "unversioned";
    state.annotations[key] = existing;
    render();
  }

  function render() {
    const pair = currentPair();
    if (!pair) return;
    byId("pairSelect").value = String(state.index);
    byId("pairTitle").textContent = `${pair.caseId} · ${pair.cohortId} · ${state.index + 1}/${state.worklist.length}`;
    byId("patientText").textContent = pair.patientText || "Patient text intentionally unavailable";
    byId("protocolText").textContent = pair.protocolText || "Protocol text unavailable";
    const saved = state.annotations[pairKey(pair)] || {};
    byId("reviewerA").value = saved.reviewerA?.relevance || "UNLABELED";
    byId("reviewerB").value = saved.reviewerB?.relevance || "UNLABELED";
    byId("adjudicated").value = saved.adjudication?.relevance || "UNLABELED";
    byId("criteriaA").value = JSON.stringify(saved.reviewerA?.criteria || [], null, 2);
    byId("criteriaB").value = JSON.stringify(saved.reviewerB?.criteria || [], null, 2);
    byId("criteriaFinal").value = JSON.stringify(saved.adjudication?.criteria || [], null, 2);
    byId("rationale").value = saved.adjudication?.rationale || "";
    byId("previousPair").disabled = state.index === 0;
    byId("nextPair").disabled = state.index >= state.worklist.length - 1;
    updateAgreement();
  }

  byId("annotationRole").addEventListener("change", updateRoleVisibility);
  byId("benchmarkFile").addEventListener("change", async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const benchmark = JSON.parse(await file.text());
      if (!benchmark.benchmarkVersion || !Array.isArray(benchmark.worklist)) throw new Error("Benchmark requires benchmarkVersion and worklist[].");
      if (benchmark.worklist.length === 0) throw new Error("Benchmark worklist must contain at least one case/cohort pair.");
      const seenPairs = new Set();
      benchmark.worklist.forEach(pair => {
        if (!pair?.caseId || !pair?.cohortId || !String(pair.patientText || "").trim() || !String(pair.protocolText || "").trim()) {
          throw new Error("Every worklist row requires caseId, cohortId, patientText, and protocolText.");
        }
        const key = pairKey(pair);
        if (seenPairs.has(key)) throw new Error(`Duplicate case/cohort pair: ${key}.`);
        seenPairs.add(key);
      });
      const importedAnnotations = benchmark.annotations || {};
      if (state.role !== "adjudicator" && Object.keys(importedAnnotations).length > 0) {
        throw new Error("Independent review requires the original clean worklist without any reviewer annotations.");
      }
      if (state.role === "adjudicator") {
        benchmark.worklist.forEach(pair => {
          const annotation = importedAnnotations[pairKey(pair)];
          if (!annotation?.reviewerA || !annotation?.reviewerB) throw new Error(`Adjudication input is missing two locked reviews for ${pairKey(pair)}.`);
          if (annotation.reviewerA.reviewerId === annotation.reviewerB.reviewerId) throw new Error(`Independent reviewer IDs must differ for ${pairKey(pair)}.`);
          if ([annotation.reviewerA.relevance, annotation.reviewerB.relevance].includes("UNLABELED")) throw new Error(`Adjudication input contains an unlabeled review for ${pairKey(pair)}.`);
        });
      }
      state.benchmark = benchmark;
      state.worklist = benchmark.worklist;
      state.index = 0;
      state.annotations = importedAnnotations;
      byId("annotationRole").disabled = true;
      byId("pairSelect").innerHTML = state.worklist.map((pair, index) => `<option value="${index}">${pair.caseId} · ${pair.cohortId}</option>`).join("");
      ["pairSelect", "nextPair", "exportAnnotations", "savePair"].forEach(id => { byId(id).disabled = false; });
      render();
    } catch (error) {
      alert(`Benchmark rejected: ${error.message}`);
      event.target.value = "";
    }
  });
  byId("pairSelect").addEventListener("change", event => { state.index = Number(event.target.value); render(); });
  byId("previousPair").addEventListener("click", () => { try { saveCurrent(); state.index = Math.max(0, state.index - 1); render(); } catch (error) { alert(error.message); } });
  byId("nextPair").addEventListener("click", () => { try { saveCurrent(); state.index = Math.min(state.worklist.length - 1, state.index + 1); render(); } catch (error) { alert(error.message); } });
  byId("savePair").addEventListener("click", () => { try { saveCurrent(); } catch (error) { alert(error.message); } });
  byId("exportAnnotations").addEventListener("click", () => {
    try {
      saveCurrent();
      const field = roleField[state.role];
      const selected = Object.fromEntries(Object.entries(state.annotations).flatMap(([key, value]) => {
        const annotation = value[field];
        return annotation ? [[key, { caseId: value.caseId, cohortId: value.cohortId, [field]: annotation, annotationManualVersion: value.annotationManualVersion }]] : [];
      }));
      const payload = {
        artifactType: state.role === "adjudicator" ? "adjudication" : "independent_review",
        role: state.role,
        reviewerId: reviewerId(),
        benchmarkVersion: state.benchmark.benchmarkVersion,
        trialSnapshot: state.benchmark.trialSnapshot,
        annotationManualVersion: state.benchmark.annotationManualVersion,
        exportedAt: new Date().toISOString(),
        annotations: selected
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${state.benchmark.benchmarkVersion}-${state.role}-annotations.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { alert(error.message); }
  });

  updateRoleVisibility();
})();
