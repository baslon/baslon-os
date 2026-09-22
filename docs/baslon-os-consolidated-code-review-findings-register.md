# Baslon OS — Consolidated Code Review Findings Register

**Status date:** 19 September 2026
**Current accepted baseline:** Milestone 3D — Pre-Diagnosis Hardening  
**Current implementation commit:** `8602b98 Complete Milestone 3D pre-diagnosis hardening`  
**Architectural review handoff commit:** `aeb00ef Add Milestone 3D architectural review handoff`  
**Working tree:** Clean at last verification  
**Code verification:** 18 September 2026 against `44e2bc1` (branch `claude/milestone-4`) — see [Section I](#i-code-verification-record--18-september-2026)

## Purpose

This register reconciles findings from:

1. Senior Code Review — Antigravity
2. Whole-Solution Code Review — Codex
3. Whole-Solution Code Review — Claude Code
4. Milestone 3D architectural review
5. Milestone 3D corrective-pass completion report

It exists so that findings do not disappear into old review documents or chat history.

Status values used here:

- **RESOLVED** — implemented and validated in Milestone 3D or its corrective pass.
- **SUPERSEDED** — the original finding was materially overstated, reframed by stronger evidence, or replaced by a more accurate finding that has now been handled.
- **DEFERRED — MILESTONE 4** — should be handled as part of, or before significant implementation of, Phase 1 Diagnosis.
- **DEFERRED — PRODUCTION** — not required for trusted local development, but required before shared/public production.
- **BACKLOG** — valid lower-priority debt or future-proofing; does not currently block Milestone 4.
- **ACCEPTED DESIGN** — reviewed behaviour that is intentional and should not be “fixed” casually.

---

# Executive Status

## Current overall position

**Architecture:** Sound.  
**Rewrite required:** No.  
**Milestone 3D:** Complete and accepted.  
**Milestone 4:** Milestone 4A (Gap Resolution & Phase 1 Entry) resolves M4-01: `GAP_RESOLUTION_REQUIRED` offers Add Information or human `CONTINUE_WITH_GAPS` → `PHASE1_READY`. Phase 1 diagnosis (4B onwards) remains subject to the other Milestone 4 items below. The initial-intake path that could invalidate an open review is closed (B-03 resolved). M4-02A (Numeric Precision Foundation, merged in PR #3) resolves M4-02 and M4-10. H4 pre-rebuild live-model validation is completed and passed (`docs/m4-02a-h4-live-model-validation.md`). M4-11 and N-1 (human review completeness and application-owned provenance) are merged (PR #6). Architectural review and a manual browser smoke test both passed. **M4-12** (Evidence Coherence relies on the model reproducing canonical UUIDs) is **resolved**: merged (PR #9), post-merge verified, and confirmed by the Product Owner-approved Snapshot 4 live regression. The Baslon Digital controlled rebuild v2 is at `PHASE1_READY` on Snapshot 4: the Product Owner took `CONTINUE_WITH_GAPS` once, and 0 contradictions and 6 validated gaps remain open on record. **M4-04** (artifact-specific workflow preconditions) is **resolved**. **M4-05, M4-06 and M4-07** (the Phase 1 Diagnosis contract) are **resolved**: merged (PR #13), with migration `0007_phase1_diagnosis` applied to live `baslon_os` and verified on 22 September 2026. M4-02B and any Phase 1 Diagnosis run have not started. Baslon Digital remains `PHASE1_READY` v18, and the first Baslon Digital diagnosis still requires separate Product Owner approval.\
**Local/private development:** Appropriate.  
**Shared/public production:** Not yet appropriate.

## Main issues already closed

Milestone 3D resolved the most material pre-diagnosis integrity risks:

- Add Information command atomicity.
- Stranded `RUNNING` extraction/coherence recovery.
- Latest-run review eligibility.
- Archive-safe strategic writes.
- Archive-safe AI completion.
- Transactional workflow preconditions.
- Evidence Coherence module scoping.
- Review-completion reconciliation.
- Shared deterministic snapshot construction.
- `strengthScore` semantic definition and review visibility.

---

# A. RESOLVED

## R-01 — Add Information could leave orphan Source Submissions/question links

**Origin:** Codex HIGH; Claude HIGH; Antigravity related workflow atomicity finding.  
**Status:** **RESOLVED**

### Original risk
Source Submission creation, optional question linkage, workflow advancement and extraction-run creation occurred across separate commits. Failure between those steps could leave an immutable human answer with no recoverable application path.

### Resolution
Milestone 3D introduced `src/repositories/add-information-repository.ts`.

One transaction now performs:

1. active-Business row lock/check;
2. workflow row lock;
3. workflow-state validation;
4. optional question lock/context validation;
5. Source Submission creation;
6. optional question/source link;
7. `ADD_EVIDENCE` transition/history insertion;
8. initial `RUNNING` extraction-run creation.

The provider call remains outside the transaction.

### Validation
Concurrency and PostgreSQL tests verify rollback and competing submissions.

---

## R-02 — Abandoned `RUNNING` Evidence Coherence runs could block analysis indefinitely

**Origin:** Codex HIGH; Claude HIGH; Antigravity related active-run recovery finding.  
**Status:** **RESOLVED**

### Original risk
A process failure or reconciliation failure after run creation could leave a permanent `RUNNING` row. Equivalent-run uniqueness could then prevent future analysis.

### Resolution
Milestone 3D added deterministic stale-run recovery:

- default stale threshold: 15 minutes;
- configurable with `AI_RUN_STALE_AFTER_MS`;
- conditional `RUNNING` → `FAILED`;
- provenance preserved;
- audited as `stale_run_recovered`;
- terminal runs cannot be overwritten;
- Evidence Coherence reconciliation now sits inside the failure boundary.

OpenAI calls use a 60-second request timeout with two SDK retries.

### Remaining limitation
Recovery is request-driven rather than proactive. See P-06.

---

## R-03 — Abandoned `RUNNING` extraction runs were unrecoverable

**Origin:** Claude HIGH; Codex HIGH grouped with AI-run lifecycle.  
**Status:** **RESOLVED**

### Resolution
The same stale-run recovery policy now applies to extraction runs, allowing safe retry against the same immutable Source Submission.

### Verification note (18 September 2026)
Recovery applies to the Add Information retry path (`AddInformationService.retry`). Initial-intake extraction (`runEvidenceExtractionAction`) has no stale-run recovery; a resubmission simply creates a newer run and leaves any abandoned initial-intake run in `RUNNING` indefinitely. This is harmless to review eligibility (only the latest run is reviewable) but leaves untidy run history. Tracked with B-03.

**Update (18 September 2026):** resolved with B-03. Initial intake now recovers a stale `RUNNING` run through the same conditional `stale_run_recovered` transition before starting again.

---

## R-04 — Review could proceed against a stale/non-current extraction run

**Origin:** Claude HIGH; Antigravity related unsafe `latestRun` guard.  
**Status:** **RESOLVED**

### Original risk
An older successful run could remain reviewable after a newer run existed, allowing workflow and snapshot lifecycle to advance out of order.

### Resolution
Review start, decision application and open-session completion now require:

- same Business;
- workflow state `EVIDENCE_PROCESSING`;
- latest extraction run;
- successful run;
- matching session/proposals.

Completed-session retries remain idempotent.

### Verification note (18 September 2026)
Confirmed in `assertCurrentReviewRun` (`src/repositories/evidence-review-repository.ts`). The latest-run guard is sound, but one UI path can still create a newer run during an open initial review; see B-03 (reclassified to Milestone 4).

---

## R-05 — Archive versus strategic write TOCTOU race

**Origin:** Codex HIGH; Antigravity HIGH related lifecycle-guard TOCTOU.  
**Status:** **RESOLVED**

### Resolution
Strategic mutation paths now lock/recheck the Business row using `assertActiveBusinessForUpdate()` inside the write transaction.

Business-row-first lock ordering is used consistently.

PostgreSQL concurrency tests verify:

- archive-first → strategic write rejected;
- write-first → write completes before archive.

---

## R-06 — AI completion could persist proposals/findings after archival

**Origin:** Milestone 3D architectural review blocker.  
**Status:** **RESOLVED**

### Original residual risk
A run could start while active, the Business could be archived during the external model call, and successful completion could then insert proposals/findings after archive.

### Resolution
Both successful completion transactions now re-lock/recheck the Business before inserting completion artifacts:

- `EvidenceExtractionRepository.completeRun()`
- `EvidenceCoherenceRepository.completeRun()`

Archive-first and completion-first PostgreSQL race tests cover both extraction and coherence.

---

## R-07 — Workflow artifact precondition checks were outside the transition transaction

**Origin:** Milestone 3D architectural review blocker.  
**Status:** **RESOLVED**

### Original risk
An artifact could change between precondition evaluation and workflow commit.

### Resolution
The Orchestrator passes the selected precondition to workflow persistence.

The repository now:

1. locks/verifies active Business;
2. locks workflow;
3. verifies expected state/version;
4. re-authorizes event/actor;
5. evaluates precondition using the same transaction;
6. updates workflow;
7. writes history;
8. commits.

The precondition receives a transaction-scoped read-only database interface.

### Validation
PostgreSQL concurrency tests prove artifact deletion remains blocked while the transition precondition/commit transaction holds the relevant lock.

### Verification note (18 September 2026)
The precondition's read-only interface is a TypeScript type (`Pick<Database, "select">`); at runtime it receives the full transaction. Atomicity also depends on each precondition taking its own row lock (`FOR SHARE` / `FOR UPDATE`) on any artifact that can change. Milestone 4 preconditions must do both: read only, and lock what they check.

---

## R-08 — Evidence Coherence repository reads were not module-scoped

**Origin:** Codex MEDIUM.  
**Status:** **RESOLVED**

### Resolution
Evidence Coherence reads now include `module = evidence_coherence`, preventing future diagnosis/secondary analysis modules from contaminating Evidence Quality reads or reconciliation.

---

## R-09 — Snapshot construction was duplicated and not explicitly deterministic

**Origin:** Claude MEDIUM; Antigravity snapshot-path concern.  
**Status:** **RESOLVED**

### Resolution
Snapshot construction is consolidated in:

`src/repositories/canonical-snapshot.ts`

It is used by:

- Foundation snapshot creation;
- Evidence Review completion.

Canonical collections are deterministically ordered.

Historical snapshots remain immutable.

---

## R-10 — Antigravity “Critical” snapshot consistency/version race

**Origin:** Antigravity CRITICAL.  
**Status:** **SUPERSEDED**

### Reconciliation
The original severity overstated the currently reachable failure mode.

The actual production path already operated under a Business-row lock and transaction, and Milestone 3D has since consolidated the snapshot builder and made the caller-lock precondition clearer.

### Current position
No evidence supports a remaining Critical snapshot-consistency defect.

---

## R-11 — Antigravity “Critical” Evidence Coherence `23505` recovery finding

**Origin:** Antigravity CRITICAL.  
**Status:** **SUPERSEDED**

### Reconciliation
The important underlying problem was abandoned `RUNNING` work, not the existence of the partial unique index/deduplication model itself.

The stale-run lifecycle is now explicitly recoverable.

### Residual improvement
Constraint-specific exception handling may still be tightened later if useful, but it is not a current Critical issue.

---

## R-12 — Review completion could leave snapshot/session complete while workflow lagged

**Origin:** Codex MEDIUM.  
**Status:** **RESOLVED**

### Resolution
Completed-session retry is idempotent. Repeating completion creates no duplicate snapshot and reconciles the workflow to `EVIDENCE_READY` where the relevant run remains current.

---

## R-13 — Human could accept relationship `strengthScore` without seeing its meaning

**Origin:** Codex MEDIUM; Claude MEDIUM.  
**Status:** **RESOLVED**

### Resolution
Evidence Review now shows `strengthScore` and explicitly defines it as:

> Confidence that the selected semantic relationship type is appropriate.

It is explicitly **not**:

- Claim truth probability;
- Evidence credibility;
- proof weight;
- reliability;
- corroboration;
- materiality;
- diagnostic confidence.

Evidence Coherence v2 carries the same semantic contract.

### Scope note (18 September 2026)
This resolves relationship strength only. Other AI-assigned qualifiers are still committed on Accept without being shown on the review card; see M4-11.

---

## R-14 — Evidence Coherence prompt left `strengthScore` semantically undefined

**Origin:** Claude MEDIUM.  
**Status:** **RESOLVED**

### Resolution
`evidence_coherence_v2` explicitly defines the meaning and prohibited interpretations of `strengthScore`.

Historical v1 runs remain independently versioned and immutable.

---

## R-15 — Existing coherence prompt/version could not coexist with revised semantics

**Origin:** Related AI-versioning concern across reviews.  
**Status:** **RESOLVED**

### Resolution
Prompt identity remains persisted per analysis run, and v1/v2 can coexist because active-run identity includes prompt version.

---

# B. DEFERRED — MILESTONE 4

## M4-01 — `GAP_RESOLUTION_REQUIRED` can become a dead end when no question is surfaced

**Origin:** Claude MEDIUM.  
**Status:** **RESOLVED — Milestone 4A (18 September 2026)**

### Resolution — Milestone 4A
Product decision: `GAP_RESOLUTION_REQUIRED` is a human resolution checkpoint, not a state that requires a surfaced question. From it a human can:

- **add information**, with or without a surfaced question, through the unchanged atomic Add Information command; or
- **continue with known gaps** via the human-only `CONTINUE_WITH_GAPS` event → `PHASE1_READY` (`GapResolutionService.continueWithGaps`).

`CONTINUE_WITH_GAPS` commits through the central Orchestrator path (Business and workflow locks, version check, actor re-authorization). A default transaction-scoped precondition (`continueWithGapsPrecondition`, `src/repositories/workflow-preconditions.ts`) requires the recorded snapshot to be the latest canonical snapshot and the recorded run to be a successful `evidence_coherence` run of it.

Durable audit is the existing `workflow_transitions` row: actor, time, states, event, reason, plus `metadata` with `snapshotId`, `snapshotVersion`, `analysisRunId` and `analysisPromptVersion`. There is no new table and no migration. Findings, questions, runs and snapshots are never modified or marked resolved.

Human `ADD_EVIDENCE` from `PHASE1_READY` → `EVIDENCE_PROCESSING` was added so `PHASE1_READY` is not a dead end before Phase 1 diagnosis exists.

Validation: shared scenarios on PGlite and PostgreSQL (zero surfaced questions with no findings and with low-materiality only, audit metadata, human-only actor, invalid source states, snapshot precondition, archive rejection, the `PHASE1_READY` Add Information loop); PostgreSQL races (concurrent continue commits once; a snapshot committed while the transition waits is rejected by the in-transaction precondition; archive winning the lock rejects it); and unit tests for the rules and UI. See `docs/milestone-4a-gap-resolution-phase1-entry.md`.

### Verification (18 September 2026, before Milestone 4A)
Milestone 3D already allows ordinary (unprompted) Add Information from `GAP_RESOLUTION_REQUIRED`:

- `AddInformationRepository.prepare` accepts `EVIDENCE_READY` or `GAP_RESOLUTION_REQUIRED` when no question is supplied;
- `/businesses/[businessId]/information` renders the form in both states;
- covered by the test "accepts ordinary Add Information from GAP_RESOLUTION_REQUIRED without creating a question link".

Navigation and documentation — **resolved 18 September 2026:**

- the workspace and Evidence State pages show Add Information in both `EVIDENCE_READY` and `GAP_RESOLUTION_REQUIRED` (shared `acceptsAddInformation` in `src/domain/workflow.ts`);
- Evidence Quality shows "Add other information" in `GAP_RESOLUTION_REQUIRED`, including when no question was surfaced;
- documented in `docs/milestone-3d-pre-diagnosis-hardening.md`.

Remaining for Milestone 4 at that time (since resolved by Milestone 4A above):

- whether Milestone 4 also needs an explicit continue/accept-gaps route remains a product decision.

### Original risk
If analysis produces no high/medium surfaced questions, or only low-materiality findings, the Business can enter `GAP_RESOLUTION_REQUIRED` with no obvious user action.

Ordinary unprompted Add Information has historically been tied to `EVIDENCE_READY`.

### Required decision
Before implementing Phase 1 Diagnosis, explicitly define at least one valid user path from this state, for example:

- allow unprompted Add Information from `GAP_RESOLUTION_REQUIRED`; or
- implement an explicit continue/accept-gaps route with durable audit semantics.

### Milestone 4 entry requirement
Resolve as an explicit workflow/product decision before diagnosis UI depends on this state.

---

## M4-02 — Approximate and range values may become exact canonical numbers

**Origin:** Claude MEDIUM.  
**Status:** **RESOLVED — M4-02A (19 September 2026; merged in PR #3, migration `0006` applied to `baslon_os`)**

### Resolution — M4-02A
Explicit precision model (`exact | approximate | estimate | range | unspecified`) for new canonical Evidence and Metrics, per the approved decision `docs/baslon-os-m4-02-numeric-precision-architecture-decision.md` (D1–D8):

- **Schema:** additive migration `0006_numeric_precision`. Evidence `value_precision`/`value_lower`/`value_upper`, and Metric `numeric_precision`/`numeric_lower`/`numeric_upper`, with `numeric_value` nullable for ranges. Precision is NOT NULL, default `unspecified`. CHECK constraints enforce range shape (both bounds, lower ≤ upper, no single value) and forbid bounds on other precisions.
- **No retrofit:** existing rows read as `unspecified` through the column default. No row is updated, and nothing is inferred from wording. Legacy stored proposals read as `unspecified`.
- **Historical `unspecified`:** never treated as exact by the UI, the Evidence Coherence prompt or the documented calculation rule.
- **Range preservation:** both bounds are stored and shown ("10–15 projects"), and never collapsed to a bound or midpoint.
- **Extraction:** `evidence_extractor_v6`/`v7` propose precision, and deterministic validation grounds it in the wording next to the number in the cited excerpt.
- **Human review:** precision and range are shown before a decision. A reviewer can correct precision (any value) and bounds; corrected numbers must still be in the excerpt. A Metric taken from numeric Evidence must end review with that Evidence's precision (architectural review H1, option b).
- **Snapshots:** new snapshots include precision and bounds. Evidence Coherence input `evidence_coherence_input_v2` and prompt `evidence_coherence_v3` carry them. Historical snapshots are unchanged and project missing precision as `unspecified`.
- **Foundation writes:** `FoundationRepository.addEvidence`/`addMetric` persist supplied precision and bounds, and default to `unspecified` only when none is supplied.
- **Tests:** unit (`tests/unit/numeric-precision.test.tsx`), integration (`tests/integration/evidence-review.test.ts`, including linked-precision review), Foundation scenarios (`tests/fixtures/foundation-precision-scenarios.ts`, PGlite and PostgreSQL), and PostgreSQL 17 (`tests/postgres/numeric-precision.postgres.test.ts`: defaults, CHECKs, enum, same-Business integrity, snapshot immutability, Permanent Delete).

The active Baslon Digital Business values described below now read as `unspecified`. They are not retrofitted, and correcting them needs new human-authorised evidence. See `docs/milestone-4-m4-02a-numeric-precision.md`.

**H4 pre-rebuild live-model validation: COMPLETED — PASSED (19 September 2026).** Seven synthetic-only calls to `gpt-5.6-luna` created no database rows. Precision was classified correctly in every run, question context stayed non-evidentiary, and linked Metric/Evidence precision matched. One run was rejected by the validator for a written-number violation (B-31). The pre-rebuild requirement is satisfied, and M4-02 remains resolved. The current Baslon Digital Business has not been archived or rebuilt. See `docs/m4-02a-h4-live-model-validation.md`.

### Risk
Examples such as:

- `about 30 clients`
- `roughly £4k`
- `10–15 projects`

can be normalized to exact numeric values despite source uncertainty.

### Confirmed in real data (17 September 2026)
A read-only check of the development database found that 11 of the 12 numeric Evidence records in the active Baslon Digital Business come from excerpts stating "approximately" (for example total revenue £80,000, recurring revenue £1,200 per month, ad-hoc support 10% of revenue, and eight project values of £1,000–£6,000). Each is stored as an exact number with a matching Metric. Only the project-value Metric labels include the word "approximate". This is a confirmed data condition, not only a hypothetical risk.

### Why Milestone 4 matters
Diagnosis may calculate or infer from these numbers.

### Required decision
Before diagnosis treats numeric values as exact quantitative inputs:

- add precision/qualifier semantics; or
- explicitly treat current numeric canonical values as potentially approximate and avoid unsupported precision.

Potential model:

`exact | approximate | estimate | range_lower | range_upper`

Any schema/contract change requires forward migration and extractor versioning.

---

## M4-03 — Question context is not deterministically isolated from every semantic field

**Origin:** Claude MEDIUM.  
**Status:** **DEFERRED — MILESTONE 4**

### Current strength
Evidence/Metric excerpts and numeric provenance are checked against the human answer, not the AI-generated question.

### Remaining gap
Claims and some descriptive semantic fields do not have equivalent deterministic grounding checks, so prompt discipline plus human review still matter.

### Required work
For the next extractor revision, evaluate:

- source excerpt support for Claims;
- deterministic checks against question-only digit/text contamination where practical;
- clearer review indication of contextual interpretation.

Do not weaken the current rule:

**Interpretive context ≠ evidentiary source.**

### Progress note (M4-02A, 19 September 2026)
Not resolved. M4-02A extends the existing numeric isolation to precision: range bounds and precision wording must be grounded in the human answer, and `evidence_extractor_v7` says the question cannot make an answer approximate or exact. Claims and other descriptive fields still lack deterministic grounding.

### Note (M4-11, 19 September 2026)
Not resolved. M4-11 makes every persisted descriptive field visible and correctable at review, which helps the human catch question-context contamination. It adds no deterministic grounding, so this finding remains open.

---

## M4-04 — Milestone 4 artifact-specific workflow preconditions

**Origin:** Milestone 3D known limitation.  
**Status:** **RESOLVED — Milestone 4 (22 September 2026).** Concrete artifact-specific preconditions now guard the Milestone 4 advancement path. No Baslon Digital diagnosis has run.

### Original state
The transactional precondition mechanism was safe, but no diagnosis artifacts existed yet.

### Requirement
Each Milestone 4 transition must register concrete artifact eligibility checks only after the relevant artifact schema/service exists.

Examples may include:

- exact current snapshot;
- terminal successful diagnosis run;
- completed human review/approval.

Do not create placeholder diagnosis artifacts merely to satisfy the mechanism.

### Progress note (Milestone 4A, 18 September 2026)
The first concrete precondition is registered: `continueWithGapsPrecondition` for `CONTINUE_WITH_GAPS`, as a default on every orchestrator. This remains open for the diagnosis transitions (`GENERATE_PHASE1` onwards), whose artifacts do not exist yet. Note that the precondition interface is read-only by type only, and each precondition must hold its own locks if the artifact it checks can change (see R-07).

### Resolution
The Milestone 3D / 4A limitation ("the mechanism exists, but no diagnosis-specific eligibility checks do") no longer applies. `defaultWorkflowTransitionPreconditions` (`src/repositories/workflow-preconditions.ts`) now registers a concrete check for every step of the Milestone 4 advancement path:

- **`CONTINUE_WITH_GAPS`** (Milestone 4A): the recorded snapshot must be the latest, and the recorded run must be a successful `evidence_coherence` run of that snapshot and Business.
- **`GENERATE_PHASE1`** (M4-05):
  - the recorded snapshot must be the latest;
  - it and the recorded Evidence Coherence run must match the Business's last `CONTINUE_WITH_GAPS`;
  - the run must be a successful `evidence_coherence` run of that snapshot.

  The state machine allows it only from `PHASE1_READY`.
- **`MARK_ANALYSIS_COMPLETE` from `PHASE1_ANALYSING`** (M4-07): the recorded run must be a successful `phase1_diagnosis` run of the latest snapshot. A completed model call alone cannot advance the workflow, and a failed run stays at `PHASE1_ANALYSING`.
- **`APPROVE_PHASE1`** (M4-07):
  - the recorded approved-diagnosis record must exist for the Business;
  - it must belong to the current diagnosis of the latest snapshot;
  - its review must contain at least one final ACCEPTED or CORRECTED decision.

  The deployed `approved_diagnosis_guard` trigger admits an approved record only for a COMPLETED review of a successful run with matching snapshot, versions and input hash. Approval is therefore protected by both the Orchestrator precondition and the database guards.

Every check runs through the transaction-scoped Orchestrator mechanism established and validated in Milestone 3D / 4A (R-07). In one transaction, the mechanism:
1. locks the active Business;
2. locks the workflow;
3. verifies the expected state and version;
4. re-authorises the actor;
5. evaluates the artifact precondition;
6. writes the workflow update and transition history before commit.

Artifact eligibility is therefore re-evaluated inside the transaction that commits the transition. Snapshot creation takes the same Business lock.

**No placeholder artifacts.** None were created to satisfy this finding. The diagnosis preconditions were added only once the real diagnosis persistence and services existed (PR #13, with `0007` deployed and verified on live `baslon_os`).

**Evidence:**
- automated and PGlite / PostgreSQL 17 tests of each precondition, including direct Orchestrator calls that are refused;
- synthetic integration tests of the full path;
- bounded browser review and approval testing on `baslon_os_test`;
- live deployment of the diagnosis schema and guards.

A real Baslon Digital diagnosis is not needed to close this finding: it concerns the eligibility-enforcement architecture, not whether a particular Business has run a diagnosis. No further code or schema work is required.

---

## M4-05 — Diagnosis must define a snapshot-bound contract

**Origin:** Codex/Claude guardrails.  
**Status:** **RESOLVED — Phase 1 Diagnosis contract (merged 22 September 2026, PR #13 `ca63e4f`; commits `6c59857`, `7d6a540`, `183c41b`), with migration `0007_phase1_diagnosis` applied to live `baslon_os` and verified the same day.** Resolved on the combined architecture decision, implementation, validation and live-deployment evidence below, not on the merge alone. No Baslon Digital diagnosis has run.\
**Governing decision:** `docs/baslon-os-m4-05-m4-06-m4-07-phase1-diagnosis-contract-architecture-decision.md`; implementation: `docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`

### Requirement
Milestone 4 must:

- read one exact immutable snapshot;
- not reconstruct historical input from live canonical state;
- persist exact analytical input;
- hash/version the input contract;
- store separate non-canonical diagnosis output;
- preserve same-Business references;
- keep historical diagnoses immutable.

### Implementation
- **Versions:** `phase1_diagnosis_input_v1` / `phase1_diagnosis_v1`.
- **Snapshot binding:**
  - an `analysis_runs` row (`phase1_diagnosis`) FK-bound to one immutable snapshot;
  - `snapshotContentHash` and `gapSourceRunId` in immutable run provenance;
  - a deterministic input hash, re-proved before any review decision or approval.
- **Handles:** run-local C/E/M/G/D; no UUID reaches the model.
- **Calculations:** software-owned (`diagnosis_calculations` + `diagnosis_calculation_sources`).
- **Separate analytical state:** migration `0007_phase1_diagnosis` (additive), with same-run composite FKs and immutability triggers.
- **Fail-closed validation:** handles, grounding and the missing-data guardrail.
- **Rollout:** `0007` is applied to `baslon_os_test` and, with Product Owner approval on 22 September 2026, live `baslon_os`.

### Resolution basis
The deployed contract provides:
- exact immutable-snapshot binding;
- a deterministic, versioned input projection and input hash;
- snapshot-local C/E/M/G/D references, with no model-authored canonical UUIDs;
- analytical diagnosis state kept separate from canonical truth;
- fail-closed grounding and reference validation;
- immutable historical diagnosis records;
- deterministic, software-owned calculations where supported;
- no canonical mutation by diagnosis.

### Resolution evidence (22 September 2026)
Shared by M4-05, M4-06 and M4-07:

1. Architecture Decision, then implementation.
2. Migration-gate review, with Solution Architect amendments.
3. Automated tests passed: 286 unit/PGlite and 109 PostgreSQL 17 tests.
4. Synthetic integration validation passed, including the full revision loop through a newer snapshot.
5. Bounded live-model validation on synthetic data passed.
6. Browser review-flow smoke tests on `baslon_os_test` passed.
7. Two Solution Architect pre-merge amendments: a surviving item for approval, and v1 revision semantics.
8. PR #13 merged (`ca63e4f`).
9. `0007_phase1_diagnosis` applied to live `baslon_os` exactly once with `drizzle-kit migrate`:
   - all 5 diagnosis enums and all 7 tables verified;
   - FK, CHECK and trigger integrity verified; the schema dump matches `baslon_os_test` line for line;
   - all 7 tables had 0 rows and there were 0 `phase1_diagnosis` runs.
10. Permanent Delete covers all 7 tables in FK-safe order, verified by PostgreSQL tests. No live Business was deleted.
11. Live application compatibility verified with read-only page loads.
12. The Baslon Digital rebuild is unchanged: `PHASE1_READY` v18, Snapshot 4 `bd0e75c5…`, canonical 39 / 59 / 18 / 54 with identical row fingerprints, and no `GENERATE_PHASE1`.

See `docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`.

---

## M4-06 — Diagnosis must not treat AI-assigned qualifiers as human truth weights

**Origin:** Codex/Claude review concern.  
**Status:** **RESOLVED — Phase 1 Diagnosis contract (merged 22 September 2026, PR #13 `ca63e4f`; commits `6c59857`, `7d6a540`, `183c41b`), with migration `0007_phase1_diagnosis` applied to live `baslon_os` and verified the same day.** Resolved on the combined architecture decision, implementation, validation and live-deployment evidence below, not on the merge alone. No Baslon Digital diagnosis has run. B-09 stays open.\
**Governing decision:** `docs/baslon-os-m4-05-m4-06-m4-07-phase1-diagnosis-contract-architecture-decision.md`; implementation: `docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`

### Implementation
- **Not truth weights:** `strengthScore`, reliability, directness, recency and precision are never converted into truth weights. No code computes a confidence from them.
- **`strengthScore`** passes through unchanged.
- **Validation rejects** text that treats qualifiers, `strengthScore` or confidence as a truth weight or probability. It also rejects "exactly / precisely" on a non-exact source, and a range midpoint.
- **Calculations preserve precision:** approximate stays approximate, ranges stay ranges, and `unspecified` is never upgraded. Derived values are labelled derived and are not founder-supplied Evidence.
- **Diagnosis-local labels:** `interpretationConfidence` and materiality are defined for diagnosis only.

### Resolution basis
- `strengthScore` remains semantic-link confidence only.
- Reliability, directness, recency and precision are never converted into automatic truth weights.
- Precision classes are preserved: ranges stay ranges, approximate values stay approximate, and no midpoint is substituted by default.
- Derived and calculated values stay explicitly derived and never become founder-supplied Evidence.
- Interpretation confidence is diagnosis-local, not a canonical truth probability.
- B-09 (qualifier vocabulary) remains separately open.

Resolution evidence: see M4-05.

### Rule
Do not interpret:

- `strengthScore`;
- reliability;
- directness;
- recency;
- materiality;
- confidence

as Claim truth probability or proof weight unless an explicitly approved later model defines such semantics.

`strengthScore` is semantic-link confidence only.

---

## M4-07 — Diagnosis approval must be separate from canonical Evidence admission

**Origin:** Cross-review architecture guardrail.  
**Status:** **RESOLVED — Phase 1 Diagnosis contract (merged 22 September 2026, PR #13 `ca63e4f`; commits `6c59857`, `7d6a540`, `183c41b`), with migration `0007_phase1_diagnosis` applied to live `baslon_os` and verified the same day.** Resolved on the combined architecture decision, implementation, validation and live-deployment evidence below, not on the merge alone. No Baslon Digital diagnosis has run.\
**Governing decision:** `docs/baslon-os-m4-05-m4-06-m4-07-phase1-diagnosis-contract-architecture-decision.md`; implementation: `docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`

### Implementation
- **No canonical writes:** diagnosis writes only analytical tables, never Claims, Evidence, Metrics or relationships.
- **Mandatory checkpoint:**
  - a successful run stops at `PHASE1_AWAITING_REVIEW`;
  - `GENERATE_PHASE1` and `APPROVE_PHASE1` are human-only and guarded by Orchestrator preconditions;
  - a failed run stays at `PHASE1_ANALYSING`.
- **Complete review surface:** every material field is shown, with a manifest test (the M4-11 lesson).
- **ACCEPT / CORRECT / REJECT:** corrections may change every material field, including references and grounding, and must pass the same validation.
- **Approval:**
  - requires exactly one decision per item (application and trigger);
  - requires at least one ACCEPTED or CORRECTED item. An all-rejected review cannot be approved; the reviewer uses Request Revision (UI, application, Orchestrator precondition and trigger);
  - the immutable, versioned artifact is built server-side;
  - REJECTED items are excluded, and carried-forward gaps are always included;
  - the reviewer, decisions, corrections, timestamps, run, snapshot and versions are audited.
- **v1 revision semantics:**
  - after `REQUEST_REVISION`, a new diagnosis needs a newer snapshot;
  - a revision never re-runs or reuses the diagnosis on the snapshot that produced it;
  - `REVISION_REQUIRED` returns through ordinary Add Information (`ADD_EVIDENCE`) and the normal evidence and coherence path to `PHASE1_READY`;
  - `REVISION_REQUIRED + GENERATE_PHASE1` was removed from the state machine.

### Resolution basis
- A successful diagnosis stops at the human review checkpoint.
- Every material persisted field is reviewable.
- ACCEPT / CORRECT / REJECT exist, and human corrections are revalidated.
- An all-rejected diagnosis cannot be approved; approval needs at least one ACCEPTED or CORRECTED item.
- Approved records are generated server-side, immutable and auditable.
- Revision returns through the evidence loop to a newer snapshot. Same-snapshot re-diagnosis after `REQUEST_REVISION` is prohibited in v1.

Resolution evidence: see M4-05.

### Rule
Milestone 4 diagnosis/recommendation output must remain analytical state.

AI diagnosis must not directly:

- create Claims;
- create Evidence;
- create Metrics;
- modify relationships;
- mark facts;
- create decisions.

New factual information still goes through:

Source Submission → Extraction → Proposal → Human Review → Canonical Snapshot.

---

## M4-08 — Consider extraction-run provenance lifecycle hardening before diagnosis expands

**Origin:** Claude MEDIUM.  
**Status:** **DEFERRED — MILESTONE 4 / PRODUCTION**

### Finding
Earlier provenance-bearing tables do not all have the same trigger-level immutability/lifecycle protection as Milestone 3C analytical tables.

Priority subset for consideration:

- extraction-run lifecycle;
- review-session terminal state.

Do not modify historical migrations; use forward migrations if approved.

---

## M4-09 — PostgreSQL test-database safety and CI

**Origin:** Claude MEDIUM; Codex MEDIUM documentation/CI concern.  
**Status:** **PARTIALLY RESOLVED — guard done; CI DEFERRED — MILESTONE 4**

### Known review concern
Claude reported that some PostgreSQL test files did not positively enforce `baslon_os_test`, and all reviews noted absence of CI.

### Verification (18 September 2026)
**Guard — resolved.** All 9 files in `tests/postgres/` use the shared `tests/helpers/postgres-test-guard.ts`: `requirePostgresTestDatabaseUrl()` before connecting and `verifyPostgresTestDatabase()` (checks `current_database()` and PostgreSQL 17.x) after connecting. The full suite passed: 9 files, 57 tests against `baslon_os_test`.

**CI — outstanding.** No `.github/` workflow exists.

### Remaining requirement
Add CI, or explicitly document why CI remains deferred. When adding CI, fix B-29 first: the unit test for the guard fails when `TEST_DATABASE_URL` is set in the same environment.

---

## M4-10 — Written-number prompt and deterministic validator disagree

**Origin:** Codex MEDIUM; Claude LOW.  
**Status:** **RESOLVED — M4-02A (19 September 2026)**

### Resolution
`evidence_extractor_v6`/`v7` and the validator now state one rule. A number may be written in digits (optionally with £, $, € or %, a k suffix, or an m suffix after a currency symbol), or as a whole-number word from zero to ninety-nine ("twelve", "twenty-five"). A number word is not converted when it is part of a compound description ("three-day"), follows approximation language ("about ten" stays qualitative), or is larger than ninety-nine ("a hundred"). Covered by `tests/unit/numeric-precision.test.tsx` and `tests/unit/evidence-extractor.test.ts`.

### Refinement — approximation scope in coordinated measurement phrases (20 September 2026, awaiting architectural review)
The validator originally required an approximation cue to sit directly beside its number, so "roughly a three-day, 30-hour working week" could not be recorded: the model proposed `approximate` for 30, and validation rejected it because "roughly" was separated by the compound term. This blocked the Baslon Digital S1 rebuild three times.

One approximation cue now governs a later measurement of the **same coordinated phrase**. The cue reaches the number only when everything between them is an article followed by compound measurement terms ("three-day") and their separators (a comma, "and", or both). Anything else — another word, punctuation, a sentence boundary or a contrasting clause such as "but" — breaks the match, so approximation cannot reach an unrelated number.

Unchanged: `evidence_extractor_v6`/`v7`, prompt versions, the precision vocabulary, B-15 all-or-nothing validation, and the rule that compound terms such as "three-day" never become numeric Evidence. B-31 (the model converting a compound number word) is a separate behaviour and **remains open**.

### Finding
Prompt wording historically prohibited number-word conversion while deterministic validation allowed bounded cardinal normalization such as `three` → `3`.

### Required action
At the next approved extraction contract change:

- align prompt and validator;
- explicitly document bounded cardinal normalization;
- bump prompt/contract version.

---

## M4-11 — Accept commits AI-assigned qualifiers the reviewer was not shown

**Origin:** Claude MEDIUM (original finding broader than R-13); confirmed 18 September 2026; scope broadened 19 September 2026 (`docs/m4-11-architectural-analysis.md`).\
**Status:** **RESOLVED — M4-11 (merged 20 September 2026, PR #6 `13f5df1`)**

### Broadened finding
Accept persisted the **whole** proposal while the review card showed only part of it:

- **Claims:** subject area, confidence score, confidence basis, source type.
- **Evidence:** evidence type, value text, unit, period, reliability level and score, directness, recency, source notes, provenance.
- **Metrics:** metric key, unit, period, dimension, source-Evidence link.

Relationships were already complete (R-13). Evidence State later labelled these values "Human reviewed". The originally recorded four fields (Claim `confidenceScore`; Evidence reliability, directness and recency) were a subset.

### Resolution
Governed by the approved architecture decision *M4-11 Human Review Completeness & N-1 Provenance*. See `docs/milestone-4-m4-11-review-completeness-provenance.md`.

- **Complete card:** the pending card renders the complete canonical object Accept will persist.
  - AI-proposed values appear under "Recorded if you accept".
  - Application provenance appears read-only.
  - There is no per-field confirmation.
- **Newly correctable:** Evidence `evidenceType`, Evidence `sourceMetadata.notes` and Metric `dimensionData`.
- **Review-card stamp:** new Claims, Evidence and Metrics carry `evidenceReview.reviewCardVersion = "m4_11_v1"`.
- **Older records:** reviewed records without the stamp show "Qualifiers were AI-assigned and were not all displayed at the original review." at read time. No record is rewritten.
- **Regression invariant:** a field manifest must equal the proposal schemas, and every shown field must render with its exact value (`tests/unit/review-card.test.tsx`).

### Remaining boundaries
- **M4-06 still applies:** the qualifiers are still not truth weights.
- **B-09 remains open:** a controlled vocabulary for the qualifiers.
- **Rebuild S1 records:** the rebuild Business `9aec14e1-…` S1 records predate the fix and show the legacy warning. S1 is to be re-run in a fresh rebuild Business.
---

## N-1 — Canonical provenance was authored by the model

**Origin:** M4-11 architectural analysis, 19 September 2026.\
**Status:** **RESOLVED — M4-11 (merged 20 September 2026, PR #6 `13f5df1`)**

### Finding
Evidence `sourceType`, `sourceReference` and `sourceMetadata.suppliedBy`, and Claim `sourceType`, were persisted from the extraction model's output. The model echoed the application's input, but nothing validated it, so a model could write arbitrary provenance into canonical Evidence.

### Resolution
- **Provenance from the run:** `applicationProvenance(run)` derives provenance from the reviewed extraction run (`source_type`, `source_reference`, `source_metadata.suppliedBy`). An application label, `unrecorded`, is used when a run recorded no channel.
- **Validated excerpt:** Evidence `raw_payload` carries the validated source excerpt plus the run and proposal IDs, not model text.
- **Same-Business check:** the review service refuses a run from another Business.
- **Visible and read-only:** provenance is shown on the card and cannot be corrected; the strict correction schemas reject it.
- **No separation needed:** `sourceType` is a channel, not overloaded. The AI's interpretive classification is `evidenceType`, which stays AI-proposed, visible and correctable. No schema change.
- **Immutable proposals:** proposals keep the model's echoed values and are never rewritten.

---

## M4-12 — Evidence Coherence relies on model reproduction of canonical UUIDs

**Origin:** Baslon Digital controlled rebuild v2, live Evidence Coherence runs, 21 September 2026.\
**Classification:** Milestone 4 blocker.\
**Status:** **RESOLVED — M4-12 (merged 21 September 2026, PR #9 `d370d7d`; implementation `449cbe4`), confirmed by the Snapshot 4 live regression `bcc6fd6c-d0cb-4d8d-b2d1-64813738ce9e`.**\
**Governing decision:** `docs/baslon-os-m4-12-evidence-coherence-reference-handles-architecture-decision.md`

### Finding
Evidence Coherence requires the model to reproduce full canonical UUIDs in finding references. Repeated live-model runs corrupted the same valid Snapshot Evidence identifier, causing deterministic validation failure. Replace model-authored canonical identifiers with deterministic snapshot-local handles resolved to canonical UUIDs by application code.

### Evidence
Two of three runs that had to cite the profitability-gap Evidence `4142656f-8877-447b-86c9-5c0c3e35a58d` failed:

| Run | Snapshot | Model emitted | Result |
|---|---|---|---|
| `8c3f1af5-…` | 3 | `414b90e2-4593-4e45-9382-f54660270c37` (splice of two valid IDs) | FAILED |
| `90cd5ec9-…` | 3 (retry) | the correct UUID | SUCCEEDED |
| `9883e5cb-…` | 4 | `414b2656-8877-447b-86c9-5c0c3e35a58d` (scrambled first segment) | FAILED |

The all-or-nothing validator rejected both corrupted outputs, and nothing was persisted. The validator worked; the contract that asks a model to reproduce opaque identifiers did not.

### Risk
As snapshots grow, model-authored UUID reproduction creates avoidable failures and can stop workflow progression even when the analytical content is valid. The rebuild is held at `GAP_ANALYSIS` on Snapshot 4 until this is resolved.

### Implementation (merged, PR #9)
- **New versions:** `evidence_coherence_input_v3` and `evidence_coherence_v4`. `evidence_coherence_input_v2` and `evidence_coherence_v3` are frozen verbatim; historical runs are not rewritten or revalidated.
- **Handles:** Claims `C001…`, Evidence `E001…`, Metrics `M001…`, assigned in admission order (`createdAt`, then canonical UUID) and independent of stored array order.
- **No UUIDs to the model:** the model input carries handles only; relationships and Metric source Evidence use handles too.
- **Application-owned resolution:** a strict handle syntax, then an exact lookup in a map built only from the analysed snapshot. There is no fuzzy repair, text search or live-state lookup. An unknown, malformed or wrong-namespace handle, or a model-emitted UUID, rejects the whole output.
- **Persistence unchanged:** `analysis_finding_references` still stores canonical UUIDs. Handles appear only in the input payload and raw model output. No migration.
- **Validation at `449cbe4`:** TypeScript, ESLint, `npm test` (27 files, 252 tests), PostgreSQL (12 files, 100 tests on `baslon_os_test`) and the production build all passed.
  - The frozen v2 code reproduces the stored input hash of all four existing rebuild runs.
  - A bounded live-model check on synthetic data gave 3 of 3 valid runs, with all 37 references valid handles.

### Post-merge verification (21 September 2026)
- **Repository:** `main`, `origin/main`, `claude/milestone-4` and `origin/claude/milestone-4` are all at `d370d7d`; working tree clean.
- **Versions:** `evidence_coherence_input_v3` / `evidence_coherence_v4` are active in the service path. The frozen v2 input/hash, v3 prompt and v3 output schema remain available, and their pinned fingerprints pass.
- **Database (`baslon_os`, read-only):** rebuild Business `a658df7e-…` is unchanged.
  - Workflow is still `GAP_ANALYSIS` (version 16), with no transition since the failed Snapshot 4 run.
  - Snapshots 1–4 are unchanged (Snapshot 4 `da6e9a8e-…`, fingerprint `bd0e75c5…`).
  - Canonical counts are 39 Claims / 59 Evidence / 18 Metrics / 54 relationships.
  - The four earlier runs, including failed run `9883e5cb-…`, are unchanged. No v3/v4 run exists anywhere.
  - No `CONTINUE_WITH_GAPS`, diagnosis, archive or delete has occurred. Both earlier Baslon Digital Businesses are unchanged.

### Resolution — Snapshot 4 live regression (21 September 2026)
The Product Owner approved one Evidence Coherence run on Snapshot 4 `da6e9a8e-…`. Run `bcc6fd6c-d0cb-4d8d-b2d1-64813738ce9e` **SUCCEEDED** under `evidence_coherence_input_v3` / `evidence_coherence_v4`.

- **Input hash:** `3307d197…`, identical to the hash computed offline before merge.
- **Handles:** all 39 model references were valid snapshot-local handles (15 Claims, 19 Evidence, 5 Metrics). No UUID was exposed to or emitted by the model.
- **The failing record:** Evidence `4142656f-8877-447b-86c9-5c0c3e35a58d`, which the model had corrupted in runs `8c3f1af5-…` and `9883e5cb-…`, was cited as `E040` and resolved to its correct canonical UUID.
- **State unchanged:** canonical state and Snapshots 1–4 are unchanged.
- **Result:** 0 contradictions and 6 validated gaps. The rebuild moved to `GAP_RESOLUTION_REQUIRED`.

### Boundary
The governing rule is: **AI selects bounded snapshot-local references; software owns canonical identity.** The Architecture Decision (§19) recommends reusing it wherever a model is asked to reproduce opaque identifiers.

---

# C. DEFERRED — PRODUCTION

## P-01 — No authentication

**Origin:** All three reviews.  
**Status:** **DEFERRED — PRODUCTION (BLOCKER)**

### Current reality
The application has no authenticated principal/session model.

### Requirement
Before shared/public deployment:

- implement authentication;
- derive identity server-side;
- remove free-text reviewer identity as authority.

---

## P-02 — No Business-level authorization / tenant isolation

**Origin:** Codex HIGH; Claude HIGH.  
**Status:** **DEFERRED — PRODUCTION (BLOCKER)**

### Important distinction
Composite same-Business FKs enforce relational integrity.

They do **not** determine whether a user is allowed to access a Business.

### Requirement
Every user-facing read/write must verify Business access from the authenticated principal.

---

## P-03 — Human authority is structural, not identity security

**Origin:** Antigravity Critical framing; Codex/Claude security findings.  
**Status:** **DEFERRED — PRODUCTION**

### Current position
WeakSet-issued authority objects are useful structural/domain guards.

They do not prove a real authenticated person or role.

### Requirement
Once authentication exists, human authority must derive from authenticated session identity and authorization.

---

## P-04 — Permanent Delete lacks authenticated privileged authorization/re-authentication

**Origin:** Codex/Claude.  
**Status:** **DEFERRED — PRODUCTION**

The database deletion mechanism itself is strongly defended.

Production still requires:

- authenticated actor;
- appropriate owner/admin role;
- re-authentication/privileged confirmation policy;
- trusted audit identity.

---

## P-05 — No meaningful request/rate/AI-spend controls

**Origin:** Codex MEDIUM; Claude MEDIUM.  
**Status:** **DEFERRED — PRODUCTION**

Required before external exposure:

- source/body size limits;
- request rate limits;
- per-Business concurrency controls where needed;
- AI usage/spend limits;
- observable rejection reasons.

---

## P-06 — Stale-run recovery is request-driven only

**Origin:** Milestone 3D accepted limitation.  
**Status:** **DEFERRED — PRODUCTION**

Current behaviour is acceptable for the present local milestone.

Production should consider:

- scheduled/reaper recovery;
- operator visibility for stale runs;
- alerting.

---

## P-07 — Stale threshold is not constrained against provider duration

**Origin:** Milestone 3D architectural review.  
**Status:** **DEFERRED — PRODUCTION**

### Risk
A bad `AI_RUN_STALE_AFTER_MS` value could be shorter than the possible provider request duration and cause an active run to be treated as stale.

### Requirement
Validate/clamp configuration or derive it from the provider timeout/retry policy.

---

## P-08 — Structured logging and correlation are absent/incomplete

**Origin:** Codex MEDIUM; Claude MEDIUM.  
**Status:** **DEFERRED — PRODUCTION**

Required:

- structured server logs;
- Business/run/session/request correlation;
- typed public error codes;
- no secrets/raw source content unnecessarily logged.

---

## P-09 — Infrastructure errors can be converted to false 404s

**Origin:** Codex MEDIUM; Claude MEDIUM.  
**Status:** **DEFERRED — PRODUCTION**

Use typed not-found handling for actual absence.

Infrastructure/query failures should reach an error boundary/logging path instead of being silently converted into missing-resource behaviour.

---

## P-10 — Raw/internal error messages in redirect URLs

**Origin:** Codex/Claude.  
**Status:** **DEFERRED — PRODUCTION**

Replace raw exception text in URLs with stable public error codes/messages.

---

## P-11 — PostgreSQL pool/query/transaction configuration uses weak defaults

**Origin:** All three reviews.  
**Status:** **DEFERRED — PRODUCTION**

Configure:

- pool maximum;
- connection timeout;
- idle timeout;
- statement timeout;
- deployment/runtime guidance;
- transaction timeout as appropriate.

Continue keeping AI network calls outside DB transactions.

---

## P-12 — OpenAI client/runtime timeout/deployment strategy needs production hardening

**Origin:** Antigravity/Codex/Claude.  
**Status:** **PARTIALLY RESOLVED / DEFERRED — PRODUCTION**

Milestone 3D added explicit request timeout/retry behaviour.

Production still needs to assess:

- request-path versus background worker execution;
- deployment request limits;
- connection/client reuse where beneficial;
- retry/cost policy.

---

## P-13 — Backups, restore tests and migration rollback/runbook

**Origin:** Codex production-readiness assessment; Claude production debt.  
**Status:** **DEFERRED — PRODUCTION (BLOCKER)**

Define and test:

- backup schedule;
- restore procedure;
- restore drill;
- migration deployment;
- rollback/forward-fix procedure;
- incident handling.

---

## P-14 — Privacy, retention and subject-deletion policy

**Origin:** Codex/Claude production assessment.  
**Status:** **DEFERRED — PRODUCTION**

Needs explicit product/legal/operational definition before real multi-user deployment.

---

## P-15 — Security headers / explicit CSRF posture / external security review

**Origin:** Codex/Claude.  
**Status:** **DEFERRED — PRODUCTION**

Framework defaults are not a substitute for an explicit production review.

---

# D. BACKLOG / LOWER-PRIORITY TECHNICAL DEBT

## B-01 — Legacy partial `createQuestionAnswer()` path remains callable internally

**Origin:** Milestone 3D architectural review.  
**Status:** **BACKLOG**

No application route currently uses this partial path.

Verified 18 September 2026: `SourceSubmissionService.createQuestionAnswer()` is called only by two tests in `tests/fixtures/add-information-scenarios.ts`. It locks the Business and question, but does not check workflow state or perform the `ADD_EVIDENCE` transition.

Recommended later action:

- remove it; or
- mark/restrict it as internal/test-only.

---

## B-02 — Canonical snapshot builder assumes caller holds Business lock

**Origin:** Milestone 3D architectural review.  
**Status:** **BACKLOG**

Current callers satisfy the requirement.

Recommended:

- keep helper repository-internal; or
- document/type the lock/transaction precondition more explicitly.

---

## B-03 — Creation of a newer extraction run can invalidate an open review

**Origin:** Milestone 3D architectural review; corrected by code verification 18 September 2026.  
**Status:** **RESOLVED — 18 September 2026** (initial-intake UI path); direct repository use of `EvidenceExtractionRepository.createRun` remains unguarded but has no application caller that can conflict with an open review.

### Resolution
Initial intake now runs through `InitialIntakeService` and `InitialIntakeRepository.prepare` (`src/repositories/initial-intake-repository.ts`). One transaction locks the Business and workflow, decides availability with `initialIntakeAvailability` (`src/domain/initial-intake.ts`), applies the intake transitions, recovers a stale run and creates the `RUNNING` run. A new intake is refused while the latest initial run succeeded and awaits review, or is fresh and still running. The intake page shows the same decision instead of the form, and the action redirects to the open review or to Add Information. This also brings stale-run recovery to initial intake (see R-03).

Validation: shared initial-intake scenarios (PGlite and PostgreSQL), a PostgreSQL race test proving concurrent intake submissions commit exactly one run and one set of transitions, and unit tests for the availability rule.

### Correction
The earlier statement that "normal application flow does not currently do this" is not accurate for **initial intake**.

`runEvidenceExtractionAction` (`app/actions.ts`) blocks resubmission only when the latest run has a `sourceSubmissionId`. Initial-intake runs have none, and the intake page does not check workflow state. While the first review is open (`EVIDENCE_PROCESSING`), a user can submit intake again from the UI. That:

1. creates a newer extraction run;
2. makes the open review ineligible under R-04's latest-run guard;
3. leaves any decisions already accepted in that review in live canonical tables, where they will be included in the next snapshot created by a different review.

Add Information cycles are not affected, because their runs have a Source Submission.

### Required action
Block initial-intake extraction while the workflow is `EVIDENCE_PROCESSING` and the latest run is `RUNNING` or `SUCCEEDED` without a completed review, allowing it only after a `FAILED` (or stale-recovered) latest run. Preferably, move the intake orchestration out of the server action into a service, so it uses the same transactional pattern as Add Information (see also B-13).

---

## B-04 — One-answer-per-question uniqueness relies primarily on application locking

**Origin:** Codex MEDIUM; Claude LOW.  
**Status:** **BACKLOG**

Current approved path serializes through row locks.

Consider a forward migration adding `UNIQUE(question_id)` if one answer remains the durable product rule.

---

## B-05 — Review idempotency JSON comparison is key-order-sensitive

**Origin:** Codex LOW; Claude LOW.  
**Status:** **BACKLOG**

Replace `JSON.stringify` equality with structural/canonical JSON equality.

---

## B-06 — Evidence Coherence/read models load broad histories then filter in memory

**Origin:** All reviews.  
**Status:** **BACKLOG**

Examples:

- all finding references for Business;
- broad Business overview history.

Optimize when volume warrants.

---

## B-07 — Business status is unconstrained text

**Origin:** Codex LOW; Claude LOW.  
**Status:** **BACKLOG**

Consider a PostgreSQL CHECK/enum after verifying current data.

---

## B-08 — Snapshot `created_from_analysis_run_id` has unclear semantics/no integrity constraint

**Origin:** Codex LOW; Claude LOW.  
**Status:** **BACKLOG**

Before use:

- define exact meaning plus same-Business FK; or
- remove through an approved forward migration.

---

## B-09 — Other schema vocabulary/check constraints are incomplete

**Origin:** Claude LOW.  
**Status:** **BACKLOG**

Examples include free-text lifecycle/quality vocabulary.

Add constraints only where the product vocabulary is stable.

M4-11 note (19 September 2026): the reliability, directness and recency qualifiers are now visible and correctable before Accept. Their vocabulary is still uncontrolled free text (for example, recency "relevant"). This finding remains open as the follow-up.

---

## B-10 — Numeric precision/rounding edge cases

**Origin:** Claude LOW/MEDIUM.  
**Status:** **BACKLOG / overlaps M4-02**

`numeric(20,4)` can round higher-precision values.

Resolve alongside explicit precision semantics if Milestone 4 performs calculations.

M4-02A note (19 September 2026): semantic precision is now explicit (M4-02). Storage scale (`numeric(20,4)`) is unchanged and remains a separate concern.

---

## B-11 — Snapshot projection currently tolerates malformed JSON fields by coercion

**Origin:** Claude LOW.  
**Status:** **BACKLOG**

Consider a strict Zod snapshot payload validation step before projection.

---

## B-12 — Reproducibility metadata could be stronger

**Origin:** Claude LOW.  
**Status:** **BACKLOG**

Potential improvements:

- prompt-text hash;
- record served provider model;
- explicitly decide whether model identifier belongs in equivalent-run identity;
- use deterministic code-unit ordering rather than locale-sensitive sorting.

---

## B-13 — Initial intake provenance differs from later Source Submission provenance

**Origin:** Claude MEDIUM provenance review.  
**Status:** **BACKLOG / architecture decision**

Initial-intake extraction historically stores intake text on the run rather than a Source Submission.

Consider future unification, but do not rewrite historical provenance casually.

---

## B-14 — Some older provenance/audit tables have weaker trigger-level immutability

**Origin:** Claude MEDIUM.  
**Status:** **BACKLOG / PRODUCTION HARDENING**

Candidate tables noted in review:

- evidence extraction runs;
- review sessions;
- metrics;
- claim/evidence relationships;
- workflow transitions;
- restricted Claim mutation.

Any changes require forward migrations and PostgreSQL regression tests.

---

## B-15 — All-or-nothing extraction/coherence validation

**Origin:** Codex INFORMATIONAL; Claude MEDIUM.  
**Status:** **ACCEPTED DESIGN / BACKLOG**

Current conservative behaviour protects provenance and avoids presenting a partial model output as complete.

Do not weaken it casually.

Consider partial/quarantined proposal handling only if retry friction becomes materially problematic.

---

## B-16 — `admitFactAction` currently submits a single evidence ID from the UI

**Origin:** Antigravity HIGH.  
**Status:** **BACKLOG / NOT A CURRENT INTEGRITY DEFECT**

The domain supports multiple supporting Evidence IDs.

The UI currently provides a narrower path.

Expand only if the product requires multi-evidence fact admission from the UI.

---

## B-17 — WeakSet authority state is process/hot-reload/serialization fragile

**Origin:** Antigravity MEDIUM/LOW.  
**Status:** **BACKLOG**

These tokens are structural command guards, not serialized security credentials.

No current production defect is established.

---

## B-18 — OpenAI client instantiation per call

**Origin:** Antigravity MEDIUM.  
**Status:** **BACKLOG**

Evaluate client reuse as part of production deployment/runtime tuning.

---

## B-19 — `REJECT_PHASE1` and `REQUEST_REVISION` currently share the same target state

**Origin:** Antigravity MEDIUM.  
**Status:** **ACCEPTED DESIGN / MILESTONE 4 REVIEW**

Re-evaluate the semantic distinction when Phase 1 diagnosis/review is designed.

Do not add a new workflow state merely for symmetry.

---

## B-20 — Evidence lifecycle filtering asymmetry is future-looking

**Origin:** Antigravity MEDIUM.  
**Status:** **BACKLOG**

Current Evidence immutability means there is no demonstrated active/stale Evidence lifecycle defect.

Revisit only if Evidence later gains explicit lifecycle status.

---

## B-21 — Migration lists / schema setup duplication in tests

**Origin:** Antigravity MEDIUM.  
**Status:** **RESOLVED — M4-02A (19 September 2026)**

`tests/helpers/pglite-migrations.ts` applies every migration in `drizzle/meta/_journal.json`, in order. All nine PGlite integration files use it, replacing hardcoded lists, some of which had missed later migrations. PostgreSQL suites still rely on the test database being migrated with `drizzle-kit migrate`.

Centralize migration setup if hardcoded lists still exist.

---

## B-22 — Metric correction can coerce blank string to zero

**Origin:** Antigravity LOW.  
**Status:** **RESOLVED — M4-02A (19 September 2026)**

The Metric correction in `app/actions.ts` now parses `numericValue` and the range bounds with `nullableNumber`, so a cleared field is missing, not `0`. It is required again unless the precision is `range`.

Original finding:

`Number("") === 0`

Verified: `app/actions.ts` line 190 still parses a metric correction with `Number(text(formData, "numericValue"))`, so a cleared field becomes `0`. Impact is low, because the corrected value must still appear in the original excerpt and usually fails that check. Parse blank as missing rather than zero.

---

## B-23 — Permanent Delete verification performs many COUNT queries

**Origin:** Antigravity LOW.  
**Status:** **BACKLOG**

Safety is currently more important than micro-optimization.

Optimize only if measured transaction duration becomes material.

---

## B-24 — Claim-type contract differences (`decision`)

**Origin:** Antigravity LOW; Claude related alternate-write-path concern.  
**Status:** **BACKLOG — CONFIRMED STILL PRESENT (18 September 2026)**

Verified: Milestone 3D added archive locking to the Foundation write path but did not remove it. `FoundationRepository.addClaim` and `supersedeClaim` block `fact` but still accept `decision`, whereas Evidence Review rejects both. The path has no UI caller (tests only). Block `decision` there, or restrict the Foundation writers to test use.

---

## B-25 — Evidence State can show live state ahead of latest snapshot

**Origin:** Claude LOW / Codex informational architecture note.  
**Status:** **ACCEPTED DESIGN / UX BACKLOG**

Per-decision canonical writes occur before review completion; snapshot catches up at completion.

UI should make the distinction clear if user confusion emerges.

Milestone 4 must always use snapshots, not this live view.

---

## B-26 — Progress labels/counts have small inconsistencies

**Origin:** Claude LOW.  
**Status:** **BACKLOG**

Examples:

- question stage label;
- workspace counts;
- superseded relationship display.

No architectural impact.

---

## B-27 — README/setup/architecture discoverability needs improvement

**Origin:** Codex MEDIUM; Claude LOW.  
**Status:** **BACKLOG / MILESTONE 4 ENGINEERING HYGIENE**

Before handing significant Milestone 4 work to new agents, ensure README/docs cover:

- setup;
- environment variable names;
- PostgreSQL/test DB creation;
- migration procedure;
- tests;
- architecture;
- current production-readiness restrictions.

---

## B-28 — Concurrent Add Information retries both call the model

**Origin:** Code verification, 18 September 2026 (residual of the original Claude HIGH retry finding).  
**Status:** **BACKLOG**

`AddInformationService.retry` checks eligibility (latest failed run, `EVIDENCE_PROCESSING`) without a lock, and `EvidenceExtractionRepository.createRun` locks only the Business row. Two simultaneous retries can both create runs and both incur a model call.

This is now safe for integrity (R-04 makes only the newest run reviewable), but it wastes spend and leaves an extra run. Re-check "latest run is FAILED" inside the `createRun` transaction after taking the Business lock.

---

## B-29 — PostgreSQL guard unit test depends on the environment

**Origin:** Code verification, 18 September 2026.  
**Status:** **RESOLVED — M4-02A (19 September 2026)**

The test now stubs `TEST_DATABASE_URL` to empty for the no-argument check and restores it afterwards. It passes with and without the variable set.

`tests/unit/postgres-test-guard.test.ts` line 25 calls `requirePostgresTestDatabaseUrl()` with no argument and expects it to throw. When `TEST_DATABASE_URL` is set, as CI would normally do when running both suites, the test fails. Pass `undefined` explicitly or stub the environment variable.

---

## B-30 — Snapshot relationship ordering is not fully deterministic

**Origin:** Code verification, 18 September 2026.  
**Status:** **BACKLOG**

`createCanonicalSnapshot` orders `claim_evidence` by `(claim_id, evidence_id)`, but the primary key also includes `relationship_type`. If one Claim/Evidence pair has more than one relationship type, their order is unspecified. Add `relationship_type` to the ordering.

---

## B-31 — Live model occasionally converts compound number words ("five-day" → 5)

**Origin:** H4 live-model validation, 19 September 2026.\
**Status:** **BACKLOG — non-blocking observation**

In one of three `evidence_extractor_v6` runs, `gpt-5.6-luna` proposed the value 5 from "a five-day week", although the prompt says compound number words stay qualitative. The deterministic validator rejected the run as designed, so no invalid value could reach review. Because validation is all-or-nothing (B-15), the run's correct items were discarded too, and a retry is needed.

This does not reopen M4-02 or M4-10: the rule is aligned and enforced. The sample (7 calls) is too small to estimate a rate. If rejections become frequent in real use, consider adding "five-day" to the prompt's compound examples (a new prompt version) or revisiting B-15. See `docs/m4-02a-h4-live-model-validation.md`.

---

## B-32 — `PHASE1_AWAITING_REVIEW + ADD_EVIDENCE` is defined but not reachable

**Origin:** PR #13 revision-route verification, 21 September 2026.**Status:** **BACKLOG — non-blocking workflow observation**

The state machine allows `PHASE1_AWAITING_REVIEW + ADD_EVIDENCE → EVIDENCE_PROCESSING`, but ordinary Add Information (`addInformationStates`) does not accept `PHASE1_AWAITING_REVIEW`, so no command can use the rule. This does not block review: a reviewer can decide the diagnosis or request a revision, and `REVISION_REQUIRED` accepts Add Information.

Decide whether evidence may be added mid-review, which would leave the open review on an older snapshot, or remove the rule. Deliberately out of scope for PR #13.

---

## B-33 — SQL migrations are checked out with platform line endings

**Origin:** Live `0007_phase1_diagnosis` migration, 22 September 2026.\
**Status:** **BACKLOG — non-blocking hygiene**

`core.autocrlf` checks SQL migrations out with CRLF on Windows. Live `baslon_os` therefore records CRLF hashes for `0006` and `0007`, which differ from the LF hashes on `baslon_os_test`, and the `0007` function bodies on live contain carriage returns.

There is no behavioural impact: every CR sits outside string literals, and the schema matches `baslon_os_test` once CRs are removed. Add a repository `.gitattributes` rule such as `*.sql text eol=lf` so future migrations are checked out and journaled consistently across Windows and test environments. Do not rewrite the existing journal rows.

---

# E. ACCEPTED DESIGN DECISIONS TO PRESERVE

These were reviewed and should not be casually refactored away.

## AD-01 — AI proposes; humans admit canonical truth

AI extraction creates proposals only.

Canonical Evidence admission requires the approved human review/application path.

---

## AD-02 — Evidence Coherence is analytical, not canonical

Contradictions, gaps and questions do not modify Claims/Evidence/Metrics.

---

## AD-03 — Historical snapshots are immutable

Later evidence produces a new snapshot.

Never rewrite an old snapshot.

---

## AD-04 — Historical analytical findings remain immutable

A later snapshot gets a new analysis.

Do not mutate old findings to “resolved”.

---

## AD-05 — Analysis reads an exact snapshot

Never reconstruct historical analysis input from live current state.

---

## AD-06 — Model calls stay outside database transactions

Prepare/authorize work transactionally, then call the external model after commit.

Completion is its own guarded transaction.

---

## AD-07 — Permanent Delete remains explicit and restrictive

Do not introduce `ON DELETE CASCADE` merely to simplify Business deletion.

---

## AD-08 — Same-Business foreign keys are relational integrity, not authorization

Keep the composite FK defence.

Add real authorization separately before deployment.

---

## AD-09 — `strengthScore` means semantic-link confidence only

Do not reinterpret it as evidence weight, truth probability or diagnostic confidence.

---

## AD-10 — Question context is not evidence

Human answer is the evidentiary source.

The question is interpretive context only.

---

# F. Milestone 4 Entry Checklist

Before Milestone 4 diagnosis implementation begins, explicitly close or approve the following:

- [x] Decide the `GAP_RESOLUTION_REQUIRED` path. Resolved by Milestone 4A: Add Information (with or without a question) or human `CONTINUE_WITH_GAPS` → `PHASE1_READY`, with Add Information also available from `PHASE1_READY` (M4-01).
- [x] Block initial-intake resubmission while an initial review is open. Resolved 18 September 2026 (B-03).
- [x] Show, or explicitly treat as AI-assigned, the qualifiers committed on Accept (M4-11). Resolved: the complete canonical object is shown before Accept; older records are labelled at read time.
- [x] Define one exact snapshot-bound diagnosis input contract. Resolved by M4-05 (`phase1_diagnosis_input_v1`).
- [x] Define diagnosis output as separate non-canonical analytical persistence. Resolved by M4-05 (migration `0007`, live on `baslon_os`).
- [x] Define human diagnosis approval as a separate immutable record. Resolved by M4-07 (`approved_diagnoses`).
- [x] Define transaction-scoped artifact preconditions for diagnosis transitions. Resolved by M4-04 (`CONTINUE_WITH_GAPS`, `GENERATE_PHASE1`, Phase 1 `MARK_ANALYSIS_COMPLETE`, `APPROVE_PHASE1`).
- [x] Decide how diagnosis treats approximate/range numeric evidence. Foundation in place (M4-02A): explicit precision, range bounds and the rule that a derived result cannot be more precise than its least-precise input. Resolved by M4-06: precision is carried, preserved in calculations, and guarded.
- [x] Ensure diagnosis does not use `strengthScore` as truth/evidence weight. Resolved by M4-06.
- [ ] Ensure contextual question text cannot become canonical evidence through a diagnosis shortcut. *The diagnosis input carries no question text, and diagnosis writes no canonical state; M4-03 itself stays open.*
- [x] Verify every new Business-owned table is included in Permanent Delete and PostgreSQL tests. The seven diagnosis tables are included and PostgreSQL-tested; coverage re-verified after the live `0007` migration.
- [x] Re-check PostgreSQL test database guards before adding new suites. Verified 18 September 2026: all 9 files use the shared guard; new suites must use it too (M4-09).
- [x] Align written-number prompt/validator if the extractor contract changes during the milestone. Resolved by M4-02A (M4-10).
- [ ] Do not implement production authentication/security work inside Milestone 4 unless explicitly scoped.

---

# G. Production Gate

Baslon OS must not be described as public-production-ready until, at minimum:

- [ ] Authentication exists.
- [ ] Business/tenant authorization exists on every user-facing read/write.
- [ ] Actor/reviewer identity is session-derived.
- [ ] Permanent Delete is privileged and audited to a trusted identity.
- [ ] Input/rate/AI-spend limits exist.
- [ ] Structured logging/correlation exists.
- [ ] Infrastructure errors are not hidden as 404s.
- [ ] Raw errors are not placed in URLs.
- [ ] PostgreSQL pool/query/transaction timeouts are explicitly configured.
- [ ] AI execution/recovery strategy is appropriate to deployment runtime.
- [ ] Backups and restore drills exist.
- [ ] Migration/deployment rollback/forward-fix runbooks exist.
- [ ] Privacy/retention/deletion obligations are defined.
- [ ] Security headers/CSRF posture are explicitly reviewed.
- [ ] CI automatically runs the required gates, including isolated PostgreSQL tests.

---

# H. Current Solution Architect Verdict

The three code reviews did **not** reveal a need to rewrite Baslon OS.

Milestone 3D successfully addressed the core command-boundary, concurrency, run-lifecycle, archive, review-currency, snapshot and relationship-semantics risks that would have been dangerous to carry into diagnosis.

The remaining findings fall into three groups:

1. **Milestone 4 architectural/product decisions** — especially `GAP_RESOLUTION_REQUIRED`, diagnosis snapshot boundaries and numeric/context semantics.
2. **Production-readiness work** — authentication, authorization, observability, rate/cost controls, deployment/database operations and privacy.
3. **Lower-priority backlog** — performance, schema tightening, UI polish and internal API cleanup.

The next milestone should therefore proceed from the clean Milestone 3D checkpoint without reopening already-settled architecture unless new evidence demonstrates a defect.

---

# I. Code Verification Record — 18 September 2026

**Scope:** Every RESOLVED entry (R-01 to R-15) plus the REVERIFY items, checked against the code at `44e2bc1` on branch `claude/milestone-4` (application code identical to `aeb00ef` on `main`).  
**Method:** Code inspection of the changes since `3c77a48`, plus a full test run. No application code or data was modified.

## Test results

| Gate | Result |
|---|---|
| Unit + integration (`npm test`) | 21 files, 153 tests passed with `TEST_DATABASE_URL` unset. One guard unit test fails when it is set (B-29). |
| PostgreSQL (`npm run test:postgres`) | 9 files, 57 tests passed against `baslon_os_test` (PostgreSQL 17.11) |
| TypeScript | Passed |
| ESLint | Passed |

## Outcome by entry

| Entry | Verification outcome |
|---|---|
| R-01 | Confirmed: one transaction in `AddInformationRepository.prepare`, Business → workflow → question lock order, model call after commit. |
| R-02 | Confirmed: conditional stale recovery, reconciliation inside the failure boundary, 60 s timeout with 2 retries. |
| R-03 | Confirmed for Add Information retry. Not applied to initial intake (see R-03 note and B-03). |
| R-04 | Confirmed in the repository. One UI path remains (B-03). |
| R-05 | Confirmed across strategic write paths; covered by the archive race suite. |
| R-06 | Confirmed: both completion transactions lock and re-check the Business. |
| R-07 | Confirmed. Preconditions must also take their own locks (see R-07 note). |
| R-08 | Confirmed: coherence reads filter on `module = 'evidence_coherence'`. |
| R-09 | Confirmed; minor ordering gap recorded as B-30. |
| R-10, R-11 | Superseded status accepted; no contrary evidence found. |
| R-12 | Confirmed. This behaviour predates Milestone 3D. |
| R-13 | Confirmed for `strengthScore`; the other qualifiers are recorded as M4-11. |
| R-14, R-15 | Confirmed: `evidence_coherence_v2` defines the semantics; v1 and v2 identities coexist. |
| M4-01 | Found partially resolved (ordinary Add Information from `GAP_RESOLUTION_REQUIRED` works). |
| M4-09 | Guard resolved; CI outstanding. |
| B-01 | Confirmed still callable; tests only. |
| B-03 | Corrected and reclassified to Milestone 4. |
| B-22 | Confirmed still present. |
| B-24 | Confirmed still present. |

## New entries

M4-11, B-28, B-29, B-30.
