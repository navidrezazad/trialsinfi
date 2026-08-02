# Scientific Prescreen Architecture

## Scope and claim

This system performs multi-stage **cohort retrieval, relevance prioritization, and auditable criterion pre-screening**. It does not calculate final eligibility. The safe output is a protocol-review queue with evidence, uncertainty, and next questions.

The design optimizes first for avoiding silent false negatives and unsafe exclusions, then for physician review efficiency. Missing patient data, missing trial data, and explicit conflicts remain distinct.

## Processing path

```text
de-identified narrative
  -> context-safe candidate fact extraction
  -> physician confirm / correct / reject
  -> versioned patient fact set + contradictions
  -> high-recall same-cancer retrieval
  -> trial cohort normalization
  -> criterion-by-criterion four/five-state evaluation
  -> guarded hard-exclusion decision
  -> evidence-first review tier and within-tier ranking
```

At the current catalog size, candidate generation exhaustively retains every open-or-uncertain same-cancer record (up to the configured 500-record threshold). Missing disease-setting IDs therefore cannot silently remove a same-cancer trial. For larger catalogs, the candidate set is the union of structured overlap, BM25, and an optional injected dense retriever.

## Canonical contracts

The source of truth for vocabulary is `schemas/clinical-vocabulary.source.json`. `production_ready_pipeline/build_clinical_vocabulary.py` generates the browser and Python artifacts, and contract tests check both copies against the taxonomies and live catalog.

Patient facts include:

- canonical concept, predicate, value, unit, status, assertion, temporality, and experiencer;
- exact source offsets and extraction provenance;
- confirmation state and supersession link;
- optional observation/event dates;
- contradiction records keyed to the same proposition.

Trial cohorts include:

- stable cohort ID, arm IDs, disease concepts, interventions, sites, and status provenance;
- shared and cohort-specific criteria;
- source-spanned Boolean/numeric predicates;
- modeled and human-review status;
- extraction method, ambiguity, reviewer, and review time.

The catalog migration never invents cohort assignment. It creates one explicit unsegmented pathway until a hash-bound curator review is applied. Human review is preserved across repeat schema generation only while the raw-record hash and registry version remain unchanged.

## Patient-fact safety

`js/patient-query-parser.js` proposes facts but cannot confirm them. It has explicit guards for:

- negated versus positive assertions;
- possible/conditional/hypothetical disease language;
- family-member experiencer;
- planned versus received treatment;
- received versus progressed-on treatment;
- exact age and administrative sex when stated;
- exact numeric labs with canonical units and optional dates;
- selected temporal intervals and treatment event dates;
- contradictory facts, ignored text, direct-identifier warnings, and critical questions.

Context that cannot safely become a positive patient fact is masked only for deterministic interpretation while the original text remains available for source-span and ignored-text review. Matching cannot start until all proposed facts are confirmed, corrected, or rejected.

## Criterion semantics

The authoritative evaluator is `js/clinical-trial-schema.js`. A leaf predicate compares only confirmed facts about the patient with a compatible concept, predicate, assertion, and unit. The evaluator returns:

- `SATISFIED`;
- `VIOLATED`;
- `UNKNOWN` with a structured reason;
- `NOT_MODELED`;
- `NOT_APPLICABLE` where supplied by cohort logic.

Boolean `AND`, `OR`, `NOT`, and `NONE_OF` preserve unknown/not-modeled states. Uncertain assertions abstain. A criterion marked `not_modeled` cannot be evaluated even if a stale predicate happens to remain in an old payload.

Deterministic protocol extraction currently models conservative subsets of structured age/sex, explicit ECOG forms, exact numeric laboratory thresholds, and unambiguous therapy/radiation/surgery washouts. It rejects partial lab clauses, incompatible units, half-life alternatives, complex Boolean text, and unsafe exclusion semantics. The source text remains available for manual review.

## Hard-exclusion invariant

A modeled conflict remains visible regardless of exclusion eligibility. `hardExclusionAllowed` is true only when all of the following hold:

1. the evaluated state is `VIOLATED`;
2. the criterion is hard, modeled, and `clinician_reviewed`;
3. the trial source is current;
4. at least one referenced patient fact exists;
5. every referenced fact is physician-confirmed/corrected, belongs to the patient, is definite rather than possible/hypothetical, is not planned/unknown, and is not contradictory.

Regex matches, model proposals, unreviewed criteria, stale sources, generic labs, missing values, and uncertain assertions cannot hard-exclude.

## Review tiers and ranking

The output tiers are:

- `PRIORITY_PROTOCOL_REVIEW`;
- `POTENTIALLY_RELEVANT`;
- `MANUAL_REVIEW_TRIAL_DATA`;
- `MODELED_CONFLICT`;
- `DISEASE_CONTEXT_RETRIEVAL`.

Priority requires positive disease evidence, no unresolved critical patient state, reviewed trial/cohort quality, at least one satisfied critical criterion, and current local-cohort evidence. Within-tier relevance, phase, site proximity, and preferences may order results but may not change criterion states, promote low-quality trial data, or conceal conflict/abstention.

The legacy matcher retains temporary internal compatibility fields for regression comparison, but the physician interface and documentation do not expose legacy confidence labels. These fields do not control the guarded evaluator or hard-exclusion gate and should be removed after downstream consumers migrate.

## Provenance and site status

Every migrated trial has schema, registry version, retrieval time, raw-record hash, taxonomy/classifier evidence, and data-quality metadata. Evidence-strength labels are not probabilities. Drug names are retrieval/classification evidence only and never prove biomarker eligibility.

Historical per-location records without a trustworthy location-status timestamp are labeled unknown/stale. A study-level recruiting status cannot establish that a specific site or cohort is open. Current site confirmation remains an external workflow.

## Guarded research extensions

Optional language-model tasks are limited to source-spanned criterion proposals, cohort-segmentation proposals, dense retrieval, and relevance reranking. They are disabled until an approved provider, immutable model version, and held-out validation version are injected. Proposals cannot claim review, auto-apply, decide eligibility, or hard-exclude.

FHIR R5-style and CDISC ODM adapters include a lossless embedded copy of the internal AST. They are exchange experiments, not certified conformance profiles. The internal versioned schema remains authoritative.

Telemetry is aggregate and allowlisted. Raw queries, narrative, source text, patient facts, and common identifiers are rejected from monitoring payloads.

## Module map

| Responsibility | Primary implementation |
| --- | --- |
| Canonical vocabulary | `schemas/clinical-vocabulary.source.json`, `production_ready_pipeline/build_clinical_vocabulary.py` |
| Patient extraction/confirmation | `js/patient-query-parser.js`, `js/main-php.js` |
| Criterion evaluation and gates | `js/clinical-trial-schema.js` |
| High-recall retrieval | `js/trial-retrieval.js` |
| Domain compatibility/ranking | `js/patient-trial-matcher.js` |
| Trial schema migration | `production_ready_pipeline/clinical_schema.py`, `migrate_catalog_schema.py` |
| Human cohort review | `schemas/cohort-review.schema.json`, `apply_curator_review.py` |
| Model proposal guard | `js/model-assisted-prescreen.js` |
| Drift and provenance | `production_ready_pipeline/catalog_drift.py` |
| Benchmark and go/no | `validation/benchmark-runner.js` |
| Blinded annotation/agreement | `validation/annotation-tool.html`, `merge-annotations.js`, `annotation-agreement.js` |
| Aggregate monitoring | `js/safety-telemetry.js`, `validation/safety-dashboard.html` |

## Remaining limitations and external dependencies

The code does not establish clinical validity. The benchmark requires independent reviewers and adjudication; prospective work requires approved data, governance/IRB/privacy review, a power calculation, at least two clinical settings, monitoring ownership, and site coordination. The current catalog also requires human cohort segmentation and critical-criterion review before any record can reach the highest review tier.

The locked validation protocol, exact go/no thresholds, and prospective silent-study requirements are in `validation/README.md`.
