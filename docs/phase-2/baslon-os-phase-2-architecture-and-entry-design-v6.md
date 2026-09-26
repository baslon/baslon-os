# Baslon OS — Phase 2 Architecture and Entry Design v6

**Status:** Final Product Owner Review Draft  
**Purpose:** Final core Phase 2 architecture before Pilot Fixture Architecture  
**Phase:** Phase 2 / Consultant Pilot Ready v1  
**Repository baseline reviewed by Claude Code:** `main` at `3e9f04a` (PR #28 merge), live `baslon_os` at migration 9, workflow `PHASE1_APPROVED` v21  
**Revision basis:** Phase 2 Architecture v5 plus Claude Code v5 review dated 23 September 2026

---

## 1. Governing principle

**AI proposes. Software validates/calculates. Humans make material strategic decisions.**

Phase 2 converts a current approved Phase 1 Diagnosis into:

1. **Approved Strategic Direction**
2. **Strategic Growth Plan**
3. **90-Day Execution Plan**

Phase 2 must not rewrite canonical evidence, invent evidence-gap resolution, rank or auto-select strategy, silently rebind to a newer diagnosis, mutate approved artifacts, or present derived calculations as realised results.

---

## 2. Gate A boundary

Gate A includes controlled Business entry into Phase 2, repeatable Phase 2 workspace creation, strategic-option generation and provenance, human option review and comparison, human strategic decision, approved Strategic Direction, Strategic Growth Plan, 90-Day Execution Plan, resettable pilot case, consultant/client output, light onboarding/help, controlled failure/retry, abandonment/restart without developer manipulation, and Phase 1 regression protection.

Gate B remains separate unless technically required for Pilot v1.

---

## 3. Business-level Phase 2 entry

### 3.1 Current repository reality

`PHASE1_APPROVED` is currently terminal in the Business-level Orchestrator.

### 3.2 Product Owner scope decision

Extend the Business-level workflow only enough to mark that the Business has entered Phase 2. Defer post-approval re-diagnosis.

### 3.3 One-time Business transition

```text
PHASE1_APPROVED
   ↓ START_PHASE2
PHASE2_STARTED
```

`PHASE2_STARTED` is intentionally coarse and remains true thereafter.

### 3.4 START_PHASE2 preconditions

`START_PHASE2` may succeed only when:

- Business exists;
- Business is active;
- Business workflow state is exactly `PHASE1_APPROVED`;
- a current approved diagnosis exists;
- the approved diagnosis belongs to the same Business;
- the diagnosis is bound to an immutable Snapshot.

The five Phase 2 analytical binding validations belong to workspace creation in §4 rather than the one-time Business transition.

### 3.5 Deferred re-diagnosis

Gate A does not add a path back into Phase 1 diagnosis generation/review after approval.

Supersession remains a forward-looking invariant with unit/domain test evidence only.

---

## 4. Repeatable Phase 2 workspace creation

Workspace creation is decoupled from the one-time Business-level `START_PHASE2` transition.

A new workspace is created through:

```text
CREATE_PHASE2_WORKSPACE
```

This operation is repeatable.

### 4.1 Initial atomic entry

When the Business is still `PHASE1_APPROVED`, the initial Phase 2 command must atomically:

1. lock/recheck the active Business;
2. validate the `START_PHASE2` preconditions;
3. validate workspace-entry preconditions;
4. transition Business to `PHASE2_STARTED`;
5. create the Phase 2 workspace and its binding/provenance records;
6. commit the full command together.

No intermediate committed state of `PHASE2_STARTED` without the intended initial workspace is permitted for this command.

### 4.2 Later workspace creation

When Business is already `PHASE2_STARTED`, `CREATE_PHASE2_WORKSPACE` creates a new workspace without changing Business-level workflow state.

### 4.3 Workspace creation preconditions

A workspace may be created only when:

- Business exists;
- Business is active;
- Business workflow is `PHASE1_APPROVED` or `PHASE2_STARTED`;
- a current approved Phase 1 Diagnosis exists;
- approved diagnosis belongs to the same Business;
- diagnosis is bound to an immutable Snapshot;
- all five analytical binding fields validate;
- no active workspace already exists for that approved diagnosis;
- evidence gaps remain explicit limitations;
- deterministic calculations remain marked derived;
- the user explicitly initiates workspace creation;
- for Pilot v1, fixture eligibility is satisfied according to the separate Pilot Fixture Architecture.

Failed workspace-entry validation creates no workspace row.

The failure is recorded through the audit/error mechanism with a human-visible reason and next action.

---

## 5. Phase 2 analytical binding

Every workspace permanently binds to:

- `approvedDiagnosisId`
- `diagnosisRunId`
- `snapshotId`
- `snapshotVersion`
- `snapshotContentHash`

It should also retain Business ID, approved diagnosis version, diagnosis approval timestamp, relevant evidence-gap identifiers, relevant deterministic calculation identifiers, and companion headline-set identity/version where present.

### 5.1 Binding validation

Validation means:

- `approvedDiagnosisId` identifies the approved diagnosis used as workspace basis;
- approved diagnosis `business_id` equals workspace `business_id`;
- `diagnosisRunId` equals the approved diagnosis analysis-run identity;
- `snapshotId` identifies the Snapshot used by that diagnosis;
- `snapshotVersion` equals that Snapshot version;
- `snapshotContentHash` matches the stable Snapshot content hash.

Cross-Business binding is always rejected.

### 5.2 snapshotContentHash

Preferred architecture: promote `snapshotContentHash` to first-class durable snapshot metadata.

Fallback: recompute stable Snapshot hash during validation and compare it with the persisted analysis-run value.

---

## 6. Active-workspace semantics

For duplicate-workspace prevention, a workspace is active in every state except:

- `PHASE2_COMPLETE`
- `PHASE2_ABANDONED`
- `PHASE2_SUPERSEDED`

A completed, abandoned, or superseded workspace does not block a new human-initiated workspace on the same approved diagnosis.

Two simultaneous active workspaces on the same approved diagnosis are not permitted.

---

## 7. Workspace state model

Detailed Phase 2 state belongs to the workspace.

### 7.1 Normal states

```text
PHASE2_ENTRY_VALIDATED
PHASE2_OPTIONS_GENERATING
PHASE2_OPTIONS_READY_FOR_REVIEW
PHASE2_OPTIONS_REVIEW_IN_PROGRESS
PHASE2_OPTIONS_REVIEWED
PHASE2_DECISION_IN_PROGRESS
PHASE2_DIRECTION_APPROVED
PHASE2_GROWTH_PLAN_GENERATING
PHASE2_GROWTH_PLAN_READY_FOR_REVIEW
PHASE2_GROWTH_PLAN_REVIEW_IN_PROGRESS
PHASE2_GROWTH_PLAN_APPROVED
PHASE2_EXECUTION_PLAN_GENERATING
PHASE2_EXECUTION_PLAN_READY_FOR_REVIEW
PHASE2_EXECUTION_PLAN_REVIEW_IN_PROGRESS
PHASE2_EXECUTION_PLAN_APPROVED
PHASE2_COMPLETE
```

### 7.2 Exceptional / terminal states

```text
PHASE2_GENERATION_FAILED
PHASE2_ABANDONED
PHASE2_SUPERSEDED
```

---

## 8. State entry, exit and activity rules

### PHASE2_ENTRY_VALIDATED
Entered: successful workspace creation.
Leaves: option generation; abandonment.
Active: yes.

### PHASE2_OPTIONS_GENERATING
Entered: after workspace entry; new option-set request; retry after option-generation failure.
Leaves: `PHASE2_OPTIONS_READY_FOR_REVIEW`; `PHASE2_GENERATION_FAILED`; abandonment; supersession.
Active: yes.

### PHASE2_OPTIONS_READY_FOR_REVIEW
Entered: successful valid option generation.
Leaves: `PHASE2_OPTIONS_REVIEW_IN_PROGRESS`; new option generation where permitted; abandonment; supersession.
Active: yes.

### PHASE2_OPTIONS_REVIEW_IN_PROGRESS
Entered: human begins option review.
Leaves: `PHASE2_OPTIONS_REVIEWED`; `PHASE2_OPTIONS_GENERATING`; abandonment; supersession.
Active: yes.

### PHASE2_OPTIONS_REVIEWED
Entered: option review completed.
Leaves: `PHASE2_DECISION_IN_PROGRESS`; `PHASE2_OPTIONS_GENERATING`; abandonment; supersession.
Active: yes.

### PHASE2_DECISION_IN_PROGRESS
Entered: reviewed options move to deliberation; successor Direction work starts.
Leaves: `PHASE2_DIRECTION_APPROVED`; `PHASE2_OPTIONS_GENERATING`; abandonment; supersession.
Active: yes.

### PHASE2_DIRECTION_APPROVED
Entered: human approves Strategic Direction.
Leaves: Growth Plan generation; abandonment; supersession.
Active: yes.

### PHASE2_GROWTH_PLAN_GENERATING
Entered: after Direction approval; successor Growth Plan work; retry after Growth Plan generation failure.
Leaves: `PHASE2_GROWTH_PLAN_READY_FOR_REVIEW`; `PHASE2_GENERATION_FAILED`; abandonment; supersession.
Active: yes.

### PHASE2_GROWTH_PLAN_READY_FOR_REVIEW
Entered: successful valid Growth Plan generation.
Leaves: `PHASE2_GROWTH_PLAN_REVIEW_IN_PROGRESS`; `PHASE2_DECISION_IN_PROGRESS` via successor Direction; abandonment; supersession.
Active: yes.

### PHASE2_GROWTH_PLAN_REVIEW_IN_PROGRESS
Entered: human begins Growth Plan review.
Leaves: `PHASE2_GROWTH_PLAN_APPROVED`; `PHASE2_DECISION_IN_PROGRESS` via successor Direction; abandonment; supersession.
Active: yes.

### PHASE2_GROWTH_PLAN_APPROVED
Entered: human approves Growth Plan.
Leaves: Execution Plan generation; abandonment; supersession.
Active: yes.

### PHASE2_EXECUTION_PLAN_GENERATING
Entered: after Growth Plan approval; retry after Execution Plan generation failure.
Leaves: `PHASE2_EXECUTION_PLAN_READY_FOR_REVIEW`; `PHASE2_GENERATION_FAILED`; abandonment; supersession.
Active: yes.

### PHASE2_EXECUTION_PLAN_READY_FOR_REVIEW
Entered: successful valid 90-Day Plan generation.
Leaves: `PHASE2_EXECUTION_PLAN_REVIEW_IN_PROGRESS`; successor Growth Plan; successor Direction; abandonment; supersession.
Active: yes.

### PHASE2_EXECUTION_PLAN_REVIEW_IN_PROGRESS
Entered: human begins 90-Day Plan review.
Leaves: `PHASE2_EXECUTION_PLAN_APPROVED`; successor Growth Plan; successor Direction; abandonment; supersession.
Active: yes.

### PHASE2_EXECUTION_PLAN_APPROVED
Entered: human approves 90-Day Plan.
Leaves: `PHASE2_COMPLETE`; abandonment; supersession.
Active: yes.

### PHASE2_GENERATION_FAILED
Entered: generation/validation failure for a recorded module.
Leaves: retry to the corresponding generating state; abandonment; supersession.
Active: yes.

The workspace must persist enough context to know the failed module and prior generating state.

### PHASE2_ABANDONED
Entered: explicit human `ABANDON_PHASE2_WORKSPACE` from any active state.
Leaves: none for that workspace.
Active: no.

All existing artifacts remain immutable/historical.

### PHASE2_SUPERSEDED
Entered: a higher-version approved diagnosis exists for the same Business.
Leaves: none for material work on that branch.
Active: no.

### PHASE2_COMPLETE
Entered: explicit human `COMPLETE_PHASE2` from `PHASE2_EXECUTION_PLAN_APPROVED`.
Leaves: none for that workspace.
Active: no.

---

## 9. Human-directed transition rules

### 9.1 Abandon workspace

```text
ANY ACTIVE PHASE2 WORKSPACE STATE
   ↓ ABANDON_PHASE2_WORKSPACE
PHASE2_ABANDONED
```

Abandonment is explicit human action.

It does not delete proposals, approvals, plans, reviews or audit history.

### 9.2 Reject option set during review

```text
PHASE2_OPTIONS_REVIEW_IN_PROGRESS
   ↓ REQUEST_NEW_OPTION_SET
PHASE2_OPTIONS_GENERATING
```

### 9.3 Reject option set after review

```text
PHASE2_OPTIONS_REVIEWED
   ↓ REQUEST_NEW_OPTION_SET
PHASE2_OPTIONS_GENERATING
```

### 9.4 Reject option set during decision

```text
PHASE2_DECISION_IN_PROGRESS
   ↓ REQUEST_NEW_OPTION_SET
PHASE2_OPTIONS_GENERATING
```

### 9.5 Start successor Strategic Direction

Allowed from:

```text
PHASE2_GROWTH_PLAN_READY_FOR_REVIEW
PHASE2_GROWTH_PLAN_REVIEW_IN_PROGRESS
PHASE2_EXECUTION_PLAN_READY_FOR_REVIEW
PHASE2_EXECUTION_PLAN_REVIEW_IN_PROGRESS
```

Transition:

```text
↓ START_SUCCESSOR_DIRECTION
PHASE2_DECISION_IN_PROGRESS
```

Record predecessor approved Direction version and reason.

### 9.6 Start successor Growth Plan

Allowed from:

```text
PHASE2_EXECUTION_PLAN_READY_FOR_REVIEW
PHASE2_EXECUTION_PLAN_REVIEW_IN_PROGRESS
```

Transition:

```text
↓ START_SUCCESSOR_GROWTH_PLAN
PHASE2_GROWTH_PLAN_GENERATING
```

Record predecessor approved Growth Plan version and reason.

### 9.7 Completion

```text
PHASE2_EXECUTION_PLAN_APPROVED
   ↓ COMPLETE_PHASE2
PHASE2_COMPLETE
```

Completion is explicit human action.

### 9.8 Hard prohibition

No transition may reopen an approved artifact for in-place editing.

Material change always creates a successor version.

---

## 10. Downstream supersession and current-version coherence

Approving an upstream successor changes which downstream approved artifacts remain current.

### 10.1 Successor Strategic Direction

When Strategic Direction v2 is approved:

- Strategic Direction v1 remains immutable and historical;
- approved Growth Plans derived from Direction v1 are marked superseded/historical;
- approved 90-Day Plans derived from those Growth Plans are marked superseded/historical;
- a new Growth Plan must be created against Direction v2 before a current coherent 90-Day Plan can exist.

### 10.2 Successor Growth Plan

When Growth Plan v2 is approved:

- Growth Plan v1 remains immutable and historical;
- approved 90-Day Plans derived from Growth Plan v1 are marked superseded/historical;
- a new 90-Day Plan must be created against Growth Plan v2.

### 10.3 Final Output

Final Output presents only the **current coherent approved version set**:

- current approved Strategic Direction;
- current approved Growth Plan derived from that Direction;
- current approved 90-Day Plan derived from that Growth Plan.

Superseded approved versions remain accessible in history/audit and are clearly labelled historical.

---

## 11. Workspace supersession by newer diagnosis

A workspace becomes `PHASE2_SUPERSEDED` whenever a higher-version approved diagnosis exists for the same Business.

This transition is legally available from **every active workspace state**.

A newer Snapshot alone does not supersede.

When superseded:

- approved artifacts remain immutable;
- drafts remain visible but cannot be approved;
- no silent rebinding occurs;
- successor workspace creation is human-initiated.

### Mid-generation supersession

If a model call is in progress:

- allow it to complete;
- revalidate before persistence;
- reject result from becoming valid proposal;
- terminally record run as invalidated due to superseded analytical basis;
- do not treat it as abandoned-run recovery.

---

## 12. Strategic Option Proposal Set

Allowed range:

```text
2–4
Normal target: 3
```

Each option must represent a materially distinct route and include stable identifier, title, thesis, supporting diagnosis items, affected evidence gaps, constraints, assumptions, major moves, benefits, trade-offs, risks, required capabilities/resources, near-term implications and provenance.

### Below two

Fail closed with human-visible reason. Never pad.

### Above four

Fail validation.

Automatic retry may be used, but where automatically invoked it must be bounded.

If exhausted, surface a human-visible reason and next action.

Never silently truncate.

### Prohibited behaviours

No system ranking, winner scoring, preferred-route labels, preselection, plan/action ranking, negative inference from missing evidence, truth weighting from confidence/reliability/directness/recency/`strengthScore`, derived calculations presented as realised outcomes, derived calculations turned into targets without explicit human adoption, or persisted private chain-of-thought.

---

## 13. Strategic option review

Original AI proposals are immutable.

Review decisions:

- `ACCEPTED`
- `CORRECTED`
- `REJECTED`

Pairing rule:

- `CORRECTED` requires corrected payload;
- all other decisions require corrected payload null.

Before deliberation, the human confirms the set is understandable, genuinely distinct, relevant to the approved diagnosis, not based on invented facts, and adequate for meaningful strategic deliberation.

---

## 14. Option comparison

Comparison remains descriptive, not weighted.

Recommended dimensions: thesis, diagnosis findings addressed, evidence gaps, opportunity pursued, trade-offs, constraints, capabilities, dependencies, risks, time horizon and assumptions.

---

## 15. Provenance

```text
Canonical Evidence
      ↓
Immutable Snapshot
      ↓
Deterministic Calculations (derived)
      ↓
Analysis Run
      ↓
Approved Diagnosis
      ↓
Evidence Gaps carried as limitations
      ↓
Strategic Option Proposals
      ↓
Option Review Decisions / Corrections
      ↓
Human Strategic Decision
      ↓
Approved Strategic Direction
      ↓
Strategic Growth Plan
      ↓
90-Day Execution Plan
```

Cross-Business binding is rejected.

Derived calculations remain derived.

---

## 16. AI contract discipline

Every Phase 2 AI module must use explicit structured output, runtime validation, versioned prompt/contract identifiers, persisted `prompt_version`, persisted `input_hash`, validation error recording, safe failure, historical contract resolution from persisted provenance, and explicit failure on unknown historical versions.

AI proposes.

AI does not decide, approve, rewrite canonical evidence, invent gap resolution or persist hidden reasoning.

---

## 17. Deterministic software responsibilities

Software must validate Business/workflow/artifact entry conditions separately, verify same-Business binding, verify analytical binding fields, enforce workspace-state legality, enforce active-workspace uniqueness, enforce option bounds, preserve immutable proposals/reviews/approvals, enforce downstream dependencies, manage run recovery and record audit events.

Strategic writes must:

- lock and recheck active Business state;
- recheck event-specific artifact preconditions;
- make multi-record writes atomic;
- keep external AI calls outside database transactions.

---

## 18. Human checkpoints

1. Option Review
2. Strategic Direction Approval
3. Growth Plan Approval
4. 90-Day Plan Approval
5. Explicit Phase 2 Completion

Abandonment remains available as an explicit human exit from any active workspace state.

---

## 19. Versioning and immutability

Original proposals are immutable.

Approved Direction, Growth Plan and 90-Day Plan versions are immutable.

Material change creates a successor version.

Downstream superseded versions remain immutable and historical.

Historical runs, reviews, approvals and predecessors remain accessible.

Successor artifacts identify the approved predecessor they supersede.

---

## 20. Failure and retry

Phase 2 reuses the established analysis-run recovery pattern:

- module-scoped lookup;
- abandoned `RUNNING` run terminally failed before replacement;
- historical runs never rewritten/deleted;
- invalid AI output fails safely;
- workspace enters `PHASE2_GENERATION_FAILED` on generation failure;
- workspace records failed module and prior generating state;
- retry returns to that module's generating state;
- automatic retry is bounded where used;
- exhausted automatic retry surfaces a human-visible next action;
- repeated requests cannot create duplicate approved artifacts.

Supersession invalidation is distinct from abandoned-run recovery.

---

## 21. Approved Strategic Direction

Recommended contents: title, direction statement, why chosen, principal outcome sought, strategic priorities, non-priorities/trade-offs, assumptions, evidence limitations, human rationale, provenance and approval metadata.

---

## 22. Strategic Growth Plan

Recommended sections:

1. Strategic Direction
2. Strategic Objectives
3. Priority Growth Initiatives
4. Target Outcomes
5. Required Capabilities
6. Dependencies
7. Key Measures
8. Risks and Constraints
9. Assumptions / Evidence Limitations
10. Sequencing / Horizon
11. Explicitly Deferred Items
12. Provenance / Approval

Human prioritisation is allowed. System ranking is prohibited.

---

## 23. 90-Day Execution Plan

Recommended structure:

- Days 1–30
- Days 31–60
- Days 61–90

Each action should show action, related Growth Plan initiative, intended owner/role, timing, dependency, measure, status and blocker/risk.

Human sequencing is allowed. System ranking is prohibited.

---

## 24. Audit and identity

Audit events include `START_PHASE2`, `CREATE_PHASE2_WORKSPACE`, entry validation, failed entry validation, `ABANDON_PHASE2_WORKSPACE`, generation, review decisions, corrections, rejected option sets, approvals, successor starts, downstream supersession, generation failure, retry, abandoned-run recovery, diagnosis supersession, `COMPLETE_PHASE2`, and successor workspace creation.

Identity fields should support future authenticated-user linkage without rewriting immutable history.

---

## 25. Consultant-facing UX

Recommended flow:

1. Diagnosis Basis
2. Strategic Options
3. Review Options
4. Compare
5. Strategic Decision
6. Growth Plan
7. 90-Day Plan
8. Final Output
9. Audit & Provenance

Expose both coarse Business status (`PHASE2_STARTED`) and detailed workspace state.

Provide explicit human actions to:

- abandon workspace;
- request new option set;
- start successor Direction;
- start successor Growth Plan;
- complete Phase 2.

Final Output shows the current coherent version set only, with historical/superseded versions available through history/audit.

---

## 26. Pilot Fixture Architecture

Pilot Fixture Architecture remains a separate required gate.

It must decide canonical fixture vs fresh clone, reset/delete/recreate semantics, identifier regeneration, composite foreign-key handling, safe copying of immutable Phase 1 artifacts, Phase 2 artifact disposal/recreation, permanent-delete bypass suitability, reset audit trail, whether a general pilot/test domain classification is required, how classification is represented/validated, and how fixture eligibility is tested without hard-coding Baslon Digital.

The mechanism must pass against a second non-Baslon test Business.

No build brief may invent these choices implicitly.

---

## 27. Migration and test discipline

Schema changes must use Drizzle migrations, test only against `baslon_os_test`, preserve shared test guard and `current_database()` protection, and require explicit Product Owner approval before live migration.

Regression requirements:

- existing Phase 1 integrity tests pass;
- approved Phase 1 diagnosis remains unmutated;
- approved Phase 1 artifact remains unmutated;
- workflow transition tests cover `START_PHASE2`;
- workspace creation tests cover both `PHASE1_APPROVED` and `PHASE2_STARTED`;
- initial Business transition + workspace creation is tested atomically;
- state-machine tests cover every declared workspace state;
- abandonment tests cover representative pre-approval and post-approval states;
- successor-Direction tests cover both Growth Plan and Execution Plan review stages;
- downstream supersession/current-version tests cover Direction and Growth Plan successor cases;
- supersession has unit/domain coverage even though re-diagnosis is deferred.

---

## 28. Binary acceptance criteria

### Business-level workflow

- [ ] `workflow_state` gains exactly `PHASE2_STARTED` as coarse Phase 2 Business state.
- [ ] `PHASE1_APPROVED --START_PHASE2--> PHASE2_STARTED` exists.
- [ ] Detailed Phase 2 state exists only on workspaces.
- [ ] Post-approval re-diagnosis remains deferred.

### Initial atomic entry

- [ ] Initial Phase 2 entry from `PHASE1_APPROVED` locks/rechecks Business first.
- [ ] `START_PHASE2` and initial workspace creation commit atomically.
- [ ] No committed intermediate `PHASE2_STARTED` state exists without the intended initial workspace for that command.
- [ ] AI calls are outside the transaction.

### Workspace creation

- [ ] `CREATE_PHASE2_WORKSPACE` is separate and repeatable.
- [ ] Workspace creation is allowed from `PHASE1_APPROVED`.
- [ ] Workspace creation is allowed from `PHASE2_STARTED`.
- [ ] Failed entry validation creates no workspace row.
- [ ] Failed entry validation produces human-visible reason and audit/error record.
- [ ] Two simultaneous active workspaces on same approved diagnosis are rejected.
- [ ] Completed workspace permits later workspace creation on same approved diagnosis.
- [ ] Abandoned workspace permits later workspace creation on same approved diagnosis.
- [ ] Superseded workspace permits successor workspace creation.

### Binding

- [ ] Approved diagnosis belongs to same Business.
- [ ] `approvedDiagnosisId` matches selected diagnosis.
- [ ] `diagnosisRunId` matches diagnosis analysis run.
- [ ] `snapshotId` matches diagnosis Snapshot.
- [ ] `snapshotVersion` matches Snapshot version.
- [ ] `snapshotContentHash` matches stable Snapshot content.
- [ ] Cross-Business binding is rejected.

### Workspace states

- [ ] Every declared state has a documented entry path.
- [ ] Every nonterminal state has a documented exit path.
- [ ] Every state has active/inactive classification.
- [ ] `PHASE2_COMPLETE`, `PHASE2_ABANDONED` and `PHASE2_SUPERSEDED` are inactive.
- [ ] All other states are active.

### Abandonment

- [ ] `ABANDON_PHASE2_WORKSPACE` is legal from every active state.
- [ ] Abandonment is explicit human action.
- [ ] Abandonment preserves all historical artifacts and approvals.
- [ ] Abandonment does not mutate or delete approved artifacts.
- [ ] Abandonment releases duplicate-workspace blocking.

### Review/successor transitions

- [ ] Option set may be rejected from review-in-progress, reviewed and decision-in-progress states.
- [ ] Successor Direction may start from Growth Plan ready/review states.
- [ ] Successor Direction may start from Execution Plan ready/review states.
- [ ] Successor Growth Plan may start from Execution Plan ready/review states.
- [ ] Successor work lands on non-approved states.
- [ ] Predecessor approved version is recorded.
- [ ] Approved artifacts are never reopened in place.

### Downstream supersession

- [ ] Approving successor Direction marks downstream Growth Plans based on predecessor Direction historical/superseded.
- [ ] Approving successor Direction marks downstream 90-Day Plans based on predecessor chain historical/superseded.
- [ ] Approving successor Growth Plan marks 90-Day Plans based on predecessor Growth Plan historical/superseded.
- [ ] Superseded approved artifacts remain immutable and accessible.
- [ ] Final Output presents only current coherent approved Direction/Growth Plan/90-Day Plan set.

### Options

- [ ] Valid option count is 2–4.
- [ ] Fewer than 2 fails closed.
- [ ] More than 4 fails validation.
- [ ] System never pads or silently truncates.
- [ ] Automatic retry, where used, is bounded.
- [ ] Exhausted automatic retry surfaces human-visible next action.
- [ ] Original proposals are immutable.
- [ ] `CORRECTED` requires corrected payload.
- [ ] Other decisions require corrected payload null.
- [ ] Human confirms understandability, genuine distinctness, diagnosis relevance, no invented facts and adequacy for deliberation.
- [ ] System does not rank or auto-select.

### Completion

- [ ] `PHASE2_EXECUTION_PLAN_APPROVED --COMPLETE_PHASE2--> PHASE2_COMPLETE` exists.
- [ ] `COMPLETE_PHASE2` is explicit human action.
- [ ] Completed workspace becomes inactive.
- [ ] Final approved artifacts remain immutable.

### Diagnosis supersession

- [ ] Higher-version approved diagnosis can transition every active workspace to `PHASE2_SUPERSEDED`.
- [ ] Newer Snapshot alone does not supersede.
- [ ] Superseded workspace cannot receive material approval.
- [ ] No silent rebinding occurs.
- [ ] Successor workspace creation is human-initiated.
- [ ] Supersession logic has unit/domain coverage.
- [ ] Gate A does not claim end-to-end re-diagnosis coverage.

### Failure/retry

- [ ] Generation failure enters `PHASE2_GENERATION_FAILED`.
- [ ] Failed module/prior generating state is persisted.
- [ ] Retry returns to correct generating state.
- [ ] Analysis-run lookup is module-scoped.
- [ ] Abandoned `RUNNING` runs are terminally recovered before retry.
- [ ] Historical runs are not rewritten/deleted.
- [ ] Supersession invalidation is recorded separately.

### Transaction safety

- [ ] Strategic writes lock/recheck active Business state.
- [ ] Multi-record writes are atomic.
- [ ] AI calls remain outside transactions.

### AI contracts

- [ ] Structured output is enforced.
- [ ] Runtime validation exists.
- [ ] Prompt/contract version is persisted.
- [ ] Input hash is persisted.
- [ ] Validation errors are recorded.
- [ ] Unknown historical versions fail explicitly.
- [ ] Private chain-of-thought is not persisted.

### Pilot

- [ ] Pilot uses a clearly labelled fixture/copy.
- [ ] Live Baslon Digital rebuild Business is never used as consultant workspace.
- [ ] Pilot mechanism passes against a second non-Baslon test Business.
- [ ] Reset does not weaken global immutability.
- [ ] Reset requires no manual database editing.

### Regression

- [ ] Existing Phase 1 integrity tests pass.
- [ ] Approved Phase 1 diagnosis remains unchanged.
- [ ] Approved Phase 1 artifact remains unchanged.

---

## 29. Gate A capability coverage

This architecture covers the 12 Gate A capabilities.

Gate A also includes process/people criteria outside this architecture: Phase 2 architecture approval, pilot script/observation sheet, experienced external consultant, NDA and consultant-access operational boundary.

---

## 30. Product Owner decisions incorporated

A. One-time Business entry: `START_PHASE2` marks Business `PHASE2_STARTED` once.  
B. Initial entry + initial workspace creation are atomic.  
C. Repeatable workspace creation is separate.  
D. Re-diagnosis deferred.  
E. Supersession retained as forward-looking invariant.  
F. Detailed lifecycle belongs to workspace.  
G. `PHASE2_ABANDONED` provides explicit human escape/restart.  
H. Inactive states are `COMPLETE`, `ABANDONED`, `SUPERSEDED`.  
I. Successor Direction may begin during Growth Plan or 90-Day Plan review.  
J. Downstream approved artifacts become historical/superseded when upstream successor is approved.  
K. Final Output shows the current coherent version set only.  
L. Option bounds fail closed; no padding/truncation; automatic retry bounded where used.  
M. Failed-generation module/prior state is persisted for correct retry.  
N. Human retains strategic authority.  
O. Direction, Growth Plan and 90-Day Plan require separate approval; completion is explicit.  
P. Approved artifacts are immutable versions.  
Q. No system ranking model.

---

## 31. Readiness and next gate

This v6 is intended to be the final core Phase 2 architecture before Pilot Fixture Architecture.

If approved, the next architecture task is:

> **Pilot Fixture Architecture**

Only after that is approved should the first Claude Code implementation brief be produced:

> **Phase 2 Entry + Workspace Foundation**

Option generation comes later.

---

## 32. Recommended approval statement

> **Phase 2 Architecture and Entry Design v6 APPROVED as the governing Phase 2 architecture for Gate A, with post-approval re-diagnosis explicitly deferred and Pilot Fixture Architecture required before implementation planning proceeds.**
