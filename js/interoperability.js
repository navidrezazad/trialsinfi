(function (global) {
  "use strict";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function encodeBase64(value) {
    const text = JSON.stringify(value);
    if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64");
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return global.btoa(binary);
  }

  function decodeBase64(value) {
    let text;
    if (typeof Buffer !== "undefined") text = Buffer.from(value, "base64").toString("utf8");
    else {
      const binary = global.atob(value);
      text = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    }
    return JSON.parse(text);
  }

  function codingForConcept(concept) {
    return {
      coding: [{
        system: concept?.system || "https://example.org/clinical-trial-search/concepts",
        code: concept?.code || "unknown",
        display: concept?.display || concept?.code || "Unknown"
      }]
    };
  }

  function patientFactToObservation(fact) {
    const value = typeof fact.value === "number"
      ? { valueQuantity: { value: fact.value, unit: fact.unit || undefined } }
      : { valueString: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value) };
    return {
      resourceType: "Observation",
      id: fact.factId,
      status: fact.status === "historical" ? "final" : "preliminary",
      code: codingForConcept(fact.concept),
      ...value,
      effectiveDateTime: fact.observedAt || fact.validAt || undefined,
      extension: [
        { url: "https://example.org/fhir/StructureDefinition/assertion", valueCode: fact.assertion },
        { url: "https://example.org/fhir/StructureDefinition/confirmation", valueCode: fact.confirmation },
        { url: "https://example.org/fhir/StructureDefinition/predicate", valueCode: fact.predicate },
        { url: "https://example.org/fhir/StructureDefinition/source-span", valueString: JSON.stringify(fact.sourceSpan || {}) }
      ]
    };
  }

  function patientFactSetToFhir(patientFactSet) {
    const source = clone(patientFactSet);
    return {
      resourceType: "Bundle",
      type: "collection",
      meta: { profile: ["https://example.org/fhir/StructureDefinition/clinical-trial-prescreen-fact-bundle"] },
      identifier: { system: "https://example.org/clinical-trial-search/patient-version", value: source.patientVersion },
      entry: [
        {
          fullUrl: `urn:uuid:${source.patientVersion || "patient-fact-set"}-internal`,
          resource: {
            resourceType: "Binary",
            id: `${source.patientVersion || "patient-fact-set"}-internal`,
            contentType: "application/vnd.clinical-trial-prescreen.patient-fact-set+json",
            data: encodeBase64(source)
          }
        },
        ...(source.facts || []).map(fact => ({ fullUrl: `urn:uuid:${fact.factId}`, resource: patientFactToObservation(fact) }))
      ]
    };
  }

  function patientFactSetFromFhir(bundle) {
    const binary = (bundle?.entry || []).map(entry => entry.resource).find(resource => resource?.resourceType === "Binary" && resource.contentType === "application/vnd.clinical-trial-prescreen.patient-fact-set+json");
    if (!binary?.data) throw new Error("FHIR bundle does not contain the authoritative internal patient fact set.");
    return decodeBase64(binary.data);
  }

  function cohortToFhirEvidenceVariable(cohort) {
    const source = clone(cohort);
    const criteria = [].concat(source.sharedCriteria || [], source.cohortSpecificCriteria || []);
    return {
      resourceType: "Bundle",
      type: "collection",
      meta: { profile: ["https://hl7.org/fhir/R5/evidencevariable.html"] },
      entry: [
        {
          fullUrl: `urn:uuid:${source.cohortId}`,
          resource: {
            resourceType: "EvidenceVariable",
            id: source.cohortId,
            status: "draft",
            name: source.label,
            description: "Cohort criteria exported for exchange; internal AST remains authoritative.",
            characteristic: criteria.map(criterion => ({
              description: criterion.sourceSpan?.text || criterion.criterionId,
              definitionByCombination: {
                code: "all-of",
                characteristic: [{
                  description: JSON.stringify(criterion.predicate),
                  exclude: criterion.kind === "exclusion"
                }]
              },
              extension: [{ url: "https://example.org/fhir/StructureDefinition/criterion-id", valueString: criterion.criterionId }]
            }))
          }
        },
        {
          fullUrl: `urn:uuid:${source.cohortId}-internal`,
          resource: {
            resourceType: "Binary",
            id: `${source.cohortId}-internal`,
            contentType: "application/vnd.clinical-trial-prescreen.cohort-ast+json",
            data: encodeBase64(source)
          }
        }
      ]
    };
  }

  function cohortFromFhir(bundle) {
    const binary = (bundle?.entry || []).map(entry => entry.resource).find(resource => resource?.resourceType === "Binary" && resource.contentType === "application/vnd.clinical-trial-prescreen.cohort-ast+json");
    if (!binary?.data) throw new Error("FHIR bundle does not contain the authoritative internal cohort AST.");
    return decodeBase64(binary.data);
  }

  function cohortToCdiscOdm(cohort) {
    const source = clone(cohort);
    const criteria = [].concat(source.sharedCriteria || [], source.cohortSpecificCriteria || []);
    return {
      ODM: {
        ODMVersion: "1.3.2",
        FileType: "Snapshot",
        FileOID: `CTS.${source.cohortId}`,
        MetaDataVersion: {
          OID: `MDV.${source.cohortId}`,
          Name: source.label,
          ItemGroupDef: {
            OID: `IG.CRITERIA.${source.cohortId}`,
            Repeating: "Yes",
            Items: criteria.map(criterion => ({
              OID: criterion.criterionId,
              Name: criterion.predicate?.label || criterion.criterionId,
              DataType: "text",
              Comment: criterion.sourceSpan?.text || "",
              Role: criterion.kind
            }))
          }
        },
        Alias: [{ Context: "InternalSchemaVersion", Name: source.schemaVersion || "1.0.0" }],
        InternalAST: source
      }
    };
  }

  function cohortFromCdiscOdm(document) {
    if (!document?.ODM?.InternalAST) throw new Error("CDISC ODM envelope does not contain the authoritative internal cohort AST.");
    return clone(document.ODM.InternalAST);
  }

  const api = {
    patientFactSetToFhir,
    patientFactSetFromFhir,
    cohortToFhirEvidenceVariable,
    cohortFromFhir,
    cohortToCdiscOdm,
    cohortFromCdiscOdm
  };
  global.ClinicalInteroperability = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
