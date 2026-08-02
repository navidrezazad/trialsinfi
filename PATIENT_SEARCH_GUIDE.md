# Physician Patient-to-Trial Search Guide

The patient search is a conservative protocol-review aid for prostate, bladder/urothelial, kidney/RCC, and testicular/GCT trials. It retrieves plausible trial cohorts and explains what is known, unknown, conflicting, or not modeled. It does **not** determine eligibility, recommend treatment, enroll a patient, or replace review of the current protocol and confirmation with the study site.

## Before entering a case

Use only a de-identified clinical summary. Do not enter a name, medical-record number, date of birth, address, phone number, email address, or another direct identifier. The browser checks for common identifiers and does not deliberately persist the raw narrative in local or session storage, but de-identification remains the physician's responsibility.

## The confirmation-first workflow

1. Enter a concise clinical description.
2. Review every extracted fact and its exact source phrase.
3. Confirm, correct, or reject each fact. Matching remains disabled until this review is complete.
4. Resolve any displayed contradiction and inspect text the parser did not model.
5. Run retrieval, then review cohort criteria, data quality, provenance, and site-status evidence.
6. Verify the current protocol and contact the site before referral.

An extracted fact is a proposal, not a fact merely because the parser found it. A confirmed patient fact may be compared only with a modeled protocol criterion. Missing patient information remains `UNKNOWN`; protocol text the system cannot safely represent remains `NOT_MODELED`.

## What to include

Use this order when practical:

`[age/sex if relevant] + [cancer and current disease setting] + [histology/risk] + [received therapies and dates] + [progression events] + [biomarkers/assays] + [ECOG] + [exact labs with units/date] + [site or phase preferences]`

Example:

`72-year-old man with mCRPC. Progressed on enzalutamide; last dose 2026-06-01. No prior docetaxel. BRCA2 pathogenic alteration. PSMA-positive PET. ECOG 1. Labs on 2026-08-01: hemoglobin 9.5 g/dL, ANC 1.5 x 10^9/L, platelets 125 K/uL, CrCl 55 mL/min.`

Use explicit statements such as:

- `received docetaxel` when exposure is known;
- `progressed on docetaxel` only when progression on that agent is documented;
- `no prior cabazitaxel` when absence of exposure is known;
- `considering pembrolizumab` for a planned therapy—the system must not count this as prior exposure;
- `last systemic therapy 21 days ago` or an exact administration date;
- `hemoglobin 9.5 g/dL on 2026-08-01` rather than `labs normal`.

Generic statements such as `advanced disease`, `many prior therapies`, `adequate labs`, or `good organ function` are retained for review but cannot satisfy a protocol-specific stage, sequence, or numeric threshold.

## Context matters

The parser distinguishes patient facts from several unsafe contexts:

- `family history of prostate cancer` is not the patient's diagnosis;
- `cannot rule out brain metastases` is not a confirmed positive finding;
- a possible, conditional, or hypothetical assertion cannot satisfy or violate a criterion;
- planned treatment is not prior treatment;
- `received` and `progressed on` are separate events;
- negative and positive assertions about the same proposition create a visible contradiction.

When an event date, assay detail, or current value is missing, the system asks for it rather than inventing a default. In particular, there is no universal 14-day washout and a phrase such as `labs normal` never proves a numeric protocol threshold.

## Result tiers

Results are review queues, not eligibility labels:

- **Priority for protocol review** — positive disease evidence is present, critical modeled criteria do not conflict, the cohort and critical criteria have the required human review, and current local recruitment evidence is available. This still is not an eligibility determination.
- **Potentially relevant — clarify patient evidence** — the disease context is plausible, but one or more important patient facts remain unknown or uncertain after review.
- **Manual review — trial data incomplete** — cohort boundaries, critical criteria, or trial-side data are incomplete, ambiguous, or not human reviewed.
- **Modeled conflict** — a modeled criterion conflicts with confirmed facts. The record remains visible for audit. Only a current, clinician-reviewed hard criterion backed by confirmed, noncontradictory patient facts may activate the hard-exclusion gate.
- **Disease-context retrieval only** — the record was retrieved from the same cancer context without enough positive evidence for a more specific queue.

Ranking inside a tier may use lexical relevance, disease concepts, location, phase, and other preferences. The interface renders ranked groups in batches of 20 for review efficiency while keeping every retained cohort accessible. Ranking never converts an unknown criterion into a satisfied one and never hides trial-data uncertainty.

## Criterion states

Each modeled criterion is evaluated independently:

- `SATISFIED` — confirmed patient evidence satisfies the represented predicate;
- `VIOLATED` — confirmed patient evidence contradicts it;
- `UNKNOWN` — required patient evidence is missing, unconfirmed, stale, contradictory, uncertain, or uses incompatible units;
- `NOT_MODELED` — the protocol statement cannot be represented safely by the current schema;
- `NOT_APPLICABLE` — the criterion does not apply to that cohort or branch.

The interface shows the protocol source text, normalized predicate, supporting patient fact IDs, provenance, and the next question when available.

## Trial and site data quality

One NCT record can contain multiple arms or cohorts with different eligibility. Until a curator maps those boundaries, the catalog uses an explicit `Unsegmented enrollment pathway` and sends the result to manual review. Model-generated cohort or criterion suggestions are proposals only and cannot be applied automatically.

Historical catalog locations do not contain reliable per-site recruitment timestamps. Such locations are labeled unknown or stale. A study-level `Recruiting` status must not be interpreted as proof that a particular Southern California site or cohort is open. Confirm directly with the site.

## Examples

### Prostate

`mCRPC. Progressed on enzalutamide on 2026-06-01. No prior docetaxel. BRCA2 pathogenic alteration. PSMA-positive PET. ECOG 1.`

### Bladder/urothelial

`BCG-unresponsive NMIBC with CIS after adequate BCG; recurrence documented 2026-05-15.`

`Metastatic urothelial carcinoma after platinum. FGFR3 susceptible alteration. ECOG 1.`

### Kidney/RCC

`Metastatic clear-cell RCC, IMDC intermediate risk. Progressed on nivolumab plus cabozantinib; last dose 2026-06-20.`

### Testicular/GCT

`NSGCT after first-line BEP with residual mass 2.4 cm, markers normal, no prior HDCT.`

## Scientific limitations

- The automatically migrated catalog is intentionally incomplete: unreviewed free-text criteria and cohort boundaries remain `NOT_MODELED` or manual-review items.
- Deterministic extraction covers selected disease axes, age/sex, ECOG, exact laboratory thresholds, and selected temporal windows; it does not model every comorbidity, medication, imaging rule, reproductive requirement, or protocol exception.
- Optional language-model extensions are disabled by default, require an immutable model version and held-out validation artifact, and may only propose source-spanned structures for human review.
- No model score is presented as a probability of eligibility.
- Clinical use requires the prespecified retrospective benchmark, external double annotation/adjudication, and a prospective silent evaluation described in `validation/README.md`.

The safe interpretation of every result is: **a cohort worth reviewing, with explicit evidence and unresolved work—not a verdict about the patient.**
