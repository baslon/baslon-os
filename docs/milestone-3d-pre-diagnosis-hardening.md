# Milestone 3D — Pre-Diagnosis Hardening

Milestone 3D hardens the existing evidence workflow before Phase 1 diagnosis. It
does not add diagnosis artifacts or Milestone 4 behavior.

## Analysis isolation and recovery

Evidence Coherence repository reads always include `module =
evidence_coherence`. The generic `analysis_runs` identity already includes the
module, so test-only secondary modules can coexist without appearing in Evidence
Quality views or reconciliation.

A `RUNNING` AI run becomes recoverable only after `AI_RUN_STALE_AFTER_MS`
(15 minutes by default). Recovery performs a conditional `RUNNING` → `FAILED`
transition, records `stale_run_recovered`, preserves all original provenance and
then permits a new run. Fresh and terminal runs cannot be recovered. OpenAI calls
use a bounded 60-second request timeout and two SDK retries, shorter than the
default stale threshold. A newly created Evidence Coherence run is also inside
the failure boundary before workflow reconciliation, so reconciliation failure
cannot strand it.

## Archive and command atomicity

Every strategic write transaction locks and rechecks the Business row first.
Once archive owns that lock, a later strategic write cannot commit. A write that
already owns the lock completes before archive, preserving deterministic lock
ordering and avoiding partial post-archive state.

Add Information is one database command covering the immutable Source
Submission, optional question/source link, `ADD_EVIDENCE` workflow transition and
initial `RUNNING` extraction run. The provider call remains outside the
transaction. Any persistence failure rolls the whole command back. Provider or
validation failure preserves the source and terminal failed run; retry creates a
new run against the same source and never creates a second question answer.

Initial intake follows the same pattern. `InitialIntakeRepository.prepare` locks
the Business and workflow, applies any remaining `START_INTAKE`,
`SUBMIT_INTAKE` and `PROCESS_EVIDENCE` transitions and creates the `RUNNING`
extraction run in one transaction. It refuses a new intake while the latest
initial run succeeded and awaits review, or is still running and not yet stale,
so an open review can never be silently invalidated. A failed run permits a new
attempt, and a stale `RUNNING` run is terminally failed as `stale_run_recovered`
first. Once evidence has been reviewed, the intake page and action direct users
to Add Information instead.

Ordinary (unprompted) Add Information is accepted from both `EVIDENCE_READY` and
`GAP_RESOLUTION_REQUIRED`, so a Business whose analysis surfaced no answerable
question is never left without a way forward. The workspace, Evidence State and
Evidence Quality pages link to it in both states.

## Review and snapshots

Only the latest successful extraction while the workflow is
`EVIDENCE_PROCESSING` may start or receive review decisions. Review completion
uses the shared canonical snapshot builder. If the snapshot and completed review
commit but the following workflow transition fails, repeating completion creates
no duplicate snapshot and reconciles the workflow to `EVIDENCE_READY`.

## Workflow preconditions

The Strategy Orchestrator accepts event-specific precondition functions in
addition to state, actor and optimistic-version checks. A future Phase 1 event
can therefore require a current snapshot, successful analysis artifact or
completed human review before authorization is persisted. Milestone 3D creates
only this guard mechanism; it does not create placeholder Phase 1 artifacts.

## Relationship strength

`strengthScore` is nullable 0–1 confidence that the selected semantic
relationship type is appropriate. It is not Claim truth, Evidence credibility,
proof weight, reliability, corroboration, materiality or diagnostic confidence.
Evidence Review shows the value and this meaning before acceptance. Evidence
Coherence prompt `evidence_coherence_v2` explicitly preserves the same contract.

## Known limitations

- Recovery is request-driven; there is no background worker.
- The stale threshold is process configuration and not stored per run.
- Authentication and multi-user authorization remain outside the current product
  scope; server-derived actor boundaries remain the application authority.
- Phase 1 artifact-specific preconditions will be registered only when those
  artifacts exist in Milestone 4.
