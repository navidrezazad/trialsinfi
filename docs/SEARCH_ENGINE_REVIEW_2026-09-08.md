# Deterministic search-engine review implementation

Review baseline: `e6b6b07f907fcdf77a811a28025b04c8620ead02`.
Scope: deterministic changes; no LLM integration or patient-text transmission.

## Implemented safeguards

- Boolean status inversion and violated-branch witnesses are preserved. Unknown operators, empty Boolean trees and unsupported event-set queries abstain.
- Treatment predicates bind to the named drug. Planned exposures cannot establish received treatment. Separate explicit positive/negative exposure assertions are retained.
- Dated lab/ECOG observations use the latest measurement within a conservative 30-day engineering window; older, future, undated or conflicting observations stay unknown. This default is not a clinically validated freshness rule. Protocol-specific windows require reviewed representation.
- Only completely understood source clauses are modeled. Unparsed conjunctions, exceptions and time restrictions cause abstention. Exact ECOG inequalities/sets and simple lab OR/AND are preserved. Washout text stays unmodeled until fully reviewed; no positive exposure window becomes a washout.
- Legacy rules are shadow diagnostics, not criterion truth or review-tier authority. All automated exclusion is disabled pending independent clinical validation; modeled conflicts remain visible.
- Cohort disease/status is evaluated independently. Priority review requires current trial source and a recruiting site explicitly linked to the cohort, plus complete reviewed critical criteria.
- Curator review requires every source criterion assigned or explicitly inapplicable with rationale. Actual source-content hashes invalidate stale reviews. Repeat migration preserves cohort closure and does not fabricate fresh source timestamps.
- One production search service drives the UI and executable benchmark. Retrieval includes multicancer and plausible basket trials, with consistent status policy above/below 500 records. BM25 affects review order, not eligibility evidence.
- Provisional results are available before exhaustive fact confirmation. Partial review is supported; unknown facts remain unknown. Full criterion text and next questions are shown. Raw narratives are not persisted.
- Parser fixes cover negated visceral disease/ADT, inadequate BCG, intermediate IMDC, somatic VHL versus hereditary disease, metastatic disease after nephrectomy, planned combinations, exact source spans, numeric ECOG and age-only corrections. Preferences require explicit preference language.
- Registry query/pagination failures abort acquisition instead of publishing a partial catalog. Site status comes from the location, not the parent study.
- Metrics reject duplicate rankings and incomplete manifests, count zero-F1 classes, correct the unsafe-exclusion denominator, and treat no-hit review burden as censored. Synthetic perfect scores cannot pass the independent-validation gate.

## Verification

Offline JavaScript suites: schema contract, patient matching legacy diagnostics, scientific prescreen, guarded extensions, and new Pro-review regressions.
Python suites: classifier, schema, curator, exports/import, and new Pro-review regressions. Live catalog migration is checked for unchanged trial IDs and raw eligibility text.

Run the shared production service against a locked synthetic/de-identified benchmark:

```sh
node validation/execute-search-benchmark.js benchmark.json catalog.json
```

Inputs require `asOf`, cases with `query`, adjudicated `goldCohorts`, and criterion gold rows keyed by `cohortId` and `criterionId`. Optional `factDecisions` use parser fact IDs. Submitted predictions are overwritten by actual service results. The report contains aggregate metrics and a catalog hash, not narratives.

## Remaining scientific work (not claimed complete)

Independent clinician annotation, adjudication, subgroup recruitment, patient-clustered uncertainty analysis, locked external validation and prospective workflow evaluation require clinical participation. No clinical improvement rate or eligibility accuracy is claimed from these engineering tests.

Full temporal/event ontology, specimen-aware laboratory series, advanced compound-clause parsing, reviewed cohort/site mapping and a complete parser redesign remain future work. Unsupported cases abstain. LLM-based extraction, reranking and active-learning providers were intentionally not incorporated. Existing optional model utilities remain unused by the production search service.
