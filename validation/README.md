# Scientific Validation Protocol

This directory contains validation infrastructure, not evidence that the system is clinically validated. No deployment, referral, or patient-care claim should be made until the benchmark and prospective stages below are completed with governance approval and independent clinical reviewers.

## Prespecified task and label unit

The primary task is high-recall retrieval and prioritization of **trial cohorts**, followed by auditable criterion-level pre-screening. The label unit is a `(de-identified case, versioned cohort)` pair, not an NCT record. One trial may contribute multiple cohorts with different criteria.

Gold cohort relevance uses an ordinal four-class scale:

- `PRIORITY_REVIEW`: a physician should review the protocol promptly for this case;
- `PLAUSIBLE`: clinically plausible but important eligibility work remains;
- `NOT_RELEVANT`: not a useful protocol-review candidate for the stated case;
- `INDETERMINATE_TRIAL_DATA`: the registry/protocol representation is insufficient to judge.

Gold criterion states use `SATISFIED`, `VIOLATED`, `UNKNOWN_PATIENT`, `AMBIGUOUS_TRIAL`, `NOT_MODELED`, and `NOT_APPLICABLE`. Patient uncertainty and trial-data uncertainty must be labeled separately. A hard-exclusion gold label additionally records whether exclusion is justified by the current source, a clinician-reviewed predicate, and confirmed noncontradictory patient facts.

## Retrospective benchmark construction

Freeze the following before annotation:

- the raw and normalized trial-catalog snapshot and hash;
- taxonomy, parser, matcher, schema, and model versions;
- the annotation manual and adjudication rules;
- all primary metrics, subgroup definitions, and go/no thresholds;
- the analysis script commit.

The initial benchmark target from the scientific review is:

- **320 core vignettes**: 80 each for prostate, bladder/urothelial, kidney/RCC, and testicular/GCT;
- **120 adversarial vignettes** emphasizing negation, family experiencer, uncertainty, contradictions, planned versus received therapy, exact temporal boundaries, unit mismatches, cohort scope, missing trial fields, stale sites, and rare disease states;
- all same-cancer case/cohort pairs in the frozen snapshot, not only the engine's retrieved results, so omitted relevant cohorts can be counted.

Sample across disease setting, stage, line of therapy, histology, biomarker status, trial phase/type, cohort complexity, local-site availability, and trial-data completeness. Include realistic negative controls and paired counterfactuals that alter only one clinical fact. Do not tune rules on the held-out test split.

Vignettes must be synthetic or governance-approved and de-identified. Maintain a separate development set for error analysis and lock the final test set before the last system revision.

## Independent annotation and adjudication

Each pair receives two blinded labels:

1. a GU oncologist;
2. an experienced clinical-research coordinator or second qualified oncology reviewer.

A separate GU oncology adjudicator resolves disagreements. Reviewers see the frozen patient vignette, complete current protocol/cohort text, provenance, and annotation manual; they do not see system output or the other reviewer's answer during independent review.

Use [annotation-tool.html](annotation-tool.html) in separate sessions. The selected role is locked when a file is imported, independent-review sessions reject files containing prior annotations, and only the adjudicator accepts a correctly merged two-review artifact:

1. Reviewer A selects `Independent reviewer A`, enters a pseudonymous reviewer ID, imports the worklist, completes every pair, and exports an artifact.
2. Reviewer B independently repeats this from the original worklist.
3. Merge artifacts only after both reviews are locked:

   ```bash
   node validation/merge-annotations.js benchmark-worklist.json reviewer-a.json reviewer-b.json merged-for-adjudication.json
   ```

4. Compute agreement before adjudication:

   ```bash
   node validation/annotation-agreement.js merged-for-adjudication.json
   ```

5. The adjudicator imports the merged file, reviews disagreements, records a final label and rationale, and exports the adjudication artifact.

Report percent agreement, quadratic-weighted kappa for ordinal cohort relevance, Gwet's AC1, and nominal Krippendorff alpha. Agreement below `0.70` requires clarification of the manual and repeat annotation on affected categories. Agreement of at least `0.80` is the target for a stable benchmark. Agreement is descriptive and does not remove the need for adjudication.

## Required system-output fields

Populate a copy of [benchmark-v1.template.json](benchmark-v1.template.json). Each case must include:

- `caseId`, subgroup fields, and adjudicated `goldCohorts` with graded relevance;
- exhaustive `candidateCohortIds`, final `rankedCohortIds`, and optional `rankedResults`;
- `priorityResults`, including `goldRelevant`, `hasCriticalNotModeled`, and `lowQualityTrial`;
- criterion rows containing gold/predicted state, unknown reason, criticality, hard-exclusion gold/prediction, and tags such as `numeric`, `temporal`, `negation`, `contradiction`, and `cohort_scope`;
- sentinel-failure count, measured registry-ingestion delay, and the prespecified agreement statistic.

If a ranker emits a probability, it must mean **cohort relevance**, never eligibility. Probability output is optional and must be evaluated out of sample.

Run the locked analysis with:

```bash
node validation/benchmark-runner.js validation/benchmark-v1.json > validation-results.json
```

The command exits nonzero for `NO_GO`, including whenever a required metric is missing, so it can be used as a deployment/CI gate.

The runner reports candidate sensitivity and false-negative rate, Recall@5/10/20/50, macro precision, NDCG@10/20, MRR, omitted cohorts, number needed to review, per-state criterion precision/sensitivity/specificity/F1, hard-exclusion errors, numeric/temporal/negation/contradiction/cohort-scope performance, coverage, abstention, selective error, subgroup recall, and optional Brier/ECE relevance calibration.

## Prespecified go/no thresholds

All checks must be evaluable and all must pass:

| Measure | Required value |
| --- | ---: |
| Macro Recall@50 | `>= 0.98` |
| Lower 95% CI for candidate recall | `>= 0.95` |
| Macro Recall@10 | `>= 0.95` |
| Recall@10 in every reported subgroup | `>= 0.90` |
| Unsafe hard-exclusion point estimate | `<= 0.005` |
| Unsafe hard-exclusion upper 95% CI | `< 0.02` |
| Critical violated-criterion sensitivity | `>= 0.97` |
| Critical false-satisfaction rate | `<= 0.01` |
| Negation sensitivity | `>= 0.95` |
| Temporal-window accuracy | `>= 0.95` |
| Contradiction sensitivity | `>= 0.95` |
| Precision of the priority-review queue | `>= 0.90` |
| Priority results with critical `NOT_MODELED` | `0` |
| Priority results with low-quality trial data | `0` |
| Prespecified inter-rater agreement | `>= 0.80` |
| Sentinel failures | `0` |
| Maximum registry ingestion delay | `<= 24 hours` |

Any missing metric is a no-go. Any sentinel failure, unsafe ungrounded exclusion, priority result with an unmodeled critical criterion, priority result from low-quality trial data, leakage of patient text into telemetry, or stale review applied to changed protocol text is an automatic no-go regardless of average performance.

Thresholds are engineering safety gates proposed for an initial pilot; they are not established regulatory standards and must be approved by the project's clinical/governance leadership.

## Prospective silent evaluation

Only after the locked retrospective benchmark passes, run a silent study in at least two clinical settings. The initial practical target is at least 200 encounters, followed by a formal power calculation based on expected miss and override rates.

- Keep output hidden from treating teams and make no change to care.
- Capture the trials clinicians actually considered, later protocol/site findings, false negatives, abstentions, overrides, and time-to-review.
- Conduct weekly blinded adjudication of misses and unsafe outputs.
- Prespecify stopping rules for any unsafe hard exclusion, sentinel failure, privacy incident, systematic subgroup miss, or data-drift event.
- Use only aggregate, allowlisted telemetry. [safety-dashboard.html](safety-dashboard.html) rejects known patient-level fields.

An interactive physician pilot begins only after retrospective and silent-stage gates pass, with approved protocol, IRB/privacy determination as applicable, monitoring ownership, incident response, rollback, and site-verification procedures.

## Drift and curator controls

Compare immutable catalog snapshots with:

```bash
python3 production_ready_pipeline/catalog_drift.py before.json after.json --fail-on-unreviewed-change
```

Human cohort/criterion reviews conform to `schemas/cohort-review.schema.json` and are dry-run by default:

```bash
python3 production_ready_pipeline/apply_curator_review.py review.json --catalog data/trials.json
python3 production_ready_pipeline/apply_curator_review.py review.json --catalog data/trials.json --output reviewed-trials.json --write
```

Reviews are bound to the raw-record hash and registry version. A curator may approve cohort structure and modeled extraction; only a clinician may correct a clinical predicate, change criticality, or activate `clinician_reviewed` status. No model proposal is auto-applied.

## Model-assisted research

`js/model-assisted-prescreen.js` is disabled by default. An injected provider requires immutable model and validation versions. Model output must have exact source offsets, passes deterministic contract validation, is marked as a proposal, cannot decide eligibility or hard exclusion, and requires clinician/curator review. Active-learning queues reject raw narratives and patient facts.

FHIR and CDISC helpers in `js/interoperability.js` are lossless research adapters around the authoritative internal AST. They are not certified implementation-guide conformance, production EHR integration, or regulatory submission tooling.

## What remains external

The repository implements the benchmark schema, blinded annotation workflow, agreement analysis, metric runner, thresholds, drift checks, aggregate telemetry, and review gates. It cannot itself supply qualified annotators, approved real-world data, adjudication, statistical power analysis, IRB/privacy determinations, multi-site operations, or prospective evidence. Those are mandatory external work, not optional software tasks.
