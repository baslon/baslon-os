# Baslon OS — M4-02A Completion Report
## Numeric Precision Foundation

**Date:** 19 September 2026 (final revision, after the architectural review decisions)\
**Branch:** `claude/milestone-4`\
**Status:** Implemented and validated, with both architectural review corrections. Ready for the commit decision. Not committed or pushed.

---

## Revisions After Architectural Review

### 1. Foundation write path (H6) — approved

- **Cause:**
  - `FoundationRepository.addEvidence` and `addMetric` parse input through `evidenceInputSchema` and `metricInputSchema` (`src/domain/schemas.ts`), which had no precision fields. Zod strips unknown keys, so supplied precision and bounds were dropped and the row defaulted to `unspecified`.
  - `addMetric` also could not write a range.
- **Fix:**
  - Both schemas accept precision (all five values) and optional bounds, and validate the shape with the shared `numericShapeIssue` rule.
  - A Metric still needs a value unless it is a range.
  - Omitted precision defaults to `unspecified`.
  - The repository persists the bounds, and a range Metric's value as null.

### 2. Linked Metric/Evidence precision at human review (H1, option b)

- **Rule:** when a Metric's `sourceEvidenceRef` points to numeric Evidence (a single value or a range), the Metric must end human review with the same precision that Evidence ended review with, whether each was accepted or corrected.
- **Enforcement:** in `EvidenceReviewService`, before any canonical write:
  - the Evidence's final precision is read from its correction if corrected, otherwise from its stored proposal (legacy proposals read as `unspecified`);
  - a mismatch is rejected with a message naming both precisions.
- **Human authority:** the reviewer can still correct precision, but must correct both records.
- **Values:** they may differ, because the existing contract does not require equal values.
- **Ranges:** a linked range Metric must be a range, with its own valid bounds.
- **Not constrained:** unlinked Metrics, and Metrics linked to qualitative Evidence.
- **UI:** the Metric correction form explains the rule.
- **Why checking at Metric review is enough:** Evidence is always reviewed before its Metrics (existing dependency rule).

Neither revision adds retrofit, Evidence supersession or diagnosis code, and neither applies `0006` to `baslon_os`.

---

## Baseline

- **Implementation baseline:** `4fc636f` (Add M4-02 numeric precision architecture decision).
- **Current HEAD:** `a1222a1`. Commits since the baseline are documentation only.
- **Branch:** `claude/milestone-4`, level with `origin/claude/milestone-4`.
- **Working tree:** uncommitted M4-02A changes only:
  - 40 modified tracked files (1,022 insertions, 252 deletions), plus this report;
  - 9 new files;
  - the review handoff `docs/m4-02a-architectural-review-handoff.md` (untracked).
- Nothing is staged.

## Schema Design

- **Migration:** `drizzle/0006_numeric_precision.sql`. It adds one database enum, `numeric_precision`, with the values `exact | approximate | estimate | range | unspecified`.
- **Evidence:** `value_precision` (required, default `unspecified`), plus `value_lower` and `value_upper` (`numeric(20,4)`).
- **Metrics:** `numeric_value` becomes nullable (for ranges only), plus `numeric_precision` (required, default `unspecified`), `numeric_lower` and `numeric_upper`.
- **Two database checks** (`evidence_value_precision_check` and `metrics_numeric_precision_check`) enforce the shape:
  - a range has both bounds, lower ≤ upper, and no single value;
  - other precisions have no bounds;
  - a Metric always has either a single value or a range.
- **Why this is the smallest safe design:**
  - it only adds columns to the two existing tables, with no new table and no change to earlier migrations;
  - adding a column with a fixed default updates no rows and fires none of the immutability triggers;
  - same-Business links and Permanent Delete are unchanged.

The migration is unchanged by the review revisions.

## Historical Compatibility

- Existing rows read as `unspecified` through the column default. No row is updated and nothing is inferred from its wording.
- Stored proposals can't be changed. Old-format proposals are read as `unspecified` by `readStoredEvidenceProposal` and `readStoredMetricProposal`; qualitative Evidence keeps no precision.
- Historical snapshot data is never rewritten. When Evidence Coherence reads a snapshot, a missing precision counts as `unspecified`.
- Foundation callers that supply no precision (all existing callers) still write `unspecified`.

## Extraction

- **New prompt versions:** `evidence_extractor_v6` (standard) and `evidence_extractor_v7` (question context). The v4/v5 text is unchanged, confirmed by identical SHA-256 hashes.
- **Contract:** proposals carry Evidence `valuePrecision`, `valueLower` and `valueUpper`, and Metric `numericPrecision`, `numericLower` and `numericUpper`. The extractor may only propose `exact`, `approximate`, `estimate` or `range`, never `unspecified`.
- **Ranges** keep both bounds and are never collapsed to one number.
- **Limits** such as "more than 30" stay as text, with no number.
- **M4-10 written-number rule**, identical in the prompt and the validator:
  - digits count, optionally with £, $, € or %, a k suffix, or an m suffix after a currency symbol;
  - whole-number words from zero to ninety-nine count;
  - a number word is not converted when it is part of a compound ("three-day"), follows approximation words ("about ten"), or is larger than ninety-nine ("a hundred").

## Validation

The validator (`numericPrecisionIssue` in `src/ai/evidence-extractor/validation.ts`) checks each proposed precision against the wording next to the number in the cited excerpt:

- **exact:** the number appears plainly, and the excerpt has no estimate language.
- **approximate:** approximation words sit next to the number (about, roughly, around, circa, nearly, -ish, or so…).
- **estimate:** the excerpt has estimate language (estimate, I think, probably…), and the number appears plainly or approximately.
- **range:** both bounds appear in one range expression (10–15, 10 to 15, between 10 and 15).
- **Question isolation:** excerpts must come from the human's answer, and precision wording in the question doesn't count; the v7 prompt says this explicitly.

Anything the validator can't ground is rejected, never silently changed. At extraction, a Metric must carry the same precision as the numeric Evidence it is taken from; human review now enforces the same rule (H1).

## Human Review

- The review card shows the value or range and "Precision: …" before any decision. Old-format proposals show "Unspecified".
- The reviewer can change the precision to any of the five values with no wording check (D4), and can correct range bounds.
- Corrected numbers must still appear in the excerpt, and the shape must be valid.
- A Metric taken from numeric Evidence must end review with that Evidence's precision (H1). Values may differ; unlinked Metrics are unaffected.

## Canonical Persistence

Both canonical write paths persist precision and bounds:

- **Evidence Review:** accepted and corrected items persist their precision and bounds, with linked Metric/Evidence precision kept consistent. Qualitative Evidence is saved as `unspecified`. A Metric correction treats a cleared field as missing rather than zero.
- **Foundation repository** (`addEvidence` / `addMetric`): supplied precision and bounds are validated and persisted; omitted precision becomes `unspecified`.

## Snapshot Behaviour

- **New snapshots** include precision and bounds automatically, for rows from either write path.
- **Evidence Coherence** uses input version `evidence_coherence_input_v2` and prompt `evidence_coherence_v3`, which must never treat `unspecified` as exact.
- **Existing v2 analyses remain current** until a new snapshot produces a new analysis (H3, approved).
- **Historical snapshots** are unchanged, and the PostgreSQL tests confirm the database rejects any attempt to update one.
- **Legacy records** show as `unspecified`.

## Database

- **Test database only:** `0006` is applied to `baslon_os_test`, and `current_database()` was re-verified as `baslon_os_test` (PostgreSQL 17.11) before the final PostgreSQL run.
- **Rows preserved:** at migration, all 719 Evidence and 665 Metric rows kept the same original column data, confirmed by matching checksums taken before and after. All read as `unspecified`.
- **`baslon_os` untouched:** re-checked for this revision; it still has 6 migrations. Applying `0006` there needs explicit approval.
- **Same-Business links:** still enforced for range Metrics (tested).
- **Permanent Delete:** still works for a Business holding range and approximate records (tested).

## Tests

Final results:

| Gate | Result |
|---|---|
| Unit + integration | 25 files, 217 tests passed, both with and without `TEST_DATABASE_URL` set |
| PostgreSQL (`baslon_os_test`) | 12 files, 98 tests passed |
| TypeScript | Passed |
| ESLint | Passed, 0 warnings |
| Production build | Passed |
| `git diff --check` | Passed, tracked and new files |

- **M4-02A coverage:**
  - `tests/unit/numeric-precision.test.tsx`: 22 tests covering vocabulary, shape rules, extraction grounding, the M4-10 rule, question isolation, legacy reading, review display and correction fields, formatting and snapshot projection;
  - `tests/integration/evidence-review.test.ts`:
    - precision and range correction, persistence and snapshot inclusion (updated so the linked pair is corrected consistently);
    - a legacy proposal accepted as `unspecified`;
    - **six H1 tests**: matching linked precision succeeds; a mismatch is rejected (a corrected Metric, and an unchanged Metric against corrected Evidence); correcting both to `estimate` succeeds; correcting both to `approximate` succeeds; a linked range stays consistent while its bounds differ; unlinked Metrics and Metrics on qualitative Evidence are unaffected;
  - `tests/fixtures/foundation-precision-scenarios.ts`: six Foundation write tests (`exact`, `approximate`, `estimate`, a range with both bounds, absent precision becoming `unspecified`, malformed shapes rejected), run on PGlite and PostgreSQL;
  - `tests/postgres/numeric-precision.postgres.test.ts`: 16 database tests covering defaults, the check constraints, enum vocabulary, same-Business integrity, historical snapshot immutability and Permanent Delete.
- **Shared migration helper (D8):** `tests/helpers/pglite-migrations.ts` is used by all 9 in-memory database (PGlite) test files.

## Findings Register

- **M4-02:** `RESOLVED — M4-02A` (awaiting commit). This revision adds the linked-precision review rule (H1, option b), Foundation writes, and the new test coverage to its resolution.
- **M4-10:** resolved, with the exact rule above.
- **M4-03:** **not resolved.** A progress note records that the question-isolation rule now covers precision and ranges; Claims and descriptive fields still lack grounding.
- **Also resolved:**
  - B-21: shared migration helper;
  - B-22: blank value no longer becomes zero;
  - B-29: test guard.
- **B-10:** note added.
- **Milestone 4 entry checklist:** the written-number alignment item is ticked; the diagnosis numeric item is annotated but left open.

Also updated in this revision:

- `docs/domain-invariants.md`: linked Metric/Evidence precision;
- `docs/milestone-4-m4-02a-numeric-precision.md`: human review and Foundation writes.

## Explicit Non-Implementation

Confirmed:

- no historical retrofit;
- no rebuild of the active Baslon Digital Business;
- no Evidence supersession;
- no diagnosis engine or diagnosis code change;
- no Phase 1 diagnosis input contract;
- `0006` not applied to `baslon_os`.

## Deviations

1. **Metric vs source Evidence check at extraction:** it compares precision only, not values (H2, recorded). The v6 prompt wording matches the validator.
2. **B-21 and B-22 marked resolved** rather than given notes, because the work fully covers both.
3. **Longer setup timeouts:** six in-memory test files now allow 30 seconds for setup, matching existing files.
4. **Existing extractor tests updated:** plain-number cases now use `exact`, because the shared fixture reads "about £80k" and is therefore `approximate`.
5. **Foundation input types widened:** `EvidenceInput` now includes precision and bounds, and `MetricInput` includes precision and bounds with an optional `numericValue`.
6. **Existing review test updated for H1:** its linked Metric is now corrected to `estimate` alongside its Evidence, instead of `unspecified`.

## Newly Discovered Issues

None open. The review items are closed as follows:

- **H1:** resolved (option b).
- **H3:** approved.
- **H6:** resolved.
- **H2, H5, H7, H8:** recorded.
- **H4:** a non-blocking pre-rebuild validation. Before rebuilding the Baslon Digital Business, run v6/v7 against the live model on a synthetic Business.
- **Migration `0006`** is still pending on `baslon_os`, by design.

## Recommended Next Task

After the M4-02A commit, apply `0006` to `baslon_os`, with explicit approval. Then check read-only that the active Baslon Digital Business's 12 numeric Evidence records read as `unspecified` and still display correctly.
