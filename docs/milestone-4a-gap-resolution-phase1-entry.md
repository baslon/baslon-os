# Milestone 4A — Gap Resolution & Phase 1 Entry

Milestone 4A makes `GAP_RESOLUTION_REQUIRED` a human resolution checkpoint and
adds a controlled, audited entry into `PHASE1_READY`. It does not implement Phase 1
diagnosis, diagnosis persistence, review or approval.

## Workflow

```text
EVIDENCE_READY ─RUN_GAP_ANALYSIS (system)→ GAP_ANALYSIS
GAP_ANALYSIS ─MARK_ANALYSIS_COMPLETE (system)→ GAP_RESOLUTION_REQUIRED

GAP_RESOLUTION_REQUIRED ─ADD_EVIDENCE (human)→ EVIDENCE_PROCESSING      with or without a question
GAP_RESOLUTION_REQUIRED ─CONTINUE_WITH_GAPS (human)→ PHASE1_READY
PHASE1_READY ─ADD_EVIDENCE (human)→ EVIDENCE_PROCESSING                 new in 4A
```

`PHASE1_READY ─ADD_EVIDENCE→` was added so a Business is not stranded in
`PHASE1_READY` before Phase 1 diagnosis exists. New information follows the usual
loop (review, cumulative snapshot, `EVIDENCE_READY`, a fresh Evidence Coherence
analysis) and must be continued again to re-enter `PHASE1_READY`.

## Add more information

Unprompted Add Information from `GAP_RESOLUTION_REQUIRED` already existed after
Milestone 3D. 4A extends the same eligibility (`acceptsAddInformation` in
`src/domain/workflow.ts`) to `PHASE1_READY` and reuses the unchanged atomic
`AddInformationRepository.prepare` command. Question answers are still accepted
only from `GAP_RESOLUTION_REQUIRED`, and the question remains interpretive context,
never evidence.

## Continue with known gaps

`GapResolutionService.continueWithGaps` selects the latest snapshot and its latest
successful `evidence_coherence` run, then asks the Strategy Orchestrator for the
human-only `CONTINUE_WITH_GAPS` event with actor `business-user`.

The transition commits through `PostgresWorkflowRepository.commit`, which locks
the active Business and workflow, checks state and version, re-authorizes the
actor, and runs `continueWithGapsPrecondition` in the same transaction. The
precondition requires that the recorded snapshot is the latest canonical snapshot
and the recorded run is a successful Evidence Coherence run of that snapshot for
the same Business. It is registered as a default on every orchestrator created by
`createStrategyOrchestrator`, so no caller can skip it.

## Audit

No new table or migration. The existing `workflow_transitions` row records the
actor type and identifier, time, from/to states and event. Its `metadata` records
`snapshotId`, `snapshotVersion`, `analysisRunId` and `analysisPromptVersion`, and
its `reason` states that the human chose to continue with known gaps.

Continuing never modifies contradictions, gaps, questions, analysis runs or
snapshots, and never marks anything resolved.

## User interface

In `GAP_RESOLUTION_REQUIRED`, Evidence Quality shows both options: "Add other
information" and "Continue with current evidence". The continue action is offered
only when the current (non-historical) analysis succeeded, and its wording states
that gaps remain open and findings stay unchanged. There is no confirmation dialog.
In `PHASE1_READY`, the page explains that diagnosis is not available yet and links
to Add Information. The workspace and Evidence State pages show Add Information in
all three eligible states.

## Validation

- Shared gap-resolution scenarios run on PGlite and PostgreSQL: zero surfaced
  questions (no findings, low-materiality only), durable audit, human-only actor,
  invalid source states, the snapshot precondition, archive rejection, and the
  `PHASE1_READY` Add Information loop.
- PostgreSQL race tests: concurrent continue requests commit once; a newer
  snapshot committed while the transition waits for the Business lock is rejected
  by the in-transaction precondition; archive winning the lock rejects the
  transition.
- Unit tests for transition rules, the default precondition registration and the
  Evidence Quality UI.

## Known limitations

- The actor identifier is the trusted-local `business-user`; authenticated
  identity remains a production blocker (P-01).
- `MARK_UNKNOWN` remains defined but unimplemented.
