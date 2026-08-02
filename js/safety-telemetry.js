(function (global) {
  "use strict";

  const ALLOWED_FIELDS = new Set([
    "eventType", "cancerType", "reviewTier", "errorCategory", "parserVersion",
    "matcherVersion", "catalogVersion", "count", "hardExcluded", "overridden", "abstained"
  ]);
  const FORBIDDEN_FIELDS = /(?:raw|narrative|query|patient|fact|source|text|name|email|phone|address|mrn|dob)/i;

  function sanitizeEvent(input) {
    const event = {};
    Object.entries(input || {}).forEach(([key, value]) => {
      if (!ALLOWED_FIELDS.has(key) || FORBIDDEN_FIELDS.test(key)) return;
      if (typeof value === "string") event[key] = value.slice(0, 80);
      else if (typeof value === "number" && Number.isFinite(value)) event[key] = value;
      else if (typeof value === "boolean") event[key] = value;
    });
    if (!event.eventType) throw new Error("eventType is required");
    return event;
  }

  function createAggregate() {
    return { schemaVersion: "1.0.0", total: 0, byEventType: {}, byCancerType: {}, byReviewTier: {}, byErrorCategory: {} };
  }

  function record(aggregate, input) {
    const event = sanitizeEvent(input);
    const target = aggregate || createAggregate();
    const amount = Math.max(1, Number(event.count || 1));
    target.total += amount;
    [
      ["byEventType", event.eventType],
      ["byCancerType", event.cancerType],
      ["byReviewTier", event.reviewTier],
      ["byErrorCategory", event.errorCategory]
    ].forEach(([bucket, key]) => {
      if (key) target[bucket][key] = (target[bucket][key] || 0) + amount;
    });
    return target;
  }

  function assertNoPatientPayload(value) {
    const serialized = JSON.stringify(value || {});
    if (/rawQuery|patientNarrative|sourceText|patientFacts|medical_record_number|date_of_birth/i.test(serialized)) {
      throw new Error("Telemetry contains a prohibited patient-level field.");
    }
    return true;
  }

  const api = { ALLOWED_FIELDS, sanitizeEvent, createAggregate, record, assertNoPatientPayload };
  global.SafetyTelemetry = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
