(function (global) {
  "use strict";

  const schemaApi = global.ClinicalTrialSchema || (typeof require === "function" ? require("./clinical-trial-schema.js") : null);

  const ALLOWED_TASKS = Object.freeze({
    CRITERION_EXTRACTION: "criterion_extraction",
    COHORT_SEGMENTATION: "cohort_segmentation",
    DENSE_RETRIEVAL: "dense_retrieval",
    RELEVANCE_RERANKING: "relevance_reranking"
  });

  function requireGuardedProvider(options, task) {
    if (options?.enabled !== true) throw new Error(`${task} is disabled until an approved provider and validation artifact are configured.`);
    if (typeof options?.provider !== "function") throw new Error(`${task} requires an injected provider function.`);
    if (!options?.modelVersion) throw new Error(`${task} requires an immutable modelVersion.`);
    if (!options?.validationVersion) throw new Error(`${task} requires a held-out validationVersion.`);
  }

  async function proposeCriteria(options) {
    requireGuardedProvider(options, ALLOWED_TASKS.CRITERION_EXTRACTION);
    const sourceText = String(options.sourceText || "");
    const raw = await options.provider({
      task: ALLOWED_TASKS.CRITERION_EXTRACTION,
      sourceText,
      schemaVersion: schemaApi?.SCHEMA_VERSION,
      modelVersion: options.modelVersion
    });
    const proposals = Array.isArray(raw) ? raw : [];
    return proposals.map((proposal, index) => {
      const normalized = { ...proposal, modelVersion: proposal.modelVersion || options.modelVersion };
      const validation = schemaApi.validateModelProposal(normalized, sourceText);
      return {
        proposalId: `criterion-proposal-${index + 1}`,
        task: ALLOWED_TASKS.CRITERION_EXTRACTION,
        proposal: normalized,
        valid: validation.valid,
        errors: validation.errors,
        disposition: validation.valid ? "requires_clinician_review" : "rejected_by_contract",
        mayAffectEligibility: false,
        mayHardExclude: false,
        validationVersion: options.validationVersion
      };
    });
  }

  function validateCohortProposal(proposal, sourceText) {
    const errors = [];
    const span = proposal?.sourceSpan || {};
    if (!proposal?.label || typeof proposal.label !== "string") errors.push("label is required");
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start) {
      errors.push("valid integer source offsets are required");
    } else if (String(sourceText || "").slice(span.start, span.end) !== span.text) {
      errors.push("sourceSpan.text does not match source offsets");
    }
    if (!Number.isFinite(proposal?.confidence) || proposal.confidence < 0 || proposal.confidence > 1) errors.push("confidence must be between 0 and 1");
    if (!Array.isArray(proposal?.criterionIds)) errors.push("criterionIds must be an array");
    if (!Array.isArray(proposal?.ambiguities)) errors.push("ambiguities must be an array");
    if (proposal?.reviewedBy || proposal?.reviewedAt || proposal?.autoApply === true) errors.push("model proposals cannot claim review or automatic application");
    return { valid: errors.length === 0, errors };
  }

  async function proposeCohorts(options) {
    requireGuardedProvider(options, ALLOWED_TASKS.COHORT_SEGMENTATION);
    const sourceText = String(options.sourceText || "");
    const raw = await options.provider({
      task: ALLOWED_TASKS.COHORT_SEGMENTATION,
      sourceText,
      criterionIds: options.criterionIds || [],
      schemaVersion: schemaApi?.SCHEMA_VERSION,
      modelVersion: options.modelVersion
    });
    return (Array.isArray(raw) ? raw : []).map((proposal, index) => {
      const normalized = { ...proposal, modelVersion: proposal.modelVersion || options.modelVersion };
      const validation = validateCohortProposal(normalized, sourceText);
      return {
        proposalId: `cohort-proposal-${index + 1}`,
        task: ALLOWED_TASKS.COHORT_SEGMENTATION,
        proposal: normalized,
        valid: validation.valid,
        errors: validation.errors,
        disposition: validation.valid ? "requires_curator_review" : "rejected_by_contract",
        autoApplied: false,
        validationVersion: options.validationVersion
      };
    });
  }

  function buildActiveLearningQueue(records, limit) {
    const allowed = (Array.isArray(records) ? records : []).filter(record => {
      return record && !record.rawQuery && !record.sourceText && !record.patientFacts && !record.patientNarrative;
    });
    return allowed
      .map(record => ({
        recordId: String(record.recordId || ""),
        cancerType: String(record.cancerType || "unknown"),
        errorCategory: String(record.errorCategory || "unclassified"),
        uncertainty: Math.max(0, Math.min(1, Number(record.uncertainty || 0))),
        overrideCount: Math.max(0, Number(record.overrideCount || 0)),
        abstentionCount: Math.max(0, Number(record.abstentionCount || 0)),
        requiresExpertApproval: true
      }))
      .sort((a, b) => (b.uncertainty + Math.min(1, b.overrideCount / 5)) - (a.uncertainty + Math.min(1, a.overrideCount / 5)))
      .slice(0, Number(limit || 50));
  }

  const api = {
    ALLOWED_TASKS,
    proposeCriteria,
    validateCohortProposal,
    proposeCohorts,
    buildActiveLearningQueue
  };
  global.ModelAssistedPrescreen = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
