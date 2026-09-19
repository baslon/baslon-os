# M4-02A — H4 Live-Model Validation Record

**Status:** COMPLETED — PASSED (accepted by the Product Owner, 19 September 2026)\
**Item:** Architectural review item H4, the non-blocking pre-rebuild validation from the M4-02A handoff (`docs/m4-02a-architectural-review-handoff.md`)\
**Purpose:** confirm that the live model follows the `evidence_extractor_v6` and `evidence_extractor_v7` precision rules, and that the deterministic validator behaves correctly on real model output, before the Baslon Digital Business is rebuilt.

---

## Test Conditions

| | |
|---|---|
| Date | 19 September 2026, about 15:10 UTC |
| Model | `gpt-5.6-luna` (OpenAI Responses API, strict JSON schema, `store: false`) |
| Prompts | `evidence_extractor_v6` (standard) and `evidence_extractor_v7` (question context), as merged in M4-02A |
| Synthetic Business | `Baslon OS Synthetic Smoke Test` (`43445cd1-135b-4e48-beba-ec3c3403ab04`) |
| Calls | 7 live model calls: 3 × v6 and 4 × v7 |
| Validation | the application's own `validateEvidenceExtractionOutput`, unchanged |

**Data and safety:**

- **Fictional input only.** All input was fictional and labelled `SYNTHETIC TEST DATA` (a fictional cleaning business, "Harbour Lane Cleaning").
- **Baslon Digital was untouched.** The active Baslon Digital Business (`74230122-26a9-4268-92c0-0fe963d1ee8f`) was not used. It remains `active` in `GAP_RESOLUTION_REQUIRED`.
- **No database rows were created.** The check called the production extractor adapter and validator directly, outside the application's persistence path. Afterwards, `baslon_os` showed no rows created since the check began in any of: `source_submissions`, `evidence_extraction_runs`, `evidence_proposals`, `evidence_review_sessions`, `business_state_snapshots`, `claims`, `evidence`, `metrics`, `analysis_runs` or `workflow_transitions`. No Source Submission, extraction run, review session or snapshot exists for this check.
- **No repository change** was made to run it.

---

## v6 — Standard Extraction (3 runs of the same intake)

Intake (one paragraph):

> SYNTHETIC TEST DATA — fictional business "Harbour Lane Cleaning" for Baslon OS testing only. We have 14 regular contract clients. Revenue last year was about £420k. Recurring monthly contracts bring in roughly £28k a month. I think around 30% of new enquiries come from referrals. We usually quote between £2,000 and £3,500 for an end-of-tenancy deep clean. We employ twelve cleaners and 3 supervisors. Our website brought in 57 enquiries last quarter. We probably lose 2–3 contracts a year. Staff turnover is more than 20% but we don't track it precisely. The owner works a five-day week, roughly 50 hours.

Proposed precision classifications were identical in all three runs:

| Source wording | Rule tested | Proposed | Correct |
|---|---|---|---|
| "14 regular contract clients" | exact | exact 14 | ✓ |
| "about £420k" | approximate | approximate 420,000 | ✓ |
| "roughly £28k a month" | approximate | approximate 28,000 | ✓ |
| "I think around 30%" | estimate language | estimate 30 | ✓ |
| "between £2,000 and £3,500" | range, both bounds | range 2,000–3,500 | ✓ |
| "twelve cleaners" | written number (M4-10) | exact 12 | ✓ |
| "3 supervisors" | exact | exact 3 | ✓ |
| "57 enquiries" | exact | exact 57 | ✓ |
| "probably lose 2–3 contracts" | range with estimate language | range 2–3 | ✓ |
| "roughly 50 hours" | approximate | approximate 50 | ✓ |
| "more than 20%" | a limit is not a value | text only, no number | ✓ |
| "five-day week" | compound number word stays text | text in runs 1–2; **5 in run 3** | ✗ in run 3 |

In every run, each Metric carried the same precision as its source Evidence. No range was collapsed to a bound or midpoint, and no approximate or estimated value was labelled exact.

---

## v7 — Question-Context Isolation (2 cases × 2 runs)

| Case | Question (context only) | Answer (evidence) | Result, both runs |
|---|---|---|---|
| Question implies approximation | "Roughly how many active contract clients does the business have?" | "…We have exactly 14 active contract clients, and roughly 6 one-off jobs a month." | exact 14, approximate 6 |
| Question names a figure | "Was revenue last year £420,000?" | "…It was about £400k, not £420k — the accounts aren't finished." | approximate 400,000; the question's £420,000 never became a number |

Precision came only from the answer's wording. "Roughly" in the question did not make an exact answer approximate, and a figure in the question did not become Evidence. In every run, each Metric carried the same precision as its source Evidence.

---

## Outcome

| | Runs | Accepted | Rejected |
|---|---|---|---|
| v6 | 3 | 2 | 1 |
| v7 | 4 | 4 | 0 |
| **Total** | **7** | **6** | **1** |

**The rejected run (v6, run 3):**

- The model proposed Evidence and a linked Metric with the value 5 ("days per week") from "The owner works a five-day week". This breaks the aligned M4-10 rule: a number word inside a compound description stays qualitative.
- The deterministic validator rejected the run as designed: `numeric value 5 is not explicitly present in its source excerpt`, for both the Evidence and the Metric.
- Because validation is all-or-nothing (B-15), the run's other items were discarded too, although every precision classification in it was correct.
- No invalid value could have reached review or canonical state. In the application, the existing retry path would make a fresh model call.

**Conclusion: H4 PASSED.**

- Precision classification was correct in every run.
- Question context stayed non-evidentiary.
- Linked Metric/Evidence precision matched.
- The validator rejected the one written-number violation.
- The pre-rebuild live-model validation requirement is satisfied.

**Limitations and follow-up:**

- The observed rejection rate (1 in 7 calls) comes from a very small sample and is **not statistically meaningful**. It shows that such rejections can occur, not how often.
- The `five-day → 5` compound-number behaviour is recorded as a **non-blocking backlog observation** (findings register B-31). It does not reopen M4-02 or M4-10: the validator enforced the rule correctly.
- **No prompt, model, validator or code change** was made as a result of H4. `evidence_extractor_v6`/`v7` and `validateEvidenceExtractionOutput` are unchanged.

---

## Not Done

- the Baslon Digital Business was not rebuilt or archived;
- M4-02B and Phase 1 Diagnosis have not started.
