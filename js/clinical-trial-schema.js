(function (global) {
  "use strict";

  const vocabularyApi = global.ClinicalVocabulary || (typeof require === "function" ? require("./clinical-vocabulary.js") : null);
  const SCHEMA_VERSION = vocabularyApi?.schemaVersion || "1.0.0";

  const CRITERION_STATES = Object.freeze({
    SATISFIED: "SATISFIED",
    VIOLATED: "VIOLATED",
    UNKNOWN: "UNKNOWN",
    NOT_MODELED: "NOT_MODELED",
    NOT_APPLICABLE: "NOT_APPLICABLE"
  });

  const UNKNOWN_REASONS = Object.freeze({
    PATIENT_FACT_MISSING: "PATIENT_FACT_MISSING",
    PATIENT_FACT_UNCONFIRMED: "PATIENT_FACT_UNCONFIRMED",
    PATIENT_FACT_UNCERTAIN: "PATIENT_FACT_UNCERTAIN",
    PATIENT_FACT_CONTRADICTORY: "PATIENT_FACT_CONTRADICTORY",
    PATIENT_FACT_STALE: "PATIENT_FACT_STALE",
    EVENT_DATE_MISSING: "EVENT_DATE_MISSING",
    ASSAY_SPECIFICITY_MISSING: "ASSAY_SPECIFICITY_MISSING",
    TRIAL_SOURCE_AMBIGUOUS: "TRIAL_SOURCE_AMBIGUOUS",
    SITE_STATUS_STALE: "SITE_STATUS_STALE",
    CRITERION_NOT_REPRESENTABLE: "CRITERION_NOT_REPRESENTABLE"
  });

  const REVIEW_TIERS = Object.freeze({
    PRIORITY_PROTOCOL_REVIEW: "PRIORITY_PROTOCOL_REVIEW",
    POTENTIALLY_RELEVANT: "POTENTIALLY_RELEVANT",
    MANUAL_REVIEW_TRIAL_DATA: "MANUAL_REVIEW_TRIAL_DATA",
    MODELED_CONFLICT: "MODELED_CONFLICT",
    DISEASE_CONTEXT_RETRIEVAL: "DISEASE_CONTEXT_RETRIEVAL"
  });

  const REVIEW_TIER_LABELS = Object.freeze({
    [REVIEW_TIERS.PRIORITY_PROTOCOL_REVIEW]: "Priority for protocol review",
    [REVIEW_TIERS.POTENTIALLY_RELEVANT]: "Potentially relevant — clarify patient evidence",
    [REVIEW_TIERS.MANUAL_REVIEW_TRIAL_DATA]: "Manual review — trial data incomplete",
    [REVIEW_TIERS.MODELED_CONFLICT]: "Modeled conflict",
    [REVIEW_TIERS.DISEASE_CONTEXT_RETRIEVAL]: "Disease-context retrieval only"
  });

  const CANONICAL_ALIASES = Object.freeze({ ...(vocabularyApi?.globalAliases || {}) });
  const AXIS_VALUE_ALIASES = Object.freeze(Object.fromEntries(
    Object.entries(vocabularyApi?.axisValueAliases || {}).map(([axis, aliases]) => [
      axis.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
      Object.freeze({ ...aliases })
    ])
  ));

  function normalizeWhitespace(value) {
    return (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
  }

  function canonicalToken(value) {
    return normalizeWhitespace(value)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function normalizeEnum(value) {
    const token = canonicalToken(value);
    return CANONICAL_ALIASES[token] || token;
  }

  function normalizeAxisValue(axis, value) {
    const axisToken = canonicalToken(axis);
    const valueToken = canonicalToken(value);
    return AXIS_VALUE_ALIASES[axisToken]?.[valueToken] || CANONICAL_ALIASES[valueToken] || valueToken;
  }

  function stableId(prefix, parts) {
    const value = [prefix].concat(parts || [])
      .map(canonicalToken)
      .filter(Boolean)
      .join("-")
      .slice(0, 120);
    return value || `${prefix}-unknown`;
  }

  function makeSourceSpan(text, start, end, field) {
    const safeText = text == null ? "" : String(text);
    const safeStart = Number.isInteger(start) && start >= 0 ? start : 0;
    const safeEnd = Number.isInteger(end) && end >= safeStart ? end : safeStart + safeText.length;
    return {
      field: field || "patientNarrative",
      text: safeText,
      start: safeStart,
      end: safeEnd
    };
  }

  function createPatientFact(options) {
    const sourceSpan = options?.sourceSpan || makeSourceSpan(options?.sourceText || "", 0, null);
    const conceptId = normalizeEnum(options?.concept?.code || options?.conceptId || options?.concept || "unknown");
    const predicate = normalizeEnum(options?.predicate || "has");
    return {
      schemaVersion: SCHEMA_VERSION,
      factId: options?.factId || stableId("pf", [conceptId, predicate, sourceSpan.start, sourceSpan.end]),
      concept: typeof options?.concept === "object"
        ? { ...options.concept, code: conceptId }
        : { system: options?.system || "local", code: conceptId, display: options?.display || normalizeWhitespace(options?.concept || conceptId) },
      predicate,
      value: typeof options?.value === "string" ? normalizeAxisValue(conceptId, options.value) : (options?.value ?? true),
      unit: options?.unit || null,
      observedAt: options?.observedAt || null,
      validAt: options?.validAt || null,
      normalization: options?.normalization || null,
      assertion: normalizeEnum(options?.assertion || "present"),
      status: normalizeEnum(options?.status || "current"),
      temporality: options?.temporality || { eventTime: null, relativeTo: "screening" },
      experiencer: normalizeEnum(options?.experiencer || "patient"),
      sourceSpan,
      sourceType: normalizeEnum(options?.sourceType || "user_narrative"),
      extractor: options?.extractor || { type: "rule", version: "unknown" },
      extractionConfidence: Number.isFinite(options?.extractionConfidence) ? options.extractionConfidence : null,
      confirmation: normalizeEnum(options?.confirmation || "unreviewed"),
      supersedes: options?.supersedes || null,
      enteredAt: options?.enteredAt || null,
      validAt: options?.validAt || null
    };
  }

  function propositionKey(fact) {
    return [
      fact?.concept?.code || fact?.conceptId || "",
      fact?.predicate || "",
      // Event identity belongs in the proposition; different drugs are not
      // mutually exclusive scalar values. Measurements retain specimen/time.
      ["systemic_therapy", "treatment_exposure"].includes(normalizeEnum(fact?.concept?.code)) ? fact?.value : "",
      fact?.observedAt || fact?.temporality?.eventTime || "",
      fact?.experiencer || "patient"
    ].map(normalizeEnum).join("|");
  }

  function factPolarity(fact) {
    const assertion = normalizeEnum(fact?.assertion);
    if (["absent", "negative", "false", "ruled_out"].includes(assertion)) return "negative";
    if (["present", "positive", "true", "confirmed"].includes(assertion)) return "positive";
    return "uncertain";
  }

  function detectContradictions(facts) {
    const support = new Map();
    (Array.isArray(facts) ? facts : []).forEach(fact => {
      if (normalizeEnum(fact?.confirmation) === "rejected") return;
      const key = propositionKey(fact);
      if (!support.has(key)) support.set(key, { positive: [], negative: [], uncertain: [] });
      support.get(key)[factPolarity(fact)].push(fact);
    });
    return Array.from(support.entries())
      .filter(([, values]) => values.positive.length > 0 && values.negative.length > 0)
      .map(([key, values]) => ({
        contradictionId: stableId("contradiction", [key]),
        proposition: key,
        positiveFactIds: values.positive.map(fact => fact.factId),
        negativeFactIds: values.negative.map(fact => fact.factId),
        status: "requires_confirmation"
      }));
  }

  function isFactConfirmed(fact) {
    return ["confirmed", "corrected"].includes(normalizeEnum(fact?.confirmation));
  }

  function confirmedFacts(facts) {
    return (Array.isArray(facts) ? facts : []).filter(isFactConfirmed);
  }

  function compareValues(actual, operator, expected) {
    if (actual == null || expected == null || actual === '' || expected === '') return null;
    const op = normalizeEnum(operator || "eq").toUpperCase();
    const actualCanonical = typeof actual === "string" ? normalizeEnum(actual) : actual;
    const expectedCanonical = typeof expected === "string" ? normalizeEnum(expected) : expected;
    if (op === "EQ") return actualCanonical === expectedCanonical;
    if (op === "NE") return actualCanonical !== expectedCanonical;
    if (op === "IN") return (Array.isArray(expected) ? expected : [expected]).map(normalizeEnum).includes(normalizeEnum(actual));
    if (op === "NOT_IN") return !(Array.isArray(expected) ? expected : [expected]).map(normalizeEnum).includes(normalizeEnum(actual));
    const actualNumber = Number(actual);
    const expectedNumber = Number(expected);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return null;
    if (op === "GT") return actualNumber > expectedNumber;
    if (op === "GE") return actualNumber >= expectedNumber;
    if (op === "LT") return actualNumber < expectedNumber;
    if (op === "LE") return actualNumber <= expectedNumber;
    return null;
  }

  function criterionResult(status, details) {
    return {
      unknownReason: null,
      patientFactIds: [],
      reason: "",
      question: "",
      ...(details || {}),
      status
    };
  }

  function combineAnd(results) {
    if (results.some(result => result.status === CRITERION_STATES.VIOLATED)) {
      return criterionResult(CRITERION_STATES.VIOLATED, {
        patientFactIds: results.filter(result => result.status === CRITERION_STATES.VIOLATED).flatMap(result => result.patientFactIds || []),
        reason: "At least one required branch is violated."
      });
    }
    if (results.some(result => result.status === CRITERION_STATES.NOT_MODELED)) {
      return criterionResult(CRITERION_STATES.NOT_MODELED, {
        unknownReason: UNKNOWN_REASONS.CRITERION_NOT_REPRESENTABLE,
        reason: "At least one required branch is not modeled."
      });
    }
    if (results.some(result => result.status === CRITERION_STATES.UNKNOWN)) {
      const unknown = results.find(result => result.status === CRITERION_STATES.UNKNOWN);
      return criterionResult(CRITERION_STATES.UNKNOWN, {
        unknownReason: unknown.unknownReason,
        question: unknown.question,
        reason: "At least one required branch needs confirmation."
      });
    }
    return criterionResult(CRITERION_STATES.SATISFIED, {
      patientFactIds: results.flatMap(result => result.patientFactIds || []),
      reason: "All required branches are satisfied."
    });
  }

  function combineOr(results) {
    const satisfied = results.find(result => result.status === CRITERION_STATES.SATISFIED);
    if (satisfied) return satisfied;
    if (results.every(result => result.status === CRITERION_STATES.VIOLATED)) {
      return criterionResult(CRITERION_STATES.VIOLATED, { patientFactIds: results.flatMap(result => result.patientFactIds || []), reason: "Every permitted branch is violated." });
    }
    if (results.some(result => result.status === CRITERION_STATES.UNKNOWN)) {
      const unknown = results.find(result => result.status === CRITERION_STATES.UNKNOWN);
      return criterionResult(CRITERION_STATES.UNKNOWN, {
        unknownReason: unknown.unknownReason,
        question: unknown.question,
        reason: "No branch is confirmed; at least one remains unknown."
      });
    }
    return criterionResult(CRITERION_STATES.NOT_MODELED, {
      unknownReason: UNKNOWN_REASONS.CRITERION_NOT_REPRESENTABLE,
      reason: "No branch could be evaluated safely."
    });
  }

  function evaluateLeaf(expression, facts, contradictions, context = {}) {
    const concept = normalizeEnum(expression?.concept || expression?.conceptId || "");
    const predicate = normalizeEnum(expression?.predicate || "has");
    if (!concept) {
      return criterionResult(CRITERION_STATES.NOT_MODELED, {
        unknownReason: UNKNOWN_REASONS.CRITERION_NOT_REPRESENTABLE,
        reason: "Criterion has no normalized concept."
      });
    }
    let candidates = facts.filter(fact =>
      normalizeEnum(fact?.confirmation) !== "rejected" &&
      normalizeEnum(fact?.experiencer || "patient") === "patient" &&
      normalizeEnum(fact?.concept?.code || fact?.conceptId) === concept &&
      normalizeEnum(fact?.predicate || "has") === predicate
    );
    const eventQuery = ["systemic_therapy", "treatment_exposure"].includes(concept) || expression.op === "EVENT_EXISTS";
    if (eventQuery) {
      if (!['EQ'].includes(String(expression.operator || 'EQ').toUpperCase()) || typeof expression.value !== 'string') {
        return criterionResult(CRITERION_STATES.NOT_MODELED, { reason: 'Event queries require an explicit event identity and equality; set and negative event logic require reviewed Boolean branches.' });
      }
      candidates = candidates.filter(fact => normalizeEnum(fact.value) === normalizeEnum(expression.value));
    }
    // Proposed/planned events and historical disease assertions cannot establish
    // current truth. A planned negative also cannot prove absence of exposure.
    candidates = candidates.filter(fact => !["planned", "unknown"].includes(normalizeEnum(fact.status)));
    const isMeasurement = Boolean(expression.unit) || concept === "ecog_status";
    if (isMeasurement && candidates.some(isFactConfirmed)) {
      const asOf = Date.parse(context.asOf || new Date().toISOString());
      const windowDays = expression.maxAgeDays ?? context.measurementMaxAgeDays ?? 30;
      const dated = candidates.filter(fact => {
        const age = (asOf - Date.parse(fact.observedAt || "")) / 86400000;
        return Number.isFinite(age) && age >= 0 && age <= windowDays;
      });
      if (!dated.length) return criterionResult(CRITERION_STATES.UNKNOWN, {
        unknownReason: UNKNOWN_REASONS.PATIENT_FACT_STALE,
        reason: "A current dated observation is required; historical or undated values cannot establish this criterion.",
        question: `Confirm ${expression.label || concept} and its collection date.`,
        patientFactIds: candidates.map(fact => fact.factId)
      });
      const latest = Math.max(...dated.map(fact => Date.parse(fact.observedAt)));
      candidates = dated.filter(fact => Date.parse(fact.observedAt) === latest);
      if (new Set(candidates.map(fact => JSON.stringify([fact.value, fact.unit, fact.assertion]))).size > 1) {
        return criterionResult(CRITERION_STATES.UNKNOWN, { unknownReason: UNKNOWN_REASONS.PATIENT_FACT_CONTRADICTORY, reason: "Current observations disagree; reconcile specimen and value.", patientFactIds: candidates.map(fact => fact.factId) });
      }
    }
    if (concept.startsWith("since_last_")) {
      candidates = candidates.filter(fact => fact.validAt && String(fact.validAt).slice(0, 10) === String(context.asOf || new Date().toISOString()).slice(0, 10));
    }
    if (candidates.length === 0) {
      return criterionResult(CRITERION_STATES.UNKNOWN, {
        unknownReason: expression?.unknownReason || UNKNOWN_REASONS.PATIENT_FACT_MISSING,
        question: expression?.question || `Confirm ${expression?.label || concept.replace(/_/g, " ")}.`,
        reason: "Required patient fact is missing."
      });
    }
    const candidateIds = new Set(candidates.map(fact => fact.factId));
    const contradiction = contradictions.find(item => item.positiveFactIds.concat(item.negativeFactIds).some(id => candidateIds.has(id)));
    if (contradiction) {
      return criterionResult(CRITERION_STATES.UNKNOWN, {
        unknownReason: UNKNOWN_REASONS.PATIENT_FACT_CONTRADICTORY,
        patientFactIds: Array.from(candidateIds),
        question: expression?.question || `Resolve contradictory ${expression?.label || concept.replace(/_/g, " ")} statements.`,
        reason: "Patient assertions conflict."
      });
    }
    const confirmed = candidates.filter(isFactConfirmed);
    if (confirmed.length === 0) {
      return criterionResult(CRITERION_STATES.UNKNOWN, {
        unknownReason: UNKNOWN_REASONS.PATIENT_FACT_UNCONFIRMED,
        patientFactIds: candidates.map(fact => fact.factId),
        question: expression?.question || `Confirm ${expression?.label || concept.replace(/_/g, " ")}.`,
        reason: "The extracted fact has not been confirmed."
      });
    }
    const expectedUnit = normalizeWhitespace(expression?.unit || "").toLowerCase();
    const unitCompatible = expectedUnit
      ? confirmed.filter(fact => normalizeWhitespace(fact?.unit || "").toLowerCase() === expectedUnit)
      : confirmed;
    if (expectedUnit && unitCompatible.length === 0) {
      return criterionResult(CRITERION_STATES.UNKNOWN, {
        unknownReason: UNKNOWN_REASONS.CRITERION_NOT_REPRESENTABLE,
        patientFactIds: confirmed.map(fact => fact.factId),
        question: expression?.question || `Confirm ${expression?.label || concept.replace(/_/g, " ")} in ${expression.unit}.`,
        reason: "The confirmed patient value uses an incompatible or missing unit."
      });
    }
    const expectedAssertion = normalizeEnum(expression?.assertion || "present");
    const matchingAssertion = unitCompatible.filter(fact => factPolarity(fact) === (expectedAssertion === "absent" ? "negative" : "positive"));
    if (matchingAssertion.length === 0) {
      const uncertainAssertions = unitCompatible.filter(fact => factPolarity(fact) === "uncertain");
      if (uncertainAssertions.length > 0) {
        return criterionResult(CRITERION_STATES.UNKNOWN, {
          unknownReason: UNKNOWN_REASONS.PATIENT_FACT_UNCERTAIN,
          patientFactIds: uncertainAssertions.map(fact => fact.factId),
          question: expression?.question || `Resolve the uncertain ${expression?.label || concept.replace(/_/g, " ")} assertion.`,
          reason: "A possible, conditional, or hypothetical assertion cannot satisfy or violate the criterion."
        });
      }
      return criterionResult(CRITERION_STATES.VIOLATED, {
        patientFactIds: confirmed.map(fact => fact.factId),
        reason: "Confirmed patient assertion contradicts the criterion."
      });
    }
    if (Object.prototype.hasOwnProperty.call(expression || {}, "value")) {
      const comparisons = matchingAssertion.map(fact => compareValues(fact.value, expression.operator || "EQ", expression.value));
      if (comparisons.some(value => value === true)) {
        return criterionResult(CRITERION_STATES.SATISFIED, {
          patientFactIds: matchingAssertion.filter((fact, index) => comparisons[index] === true).map(fact => fact.factId),
          reason: "Confirmed patient value satisfies the normalized predicate."
        });
      }
      if (comparisons.every(value => value === false)) {
        return criterionResult(CRITERION_STATES.VIOLATED, {
          patientFactIds: matchingAssertion.map(fact => fact.factId),
          reason: "Confirmed patient value violates the normalized predicate."
        });
      }
      return criterionResult(CRITERION_STATES.UNKNOWN, {
        unknownReason: UNKNOWN_REASONS.CRITERION_NOT_REPRESENTABLE,
        patientFactIds: matchingAssertion.map(fact => fact.factId),
        reason: "Patient value could not be compared safely."
      });
    }
    return criterionResult(CRITERION_STATES.SATISFIED, {
      patientFactIds: matchingAssertion.map(fact => fact.factId),
      reason: "Confirmed patient assertion satisfies the criterion."
    });
  }

  function evaluateExpression(expression, facts, contradictions, context = {}) {
    if (!expression || expression.modeledStatus === "not_modeled" || expression.op === "NOT_MODELED") {
      return criterionResult(CRITERION_STATES.NOT_MODELED, {
        unknownReason: UNKNOWN_REASONS.CRITERION_NOT_REPRESENTABLE,
        reason: "Criterion is not represented by the current evaluator."
      });
    }
    const op = normalizeEnum(expression.op || "FACT").toUpperCase();
    const args = Array.isArray(expression.args) ? expression.args : expression.arg ? [expression.arg] : [];
    if (!["FACT", "EVENT_EXISTS", "AND", "ALL_OF", "OR", "ANY_OF", "NONE_OF", "NOT"].includes(op) || (["AND", "ALL_OF", "OR", "ANY_OF", "NONE_OF", "NOT"].includes(op) && !args.length) || (op === "NOT" && args.length !== 1)) return criterionResult(CRITERION_STATES.NOT_MODELED, { reason: "Unsupported or empty predicate." });
    if (["AND", "ALL_OF"].includes(op)) return combineAnd(args.map(arg => evaluateExpression(arg, facts, contradictions, context)));
    if (["OR", "ANY_OF"].includes(op)) return combineOr(args.map(arg => evaluateExpression(arg, facts, contradictions, context)));
    if (op === "NONE_OF") {
      const result = combineOr(args.map(arg => evaluateExpression(arg, facts, contradictions, context)));
      if (result.status === CRITERION_STATES.SATISFIED) return criterionResult(CRITERION_STATES.VIOLATED, result);
      if (result.status === CRITERION_STATES.VIOLATED) return criterionResult(CRITERION_STATES.SATISFIED, result);
      return result;
    }
    if (op === "NOT") {
      const result = evaluateExpression(args[0], facts, contradictions, context);
      if (result.status === CRITERION_STATES.SATISFIED) return { ...result, status: CRITERION_STATES.VIOLATED };
      if (result.status === CRITERION_STATES.VIOLATED) return { ...result, status: CRITERION_STATES.SATISFIED };
      return result;
    }
    return evaluateLeaf(expression, facts, contradictions, context);
  }

  function mayHardExclude(evaluation) {
    const criterion = evaluation?.criterion || {};
    return Boolean(
      evaluation?.automatedExclusionValidated === true &&
      evaluation?.status === CRITERION_STATES.VIOLATED &&
      criterion.criticality === "hard" &&
      criterion.reviewStatus === "clinician_reviewed" &&
      criterion.modeledStatus === "modeled" &&
      evaluation.trialSourceIsCurrent === true &&
      Array.isArray(evaluation.patientFacts) &&
      evaluation.patientFacts.length > 0 &&
      evaluation.patientFacts.every(fact =>
        isFactConfirmed(fact) &&
        normalizeEnum(fact?.experiencer || "patient") === "patient" &&
        !["planned", "unknown"].includes(normalizeEnum(fact?.status)) &&
        factPolarity(fact) !== "uncertain" &&
        fact.isContradictory !== true
      )
    );
  }

  function evaluateCriterion(criterion, patientFactSet, context) {
    const facts = Array.isArray(patientFactSet?.facts) ? patientFactSet.facts : [];
    const contradictions = Array.isArray(patientFactSet?.contradictions)
      ? patientFactSet.contradictions
      : detectContradictions(facts);
    const result = normalizeEnum(criterion?.modeledStatus) !== "modeled"
      ? evaluateExpression({ op: "NOT_MODELED" }, facts, contradictions)
      : evaluateExpression(criterion?.predicate, facts, contradictions, context);
    const referencedFacts = facts.filter(fact => (result.patientFactIds || []).includes(fact.factId));
    const evaluation = {
      criterionId: criterion?.criterionId || "unknown",
      criterion,
      ...result,
      patientFacts: referencedFacts,
      trialSourceIsCurrent: context?.trialSourceIsCurrent === true,
      hardExclusionAllowed: false
    };
    evaluation.hardExclusionAllowed = mayHardExclude(evaluation);
    return evaluation;
  }

  function calculateTrialDataQuality(cohort, trial, context = {}) {
    const criteria = [].concat(cohort?.sharedCriteria || [], cohort?.cohortSpecificCriteria || []);
    const critical = criteria.filter(criterion => criterion.criticality === "hard");
    const modeledCritical = critical.filter(criterion => criterion.modeledStatus === "modeled");
    const reviewedCritical = critical.filter(criterion => criterion.reviewStatus === "clinician_reviewed");
    const sites = cohort?.sites || trial?.sites || [];
    const siteStatusCurrent = Boolean(sites.some(site => {
      const status = normalizeEnum(site.locationStatus || site.status || "unknown");
      const verifiedAt = Date.parse(site.sourceVerifiedDate || site.verifiedAt || "");
      const age = (Date.parse(context.asOf || new Date().toISOString()) - verifiedAt) / 86400000;
      const fresh = Number.isFinite(age) && age >= 0 && age <= 14;
      // Only a recently verified recruiting site can support the priority
      // protocol-review queue. Active-not-recruiting and not-yet-recruiting
      // records remain retrievable, but do not imply that a patient can enroll.
      return status === "recruiting" && site.statusStale !== true && fresh && (site.cohortIds || []).includes(cohort.cohortId);
    }));
    const cohortReviewed = Boolean(cohort?.cohortExtraction?.reviewedBy);
    const assigned = new Set(criteria.map(item => item.criterionId));
    const sourceAccounted = (trial?.criteria || []).every(item => assigned.has(item.criterionId) || (cohort?.inapplicableCriterionIds || []).includes(item.criterionId));
    const criticalCriteriaComplete = sourceAccounted && critical.length > 0 && modeledCritical.length === critical.length && reviewedCritical.length === critical.length;
    return {
      tier: cohortReviewed && criticalCriteriaComplete ? "reviewed" : cohortReviewed ? "partially_reviewed" : "machine_extracted",
      cohortReviewed,
      criticalCriteriaComplete,
      criticalCriteriaModeled: critical.length ? modeledCritical.length / critical.length : 0,
      criticalCriteriaReviewed: critical.length ? reviewedCritical.length / critical.length : 0,
      criticalCriterionCount: critical.length,
      currentLocalCohort: siteStatusCurrent && normalizeEnum(cohort?.enrollmentStatus) === "recruiting" && context.trialSourceIsCurrent === true,
      siteStatusCurrent,
      registrySnapshot: trial?.registryVersion || trial?.lastSyncAt || null,
      rawRecordHash: trial?.rawRecordHash || null
    };
  }

  function classifyReviewTier(options) {
    const evaluations = Array.isArray(options?.evaluations) ? options.evaluations : [];
    const trialQuality = options?.trialQuality || {};
    const critical = evaluations.filter(item => item.criterion?.criticality === "hard");
    const hardViolation = critical.some(item => item.status === CRITERION_STATES.VIOLATED && item.hardExclusionAllowed === true);
    if (hardViolation) return REVIEW_TIERS.MODELED_CONFLICT;
    const modeledConflict = critical.some(item => item.status === CRITERION_STATES.VIOLATED);
    if (modeledConflict) return REVIEW_TIERS.MODELED_CONFLICT;
    const trialIncomplete = critical.some(item => item.status === CRITERION_STATES.NOT_MODELED || item.unknownReason === UNKNOWN_REASONS.TRIAL_SOURCE_AMBIGUOUS);
    if (trialIncomplete || options?.diseaseRelation === "UNKNOWN_TRIAL_DATA" || trialQuality.tier !== "reviewed") {
      return REVIEW_TIERS.MANUAL_REVIEW_TRIAL_DATA;
    }
    const patientUnknown = critical.some(item => item.status === CRITERION_STATES.UNKNOWN);
    if (patientUnknown || options?.hasUnconfirmedCriticalFacts) return REVIEW_TIERS.POTENTIALLY_RELEVANT;
    const satisfiedCritical = critical.filter(item => item.status === CRITERION_STATES.SATISFIED).length;
    if (options?.positiveDiseaseEvidence && satisfiedCritical > 0 && trialQuality.currentLocalCohort === true) {
      return REVIEW_TIERS.PRIORITY_PROTOCOL_REVIEW;
    }
    return options?.positiveDiseaseEvidence
      ? REVIEW_TIERS.POTENTIALLY_RELEVANT
      : REVIEW_TIERS.DISEASE_CONTEXT_RETRIEVAL;
  }

  function normalizeCohorts(trial) {
    const source = Array.isArray(trial?.cohorts) && trial.cohorts.length > 0
      ? trial.cohorts
      : [{
          cohortId: `${trial?.nctId || trial?.id || "trial"}:unsegmented`,
          label: "Unsegmented trial record",
          armIds: [],
          enrollmentStatus: trial?.status || "unknown",
          diseaseConcepts: trial?.diseaseSettingAllIds || [],
          sharedCriteria: Array.isArray(trial?.criteria) ? trial.criteria : [],
          cohortSpecificCriteria: [],
          cohortExtraction: {
            method: "fallback",
            confidence: 0,
            reviewedBy: null,
            reviewedAt: null,
            ambiguity: "Cohort structure unavailable"
          }
        }];
    return source.map((cohort, index) => ({
      ...cohort,
      cohortId: cohort.cohortId || `${trial?.nctId || trial?.id || "trial"}:cohort-${index + 1}`,
      label: cohort.label || `Cohort ${index + 1}`,
      sharedCriteria: Array.isArray(cohort.sharedCriteria) ? cohort.sharedCriteria : [],
      cohortSpecificCriteria: Array.isArray(cohort.cohortSpecificCriteria) ? cohort.cohortSpecificCriteria : []
    }));
  }

  function validateModelProposal(proposal, sourceText) {
    const errors = [];
    const validatePredicate = (expression, path, depth) => {
      if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
        errors.push(`${path} must be an object.`);
        return;
      }
      if (depth > 8) {
        errors.push(`${path} exceeds maximum Boolean depth.`);
        return;
      }
      const op = normalizeEnum(expression.op || "").toUpperCase();
      if (op === "FACT") {
        if (!normalizeEnum(expression.concept)) errors.push(`${path}.concept is required.`);
        if (!normalizeEnum(expression.predicate)) errors.push(`${path}.predicate is required.`);
        if (!["EQ", "NE", "IN", "NOT_IN", "GT", "GE", "LT", "LE"].includes(normalizeEnum(expression.operator || "EQ").toUpperCase())) {
          errors.push(`${path}.operator is unsupported.`);
        }
        if (!Object.prototype.hasOwnProperty.call(expression, "value") && !Object.prototype.hasOwnProperty.call(expression, "assertion")) {
          errors.push(`${path} requires value or assertion.`);
        }
        return;
      }
      if (!["AND", "ALL_OF", "OR", "ANY_OF", "NONE_OF", "NOT"].includes(op)) {
        errors.push(`${path}.op is unsupported.`);
        return;
      }
      const args = Array.isArray(expression.args) ? expression.args : [];
      if (!args.length) errors.push(`${path}.args must be non-empty.`);
      if (op === "NOT" && args.length !== 1) errors.push(`${path}.args must contain exactly one item for NOT.`);
      args.forEach((arg, index) => validatePredicate(arg, `${path}.args[${index}]`, depth + 1));
    };
    if (!proposal || typeof proposal !== "object") errors.push("Proposal must be an object.");
    const allowedKeys = new Set(["criterionType", "normalizedPredicate", "sourceSpan", "confidence", "ambiguities", "modelVersion"]);
    Object.keys(proposal || {}).filter(key => !allowedKeys.has(key)).forEach(key => errors.push(`Unexpected proposal field: ${key}.`));
    if (!proposal?.criterionType || typeof proposal.criterionType !== "string") errors.push("criterionType is required.");
    if (!proposal?.normalizedPredicate || typeof proposal.normalizedPredicate !== "object") errors.push("normalizedPredicate is required.");
    else validatePredicate(proposal.normalizedPredicate, "normalizedPredicate", 0);
    if (!proposal?.sourceSpan || !Number.isInteger(proposal.sourceSpan.start) || !Number.isInteger(proposal.sourceSpan.end)) {
      errors.push("Exact integer source-span offsets are required.");
    } else if (proposal.sourceSpan.start < 0 || proposal.sourceSpan.end <= proposal.sourceSpan.start || proposal.sourceSpan.end > String(sourceText || "").length) {
      errors.push("sourceSpan offsets are outside the source text.");
    } else {
      const actual = String(sourceText || "").slice(proposal.sourceSpan.start, proposal.sourceSpan.end);
      if (actual !== proposal.sourceSpan.text) errors.push("sourceSpan.text does not match the source offsets.");
    }
    if (!proposal?.modelVersion) errors.push("modelVersion is required.");
    if (!Array.isArray(proposal?.ambiguities)) errors.push("ambiguities must be an array.");
    if (!Number.isFinite(proposal?.confidence) || proposal.confidence < 0 || proposal.confidence > 1) errors.push("confidence must be between 0 and 1.");
    if (Object.prototype.hasOwnProperty.call(proposal || {}, "decision")) {
      errors.push("Model proposals may not directly decide eligibility or hard exclusion.");
    }
    return { valid: errors.length === 0, errors };
  }

  const api = {
    SCHEMA_VERSION,
    CRITERION_STATES,
    UNKNOWN_REASONS,
    REVIEW_TIERS,
    REVIEW_TIER_LABELS,
    CANONICAL_ALIASES,
    AXIS_VALUE_ALIASES,
    canonicalToken,
    normalizeEnum,
    normalizeAxisValue,
    makeSourceSpan,
    createPatientFact,
    detectContradictions,
    confirmedFacts,
    evaluateExpression,
    evaluateCriterion,
    mayHardExclude,
    calculateTrialDataQuality,
    classifyReviewTier,
    normalizeCohorts,
    validateModelProposal
  };

  global.ClinicalTrialSchema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
