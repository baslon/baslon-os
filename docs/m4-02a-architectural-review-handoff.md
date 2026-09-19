# M4-02A Architectural Review Handoff
## Numeric Precision Foundation

**Prepared for:** Solution Architect\
**Prepared by:** Engineer (Claude Code)\
**Date:** 19 September 2026 (final revision, after the architectural review decisions)\
**Brief:** Baslon OS — M4-02A Build Brief: Numeric Precision Foundation (final)\
**Decision:** `docs/baslon-os-m4-02-numeric-precision-architecture-decision.md` (D1–D8 approved, plus B-29)\
**Completion report:** `docs/m4-02a-completion-report.md`

---

## Review Outcome Record

| Item | Status |
|---|---|
| Foundation write-path precision (H6) | **RESOLVED**: fixed and approved |
| H1: Metric/Evidence precision at human review | **RESOLVED**: option (b) implemented |
| H3: existing v2 Evidence Coherence analyses | **APPROVED**: they remain current until a new snapshot produces a new analysis |
| H4: live-model validation of v6/v7 | **NON-BLOCKING PRE-REBUILD VALIDATION** |
| H2, H5, H7, H8 | Recorded; no action required for commit |

No architectural blocker remains open. M4-02A is ready for the commit decision.

---

## Repository State

- Branch: `claude/milestone-4`, level with `origin/claude/milestone-4`.
- HEAD: `a1222a1` (Add PostgreSQL test safety and commit authority rules to AGENTS.md).
- Implementation baseline: `4fc636f`. The commits since then are documentation only.
- M4-02A is **uncommitted** in the working tree:
  - 40 modified tracked files (1,022 insertions, 252 deletions), plus the revised completion report;
  - 9 new implementation and test files;
  - this handoff (untracked).
- Nothing is staged.
- Migration `0006` is applied to `baslon_os_test` only. `baslon_os` still has 6 migrations (re-checked for this revision).

---

## A. Schema and Migration

`drizzle/0006_numeric_precision.sql` is additive:

- a `numeric_precision` enum: `exact | approximate | estimate | range | unspecified`;
- `evidence.value_precision` (NOT NULL, default `unspecified`), plus `value_lower` and `value_upper` (`numeric(20,4)`);
- `metrics.numeric_precision` (NOT NULL, default `unspecified`), plus `numeric_lower` and `numeric_upper`;
- `metrics.numeric_value` becomes nullable, for ranges only (D1);
- two CHECK constraints:
  - `evidence_value_precision_check`: a range has both bounds, lower ≤ upper, and no single value; `exact`, `approximate` and `estimate` need a value and no bounds; `unspecified` has no bounds, and its value may be null for qualitative Evidence (D2);
  - `metrics_numeric_precision_check`: a range has both bounds, lower ≤ upper, and no value; every other precision needs a value and no bounds.

**Assessment:**

- No earlier migration is edited, and no row is updated.
- Adding a column with a constant default fires no row triggers, so the Evidence immutability triggers are not engaged.
- Same-Business composite foreign keys are unchanged.
- Permanent Delete needs no change because no table is added.
- On `baslon_os_test`, all 719 Evidence and 665 Metric rows kept identical original column data (checksums before and after). All read `unspecified`.

The migration is unchanged by the review corrections.

---

## B. Historical Compatibility (No Retrofit)

There are three layers, and none is rewritten:

1. **Canonical rows:** read `unspecified` through the column default.
2. **Stored proposals** (immutable): `readStoredEvidenceProposal` and `readStoredMetricProposal` read the pre-precision shape as `unspecified`, with null bounds. Qualitative Evidence keeps null precision. Nothing is inferred from the wording.
3. **Snapshots** (immutable JSON): the Evidence Coherence projection reads missing precision as `unspecified`.

The review service compares normalised originals with the correction, so a no-op edit of a legacy proposal does not count as a material correction.

---

## C. Extraction Contract and Prompts

- New prompt versions `evidence_extractor_v6` (standard) and `evidence_extractor_v7` (question context) are used for new runs. The v4/v5 text is retained unchanged (identical SHA-256 hashes).
- Proposals carry Evidence `valuePrecision`, `valueLower` and `valueUpper`, and Metric `numericPrecision`, `numericLower` and `numericUpper`.
- The extractor may propose only `exact`, `approximate`, `estimate` or `range`, never `unspecified`.
- A number stated only as a limit ("more than 30") is kept as text.
- **M4-10 rule, identical in prompt and validator:**
  - digits count, optionally with £, $, € or %, a k suffix, or an m suffix after a currency symbol;
  - whole-number words from zero to ninety-nine count;
  - a number word is not converted inside a compound ("three-day"), after approximation words ("about ten"), or above ninety-nine ("a hundred").
- v7 adds that precision wording must come from the human answer, never from the question.

---

## D. Deterministic Validation

`numericPrecisionIssue` classifies each occurrence of the proposed number in the cited excerpt from the words immediately next to it (30 characters before, 14 after, anchored patterns).

| Precision | Accepted only when |
|---|---|
| `exact` | a plain occurrence exists and the excerpt has no estimate language |
| `approximate` | approximation words sit next to the number |
| `estimate` | the excerpt has estimate language, and the number occurs plainly or approximately |
| `range` | both bounds appear in one range expression (`10–15`, `10 to 15`, `between 10 and 15`) |

Other checks:

- A Metric must carry the same precision as its numeric source Evidence (values may differ).
- Excerpts must be substrings of the human-supplied source text, which keeps question text from becoming evidence.
- Any failure rejects the whole extraction run (B-15). Precision is never silently changed.

---

## E. Human Review

- Before a decision, the review card shows the value or range with "Precision: …". Legacy proposals show "Unspecified".
- Correction fields add a Precision selector (all five values) and lower and upper bound inputs.
- Per D4, the reviewer can choose any precision without a wording check. Corrected values and bounds must still appear in the original excerpt, and the shape must be valid.
- A cleared Metric value is parsed as missing, not zero (B-22).
- **Linked precision (H1, option b):** when a Metric's `sourceEvidenceRef` points to numeric Evidence (a single value or a range), the Metric must end review with the same precision that Evidence ended review with. This applies whether each was accepted or corrected, and is enforced in `EvidenceReviewService` before any canonical write.
  - The reviewer can still change precision, but must change both.
  - Values and bounds may differ, because the existing contract does not require them to be equal.
  - Range semantics are unchanged: a linked range Metric must be a range, with its own valid bounds.
  - Unlinked Metrics, and Metrics linked to qualitative Evidence, are not constrained.
  - The Metric correction form explains the rule.
  - Evidence is always reviewed before its Metrics (existing dependency rule), so checking at Metric review is sufficient.

---

## F. Canonical Persistence, Snapshots and Evidence Coherence

- **Evidence Review:** accepted and corrected items persist precision and bounds. Qualitative Evidence is saved as `unspecified`.
- **Foundation repository** (`addEvidence` / `addMetric`): supplied precision and bounds are validated with the shared shape rule and persisted. Omitted precision becomes `unspecified`. This was the review's blocking correction, now approved.
- `createCanonicalSnapshot` stores whole rows, so new snapshots include precision and bounds automatically.
- Evidence Coherence uses input `evidence_coherence_input_v2` and prompt `evidence_coherence_v3`. Precision and bounds are in the projection and the hash. The prompt forbids treating `unspecified` as exact and forbids contradictions that depend on more precision than the values carry.
- Presentation never shows an approximate, estimated or range value as a bare exact number.

---

## G. Verification State (final)

| Gate | Result |
|---|---|
| Unit + integration | 25 files, 217 tests passed, with and without `TEST_DATABASE_URL` set |
| PostgreSQL 17.11 (`baslon_os_test`, verified by `current_database()`) | 12 files, 98 tests passed |
| TypeScript | Passed |
| ESLint | Passed, 0 warnings |
| Production build | Passed |
| `git diff --check` | Passed, tracked and new files |

M4-02A coverage:

- `tests/unit/numeric-precision.test.tsx` (22 tests);
- review integration tests in `tests/integration/evidence-review.test.ts`:
  - precision and range correction, persistence and snapshot inclusion;
  - a legacy proposal accepted as `unspecified`;
  - six linked-precision (H1) tests: matching succeeds; a mismatch is rejected (both a corrected Metric and an unchanged Metric against corrected Evidence); both corrected to `estimate`; both corrected to `approximate`; linked range stays consistent with differing bounds; unlinked Metrics and Metrics on qualitative Evidence are unaffected;
- `tests/fixtures/foundation-precision-scenarios.ts`: six Foundation write tests, run on PGlite and PostgreSQL;
- `tests/postgres/numeric-precision.postgres.test.ts`: 16 database tests (defaults, each CHECK rule by name, enum vocabulary, same-Business integrity, snapshot immutability, Permanent Delete).

The D8 helper `tests/helpers/pglite-migrations.ts` drives all nine PGlite suites from the Drizzle journal (B-21).

**Regression invariants:** Milestone 4A workflow, Add Information atomicity, archive-safe completion, stale-run recovery, latest-run review eligibility, transaction-scoped preconditions and module-scoped coherence are covered by the existing suites, which all pass.

---

## H. Decisions and Observations

1. **H1 — Metric/Evidence precision at human review. RESOLVED — option (b).** A linked Metric must end review with its numeric source Evidence's precision; values may differ. Implemented and tested as described in section E.

2. **H2 — Extraction compares precision only, not values.** Recorded. The decision document does not require equal values, and the v6 prompt matches the validator.

3. **H3 — Existing Evidence Coherence analyses. APPROVED.** Existing v2 Evidence Coherence analyses remain current until a new snapshot produces a new analysis. Run lookups for display and the `CONTINUE_WITH_GAPS` precondition stay scoped by module, not prompt version. The active Baslon Digital Business's Snapshot 2 v2 analysis therefore remains its current analysis. No code change.

4. **H4 — Live-model validation of v6/v7. NON-BLOCKING PRE-REBUILD VALIDATION.** Before rebuilding the Baslon Digital Business, run `evidence_extractor_v6`/`v7` against the live model on a synthetic Business. Record the precision classifications and the validation rejection rate. This does not block the M4-02A commit.

5. **H5 — `unspecified` covers two meanings** ("never established" and, for qualitative Evidence, "no number"), per D2. Recorded; the difference can be told from whether a value exists.

6. **H6 — Foundation write path ignored precision. RESOLVED** by the Foundation write-path fix (approved). `FoundationRepository.addEvidence` and `addMetric` now persist supplied precision and bounds, validate their shape, accept range Metrics, and default to `unspecified` only when no precision is supplied.

7. **H7 — Estimate language is checked across the whole excerpt.** Conservative: it can only reject, never upgrade. Recorded.

8. **H8 — Storage scale unchanged** (`numeric(20,4)`, B-10 kept open). Recorded.

---

## I. Engineer's Recommendation

**READY FOR COMMIT.**

All architectural review items are resolved, approved or recorded as non-blocking. The implementation meets the brief's Definition of Done:

- explicit precision on every canonical write path;
- approved vocabulary enforced in contracts, validation, review and the database;
- ranges preserved with both bounds;
- linked Evidence and Metric precision kept consistent through human review;
- historical records valid as `unspecified` with no retrofit;
- visible human approval of precision;
- versioned extractor and coherence contracts;
- M4-10 aligned;
- question context kept non-evidentiary;
- new snapshots carry precision and historical snapshots are unchanged;
- no diagnosis and no Evidence supersession;
- same-Business integrity and Permanent Delete intact;
- all gates passing.

**On the commit instruction**, the Engineer will commit M4-02A as one commit, with the supplied message and no push unless instructed.

**Next bounded tasks, each requiring separate approval:**

1. apply `0006` to `baslon_os`, then verify read-only that the active Baslon Digital Business's 12 numeric Evidence records read `unspecified` and still display correctly;
2. H4 pre-rebuild validation on a synthetic Business.

Nothing is staged or committed. `0006` has not been applied to `baslon_os`.
