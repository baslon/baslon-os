# Baslon OS — M4-02A Completion Report
## Numeric Precision Foundation

**Date:** 19 September 2026\
**Branch:** `claude/milestone-4`\
**Status:** Implemented and validated. Not committed or pushed, pending architectural review.

---

## Baseline

- **Starting HEAD:** `4fc636f` (Add M4-02 numeric precision architecture decision).
- **Branch:** `claude/milestone-4`.
- **Working tree:** uncommitted M4-02A changes only: 38 modified files and 8 new files.

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

## Historical Compatibility

- Existing rows read as `unspecified` through the column default. No row is updated and nothing is inferred from its wording.
- Stored proposals can't be changed. Old-format proposals are read as `unspecified` by `readStoredEvidenceProposal` and `readStoredMetricProposal`; qualitative Evidence keeps no precision.
- Historical snapshot data is never rewritten. When Evidence Coherence reads a snapshot, a missing precision counts as `unspecified`.

## Extraction

- **New prompt versions:** `evidence_extractor_v6` (standard) and `evidence_extractor_v7` (question context). The v4/v5 text is unchanged, confirmed by identical SHA-256 hashes.
- **Contract:** proposals carry Evidence `valuePrecision`, `valueLower` and `valueUpper`, and Metric `numericPrecision`, `numericLower` and `numericUpper`. The extractor may only propose `exact`, `approximate`, `estimate` or `range`, never `unspecified`.
- **Ranges** keep both bounds and are never collapsed to one number.
- **Limits** such as "more than 30" stay as text, with no number.
- **M4-10 written-number rule**, now identical in the prompt and the validator:
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

Anything the validator can't ground is rejected, never silently changed. A Metric must carry the same precision as the numeric Evidence it is taken from.

## Human Review

- The review card shows the value or range and "Precision: …" before any decision. Old-format proposals show "Unspecified".
- The reviewer can change the precision to any of the five values with no wording check (D4), and can correct range bounds.
- Corrected numbers must still appear in the excerpt, and the shape must be valid.

## Canonical Persistence

- Accepted and corrected items persist their precision and bounds.
- Qualitative Evidence is saved as `unspecified`.
- A Metric correction now treats a cleared field as missing rather than zero.

## Snapshot Behaviour

- **New snapshots** include precision and bounds automatically.
- **Evidence Coherence** uses input version `evidence_coherence_input_v2` and prompt `evidence_coherence_v3`, which must never treat `unspecified` as exact. Earlier runs keep their own identity.
- **Historical snapshots** are unchanged, and the PostgreSQL tests confirm the database rejects any attempt to update one.
- **Legacy records** show as `unspecified`.

## Database

- **Test database only:** `0006` was applied to `baslon_os_test` after `current_database()` returned `baslon_os_test` (PostgreSQL 17.11).
- **Rows preserved:** all 719 Evidence and 665 Metric rows kept the same original column data, confirmed by matching checksums taken before and after. All now read as `unspecified`.
- **`baslon_os` untouched:** it still has 6 migrations and no `value_precision` column. Applying `0006` there needs explicit approval.
- **Same-Business links:** still enforced for range Metrics (tested).
- **Permanent Delete:** still works for a Business holding range and approximate records (tested).

## Tests

| Gate | Result |
|---|---|
| Unit + integration | 25 files, 205 tests passed, both with and without `TEST_DATABASE_URL` set |
| PostgreSQL (`baslon_os_test`) | 12 files, 92 tests passed |
| TypeScript | Passed |
| ESLint | Passed, 0 warnings |
| Production build | Passed |
| `git diff --check` | Passed, tracked and new files |

- **New test files:**
  - `tests/unit/numeric-precision.test.tsx`: 22 tests covering vocabulary, shape rules, extraction grounding, the M4-10 rule, question isolation, legacy reading, review display and correction fields, formatting and snapshot projection;
  - two new review tests in `tests/integration/evidence-review.test.ts`, covering precision and range correction, canonical persistence and snapshot inclusion, and a legacy proposal accepted as `unspecified`;
  - `tests/postgres/numeric-precision.postgres.test.ts`: 16 tests covering defaults, the check constraints, enum vocabulary, same-Business integrity, historical snapshot immutability and Permanent Delete.
- **Shared migration helper (D8):** `tests/helpers/pglite-migrations.ts` is now used by all 9 in-memory database (PGlite) test files.

## Findings Register

- **M4-02:** changed to `RESOLVED — M4-02A` (awaiting architectural review), documenting the brief's points.
- **M4-10:** resolved, with the exact rule above.
- **M4-03:** **not resolved.** A progress note records that the question-isolation rule now covers precision and ranges; Claims and descriptive fields still lack grounding.
- **Also resolved:**
  - B-21: shared migration helper;
  - B-22: blank value no longer becomes zero;
  - B-29: test guard.
- **B-10:** note added.
- **Milestone 4 entry checklist:** the written-number alignment item is ticked; the diagnosis numeric item is annotated but left open.

## Explicit Non-Implementation

Confirmed:

- no historical retrofit;
- no rebuild of the active Baslon Digital Business;
- no Evidence supersession;
- no diagnosis engine;
- no Phase 1 diagnosis input contract.

## Deviations

1. **Metric vs source Evidence check:** it compares precision only, not values. The decision document forbids exact-looking values derived from approximate inputs but doesn't require equal values, and an existing test relied on a Metric value that differs from its Evidence. The v6 prompt wording was aligned so the prompt and validator don't disagree.
2. **B-21 and B-22 marked resolved** rather than given notes, because the work fully covers both.
3. **Longer setup timeouts:** six in-memory test files now allow 30 seconds for setup, matching existing files. One setup timeout occurred once under load and did not recur in later runs.
4. **Existing extractor tests updated:** plain-number cases now use `exact`, because the shared fixture reads "about £80k" and is therefore `approximate`.

## Newly Discovered Issues

- **Foundation write path ignores precision:** `FoundationRepository.addEvidence`/`addMetric` (behind the business-state service) strips any supplied precision and saves `unspecified`. Only tests call it, not the app, and the default is safe. Candidate for the backlog.
- **Migration `0006` is still pending on `baslon_os`.**

## Recommended Next Task

After architectural review and commit, apply `0006` to `baslon_os`, with explicit approval. Then check read-only that the active Baslon Digital Business's 12 numeric Evidence records read as `unspecified` and still display correctly.
