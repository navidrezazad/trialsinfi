# Scientific Review Brief: GU Oncology Patient-to-Trial Search Engine

> Historical note: this file is the pre-implementation snapshot supplied to the independent GPT-5.6 Pro review. It describes the old matcher and is retained as an audit artifact; current behavior is documented in `SCIENTIFIC_PRESCREEN_ARCHITECTURE.md` and `PATIENT_SEARCH_GUIDE.md`.

## Objective

Review the attached deterministic patient-to-clinical-trial search engine and propose a scientifically rigorous path to improve it substantially. The system is intended to help physicians identify potentially relevant Southern California genitourinary oncology trials. It must remain a triage and decision-support tool, not claim final protocol eligibility.

Please inspect the attached code and taxonomy files closely. Do not give only generic product advice. Identify concrete algorithmic failure modes, recommend an improved architecture, and provide an implementable validation plan.

## Current System

- Browser-side deterministic parser converts a free-text patient description into structured clinical axes.
- Deterministic matcher uses disease-setting taxonomy IDs plus cancer-specific rules.
- Supported cancers: prostate, bladder/urothelial, kidney/RCC, and testicular/GCT.
- Results are divided into `Strong match` and `Possible match`.
- Missing query facts generally generate verification flags; explicit conflicts generally exclude a trial.
- Trial records are periodically imported from ClinicalTrials.gov and enriched by an upstream NCCN-oriented classifier and AI-extracted structured axes.
- The checked local catalog snapshot contains 346 recruiting records, including 196 records for the four supported cancer groups.
- A JavaScript smoke suite currently has 125 passing assertions, mostly against synthetic trials.

## Important Observed Risks To Investigate

1. **Confidence semantics**
   - `Strong match` is currently equivalent to `flags.length === 0`.
   - Lack of recognized requirements or missing trial-side structured data can therefore create a strong match without enough positive evidence.
   - A broad query such as `prostate cancer` returned four strong matches in a direct catalog test.

2. **Protocol-specific constraints are simplified incorrectly**
   - Washout detection recognizes that a protocol has a washout rule but resolves it whenever the patient interval is over 14 days.
   - A synthetic trial requiring four weeks was labeled strong for a patient only 21 days from systemic therapy.
   - Generic phrases such as `labs normal` or `adequate organ function` may also be treated as resolving trial-specific numeric requirements.

3. **Missing structured trial data can cause silent false negatives**
   - In the checked snapshot, 63 of 196 supported-cancer records lack disease-setting IDs.
   - When a query has disease-setting IDs, trials without an overlapping ID are excluded rather than retained for manual review.

4. **Upstream classification errors propagate into matching**
   - Catalog record NCT06022822 is a localized radical-prostatectomy Urolithin A study but is labeled `CRPC — Metastatic, Post-ARPI` with `HIGH` confidence.
   - A likely cause is the case-insensitive taxonomy pattern `TheraP.*trial`, which can match ordinary text such as `therapy ... trial`.
   - Classification confidence currently affects sorting only weakly and does not prevent a strong-match badge.

5. **Free text is actually a constrained command grammar**
   - Many useful phrases are recognized, but age, medications, comorbidities, exact lab values, measurable disease, CNS disease, infections, prior malignancy, and many protocol exclusions are not deeply modeled.
   - Contradictory text can be accepted without an explicit conflict warning.
   - Parsed chips show recognized facts but do not reveal important text that was ignored.

6. **Validation is insufficient for clinical trust**
   - Current tests are valuable regressions but predominantly synthetic.
   - There is no labeled real-trial/realistic-vignette benchmark, prospective physician evaluation, calibrated uncertainty analysis, or tracked false-negative review.

7. **Privacy and workflow**
   - Matching itself is client-side, but the raw patient narrative is persisted in browser `localStorage`.
   - The public input says `Describe the patient in plain language` without a prominent de-identification warning.

## Questions The Review Should Answer

### A. Scientific problem formulation

- What is the correct formal task: cohort retrieval, protocol relevance ranking, eligibility pre-screening, constraint satisfaction, or a multi-stage combination?
- What claims can the system safely make at each stage?
- What failure costs should dominate, particularly false negatives versus false positives?

### B. Recommended architecture

Propose a concrete target architecture, potentially including:

- high-recall candidate generation;
- normalized trial/cohort representation;
- three- or four-valued constraint logic (`satisfied`, `violated`, `unknown`, `not modeled`);
- patient-fact extraction with negation, temporality, and contradiction detection;
- deterministic hard exclusions separated from soft ranking signals;
- uncertainty and data-quality propagation;
- optional LLM use only where scientifically defensible, with deterministic verification and provenance;
- human confirmation of parsed patient facts before matching.

Explain whether a hybrid rules + retrieval + language-model system would outperform the current approach and how to constrain it safely.

### C. Trial representation and extraction

- Recommend a schema for trial cohorts, inclusion/exclusion criteria, temporal windows, numeric lab thresholds, permitted/prohibited prior therapies, disease state, histology, biomarkers, sites, and recruitment status.
- Address multiple cohorts/arms within one NCT record.
- Recommend how to preserve source spans and distinguish ClinicalTrials.gov facts, manually curated facts, NCCN inference, and model-extracted facts.
- Propose quality gates that prevent incomplete or low-confidence trial records from being labeled strong.

### D. Matching, ranking, and calibration

- Define explicit equations or pseudocode for candidate generation, constraint evaluation, ranking, and confidence.
- Recommend how missing patient facts and missing trial facts should differ.
- Recommend clinically appropriate result labels in place of, or as a rigorous definition of, `Strong` and `Possible`.
- Describe how site proximity, phase, trial type, and current recruitment should affect ranking without masking eligibility uncertainty.
- Discuss calibration methods and whether predicted probabilities are appropriate.

### E. Physician-facing input and output

- Should free text remain the primary input, become an optional accelerator, or be paired with a structured form?
- Design a confirmation step that lets a physician correct parsed facts quickly.
- Specify how to display matched criteria, conflicts, unknowns, unmodeled text, data provenance, and next actions.
- Recommend privacy-preserving state handling and clear de-identification language.

### F. Scientific validation

Provide a study and benchmark design using real current trials and realistic de-identified vignettes, including:

- sampling strategy and cohort construction;
- expert annotation protocol and number/type of annotators;
- adjudication and inter-rater agreement;
- gold labels at trial relevance and criterion levels;
- negative controls, adversarial cases, temporal drift, and site-status changes;
- primary metrics such as sensitivity/recall, Recall@K, false-negative rate, precision, NDCG, coverage, abstention quality, and calibration error;
- subgroup reporting by cancer type, disease state, trial type, and data completeness;
- acceptable safety thresholds before pilot deployment;
- prospective silent evaluation and monitored physician pilot design.

Ground recommendations in current primary research, standards, and authoritative sources where possible. Clearly distinguish evidence-backed recommendations from engineering judgment.

### G. Implementation roadmap

Return a prioritized roadmap with:

1. immediate correctness/safety fixes;
2. near-term architecture changes;
3. validation infrastructure;
4. longer-term research improvements.

For each item, include expected benefit, clinical risk reduced, implementation difficulty, required files/modules, and a testable acceptance criterion. Include concrete code-level recommendations, pseudocode, or patch sketches for the highest-priority changes.

## Desired Deliverable

Please produce a candid technical/scientific review with:

- an executive verdict;
- a failure-mode analysis;
- a proposed target architecture;
- matching/confidence semantics;
- schema recommendations;
- a rigorous validation protocol;
- a prioritized implementation plan;
- specific critique of the attached code;
- citations/links to primary or authoritative sources where external claims are made.

Optimize for a system that is scientifically auditable, conservative about uncertainty, high-recall for plausible trials, and practical for physicians to use.
