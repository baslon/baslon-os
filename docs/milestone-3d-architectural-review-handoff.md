# Milestone 3D Architectural Review Handoff

## Repository State

- Branch: `main`
- HEAD: `aebd25a7d9cf3eb454f5a8213aa6eef0930b40c0`
- Commit: `aebd25a Harden archive-safe strategic writes`
- Working tree was already uncommitted when this review began.
- Nothing is staged.
- Review was read-only; no files were changed during the review.
- At review time, the current diff contained 40 tracked modified files and 4 untracked files, with 1,213 insertions and 247 deletions. Untracked files were not included in that statistic.

## A. Add Information Transaction

The user-facing Add Information command is correctly consolidated in `src/repositories/add-information-repository.ts`.

One database transaction now performs:

1. Active-Business row lock and check.
2. Workflow row lock.
3. Workflow-state validation.
4. Optional Evidence Quality question lock and current-context validation.
5. Source Submission creation.
6. Optional question/source link creation.
7. `ADD_EVIDENCE` workflow transition and transition-history insertion.
8. Initial `RUNNING` extraction-run creation.

The model call occurs after this transaction commits, as required.

If any database operation fails, the complete command rolls back. There is no orphan Source Submission, question link, transition or extraction run.

Concurrency behavior is sound:

- Business row is locked before workflow or question rows.
- Concurrent ordinary submissions serialize through the workflow row and state.
- Concurrent answers to the same question serialize through the workflow/question locks.
- Exactly one valid competing submission succeeds.

Provider or validation failure after preparation preserves:

- the immutable Source Submission;
- the question/source link, if applicable;
- the workflow transition;
- the terminal failed run.

Retry uses the same Source Submission and creates a new extraction run without duplicating the source, question link or workflow transition.

One legacy internal boundary remains: `SourceSubmissionService.createQuestionAnswer()` can still create a Source Submission and question link without the complete Add Information command. No application route currently uses it, but it remains a callable partial path. This should either be made explicitly internal/test-only or removed once all callers use `AddInformationService`.

## B. RUNNING Run Recovery

Recovery is deterministic and request-driven.

- Default stale threshold: 15 minutes.
- Optional configuration: `AI_RUN_STALE_AFTER_MS`.
- Both OpenAI adapters use a 60-second timeout with two SDK retries.
- Stale recovery uses conditional database updates requiring:
  - the correct run ID;
  - the correct Business ID;
  - `RUNNING` status;
  - a start/create timestamp at or before the calculated cutoff.
- Successful recovery marks the abandoned run `FAILED` with the audited `stale_run_recovered` error.
- Terminal runs cannot be recovered or overwritten.
- The unique active-analysis identity permits a replacement run after the old run becomes `FAILED`.
- Competing recovery attempts are handled by the conditional update and run reload.

The main operational risk is configuration: `AI_RUN_STALE_AFTER_MS` can be configured below the provider’s possible request duration. A second request could then mark a genuinely active run stale. The default configuration avoids this, but the relationship is not enforced.

Recovery is request-driven only; there is no scheduled abandoned-run cleanup. That is acceptable for the present milestone.

## C. Archive-Safe Writes

The reusable guard in `src/repositories/business-lifecycle-guard.ts` locks the Business row with `FOR UPDATE` and rejects archived Businesses.

Protected strategic mutation paths include:

- business-profile updates;
- Claims and Claim supersession;
- Evidence;
- Claim/Evidence relationships;
- Metrics;
- canonical snapshots;
- fact admission;
- Source Submissions and attachments;
- extraction-run creation;
- coherence-run creation;
- Evidence Review start, decision application and completion;
- workflow transitions;
- the atomic Add Information command.

Lock ordering is consistently Business-row-first for these operations. The PostgreSQL archive-race tests prove both outcomes:

- archive wins: the strategic write is rejected;
- write wins: the write commits before archive completes.

However, a material gap remains:

- `EvidenceExtractionRepository.completeRun()` can insert proposals and mark a run successful without locking or rechecking the Business.
- `EvidenceCoherenceRepository.completeRun()` can insert contradictions, gaps, references and questions without locking or rechecking the Business.

Therefore, this sequence is currently possible:

1. A run starts while the Business is active.
2. The external model call begins.
3. The Business is archived.
4. The model returns.
5. Proposals or analytical findings are persisted after archival.

The existing archive concurrency suite tests run creation, review writes, review completion and workflow mutation, but not extraction or coherence completion racing with archive.

`failRun()` and stale-run terminalisation also operate without the active-Business guard. Recording failure on an already-authorized historical run may reasonably be treated as operational audit completion rather than a strategic write, but that policy should be explicit. Successful completion unquestionably adds new Business-owned strategic or analytical records and requires protection.

## D. Workflow Preconditions

Workflow authority remains centralized:

- transition validity and actor authority are checked by the domain transition rules;
- workflow state and history are persisted transactionally;
- optimistic concurrency uses workflow state and version;
- history insertion failure rolls back the state update;
- AI actors still cannot perform human-only events.

The new event-specific precondition hook is understandable, but it is not transactionally safe.

Current order:

1. Read Business active status.
2. Read workflow.
3. Authorize transition.
4. Evaluate the registered precondition.
5. Open the repository transaction.
6. Lock Business.
7. Commit workflow state and history.

A database-backed artifact can change between steps 4 and 7. The callback receives no transaction handle and therefore cannot prove that its artifact check remains true when the transition commits.

No Milestone 4 artifact precondition is registered yet, so this is not currently causing a diagnosis transition to execute incorrectly. Nevertheless, the abstraction is intended for future artifact-backed transitions and currently provides a misleading safety boundary.

The smallest safe design is to evaluate event-specific persistence preconditions inside `PostgresWorkflowRepository.commit()`, after the Business/workflow locks and before the workflow update, using the same transaction.

No Phase 1 diagnosis tables or fabricated Milestone 4 artifacts were introduced.

## E. Evidence Review Eligibility

Review eligibility is substantially hardened.

For review start, decision application and open-session completion, the repository requires:

- the correct Business;
- the workflow to be `EVIDENCE_PROCESSING`;
- the selected extraction run to be the latest run;
- the run to have succeeded;
- the review session and proposals to belong to the same Business/run.

This prevents an older successful extraction from becoming reviewable after a newer run exists.

Completed-session retries remain idempotent and only allow safe workflow reconciliation where the relevant run is still current.

Historical review data remains readable.

A direct repository caller can still create a newer extraction run during `EVIDENCE_PROCESSING`, although the normal application flow does not do so. That would intentionally invalidate an existing open review. This is an internal API-hardening concern, not a current UI failure.

## F. Canonical Snapshot Builder

Snapshot construction is consolidated in `src/repositories/canonical-snapshot.ts`.

It is used by both:

- explicit Foundation snapshot creation;
- Evidence Review completion.

The builder captures the full canonical state:

- Business;
- Business Profile;
- Claims;
- Evidence;
- Claim/Evidence relationships;
- Metrics.

Deterministic ordering is applied to canonical collections. This improves reproducibility without changing the snapshot shape or meaning.

Historical snapshots are not modified. IDs and provenance remain intact.

Version allocation remains protected by the caller’s Business-row lock and the database uniqueness constraint.

The helper itself assumes its caller already holds the active-Business lock. Its current callers do. Keeping it repository-internal or documenting that precondition would make the boundary clearer.

## G. Evidence Coherence v2

The prompt change is narrowly scoped.

`evidence_coherence_v2` adds an explicit semantic definition of `strengthScore`:

- it represents confidence that the recorded relationship type is semantically appropriate;
- it is not Claim truth probability;
- it is not Evidence credibility, reliability, proof weight, corroboration, materiality or diagnostic confidence.

No analytical categories or structured-output fields were broadened.

Prompt identity is recorded on every analysis run. Historical v1 runs remain independently identifiable and immutable. V1 and v2 runs can coexist because active-run identity includes prompt version.

The prompt and validation continue to prohibit:

- diagnosis;
- root causes;
- recommendations;
- strategy;
- actions;
- forecasts;
- decisions;
- business-health scores;
- canonical-truth determination.

## Cross-Cutting Invariant Assessment

| Invariant | Assessment |
|---|---|
| AI call remains outside database transaction | Satisfied |
| Add Information preparation is atomic | Satisfied |
| Failed preparation leaves no partial records | Satisfied |
| Retry preserves original source provenance | Satisfied |
| Canonical Evidence changes only through human review | Satisfied |
| Snapshot construction is complete and deterministic | Satisfied |
| Workflow state/history are transactionally consistent | Satisfied |
| Actor authority remains enforced | Satisfied |
| Archived Businesses reject guarded strategic writes | Mostly satisfied |
| AI completion cannot write after archive | **Not satisfied** |
| Artifact precondition and transition commit are atomic | **Not satisfied** |
| Milestone 4 concepts remain out of scope | Satisfied |

## Technical Debt and Concerns

### Blocking Before Commit

1. Successful extraction and Evidence Coherence completion must acquire the Business-row lock and recheck active status before inserting proposals/findings or marking the run successful. Add PostgreSQL archive/completion race tests for both directions.
2. Workflow artifact preconditions must be evaluated within the workflow commit transaction after the relevant locks are acquired. The current pre-transaction callback has a time-of-check/time-of-use window.

### Safe to Defer

- Retire or restrict the legacy partial `createQuestionAnswer()` path.
- Make the canonical snapshot builder’s required caller lock explicit.
- Add repository-level prevention of creating an extraction run while an existing review is open, if direct repository use becomes broader.
- Add proactive cleanup for stale runs; request-driven recovery is adequate now.

### Future Production Concern

- Validate or clamp `AI_RUN_STALE_AFTER_MS` relative to provider timeout/retry behavior.
- Consider recording the effective stale threshold or recovery policy with run metadata for operational diagnosis.
- Confirm whether failure terminalisation after archival is deliberately allowed as audit completion and document that policy.

## Milestone 4 Contamination Check

No Milestone 4 diagnosis implementation was introduced.

The current changes do not add:

- diagnoses;
- root causes;
- recommendations;
- strategies;
- actions;
- business-health scores;
- diagnosis approval artifacts;
- new diagnosis UI;
- new diagnosis persistence.

Existing future workflow-state names remain from the original Foundation state machine; they are not newly implemented Milestone 4 behavior.

## Verification State

Latest completed validation for the reviewed working tree:

- ESLint: passed, no warnings.
- TypeScript: passed.
- Normal/unit/integration tests: 21 files, 153 tests passed.
- PostgreSQL suite: PostgreSQL 17.11, `baslon_os_test`, 9 files and 52 tests passed.
- Production build: passed.
- `git diff --check`: passed.
- `next-env.d.ts`: unchanged.
- Nothing staged.

The architectural review did not rerun the full suite because it was explicitly read-only and the completed results were already available. The final `git diff --check` and repository-state checks were rerun successfully.

## Overall Engineering Assessment

The implementation is generally disciplined and materially improves transactionality, concurrency handling, provenance preservation, workflow eligibility and snapshot consistency.

The Add Information command is correctly designed, and the test coverage is unusually strong. The two remaining issues are narrow, but they affect core safety claims:

- archival does not yet close every strategic write race;
- workflow artifact preconditions are not atomic with their transitions.

Both should be corrected before this hardening work is committed as complete.

## Recommendation to Solution Architect

**CHANGES REQUIRED BEFORE COMMIT**

Make only these minimum corrections:

1. Guard successful extraction and coherence completion with the transaction-scoped active-Business lock, maintaining Business-row-first ordering, and add real PostgreSQL archive/completion race tests.
2. Move event-specific workflow precondition evaluation inside the transition persistence transaction and test that an artifact cannot change between validation and transition commit.

At the conclusion of the review, no files had been modified by the review itself and nothing had been staged or committed.
