# Baslon OS — Pilot Fixture Architecture v2.1

**Status:** Revised Solution Architect Draft for Product Owner Approval; no implementation authorised  
**Date:** 29 September 2026  
**Purpose:** Resolve the final fixture/reset architecture gate required before Phase 2 implementation planning  
**Applies to:** Phase 2 / Consultant Pilot Ready v1  
**Revision basis:** v1 (26 September), read-only repository validation (28 September), and Product Owner decision (29 September): reviewed export before disposal  
**v2.1 correction:** resolve cloned Snapshot/input hash binding and reset-audit commit ordering from the 29 September v2 review  
**Governing Phase 2 architecture:**  
- `docs/phase-2/baslon-os-phase-2-architecture-and-entry-design-v6.md`
- `docs/phase-2/baslon-os-phase-2-architecture-v6-approval-addendum-v11-final.md`

---

## 1. Governing principles

The Pilot Fixture Architecture must preserve the established Baslon OS principles:

> **AI proposes. Software validates/calculates. Humans make material strategic decisions.**

and:

> **Approved and historical artifacts are immutable.**

The pilot mechanism must not create a hidden exception to those principles.

A resettable consultant pilot is therefore implemented by making the **pilot Business instance disposable**, not by making approved records mutable.

---

## 2. Problem to solve

Phase 2 Gate A requires a resettable consultant pilot case.

The current repository creates a real architectural constraint:

- approved Phase 1 data is immutable;
- the approved Phase 1 graph spans many related records;
- composite foreign keys carry `business_id`;
- copying requires identifier regeneration while maintaining internal references;
- Phase 2 will add further immutable/historical records;
- a consultant must be able to restart the pilot without manual database surgery;
- Baslon Digital must not receive hard-coded application behaviour;
- the live Baslon Digital rebuild Business must never become the consultant's disposable workspace.

Therefore the pilot needs its own explicit domain architecture.

---

## 3. Architecture decision

### 3.1 Use a protected template plus disposable instances

Adopt the following model:

```text
Approved Phase 1 source Business
        ↓
authorised fixture-template creation
        ↓
PILOT_FIXTURE_TEMPLATE
        ↓
CREATE_PILOT_FIXTURE_INSTANCE
        ↓
PILOT_FIXTURE_INSTANCE
        ↓
consultant performs Phase 2
        ↓
RESET PILOT
        ↓
dispose whole instance
        ↓
create fresh instance from template
```

The consultant never works directly on:

- the real approved source Business; or
- the protected fixture template.

The consultant works only on a **Pilot Fixture Instance**.

### 3.2 Reset means replace, never rewind

`RESET_PILOT_FIXTURE` must not:

- change an approved Phase 2 artifact;
- delete selected strategic rows and leave the Business behind;
- roll a Business workflow state backwards;
- restore an earlier Snapshot in place;
- edit an immutable Phase 1 artifact;
- re-use Phase 2 workspace identifiers.

Instead:

1. a reviewed export of the attempt's outputs is durably captured and verified under §9.5;
2. the current Pilot Fixture Instance is terminally disposed as one controlled fixture operation;
3. its reset/disposal event and export reference are recorded outside the disposable graph;
4. a new Pilot Fixture Instance is created from the protected template;
5. the new instance receives new identifiers throughout the copied graph;
6. it starts at the same approved Phase 1 analytical baseline.

This is a **replace-instance model**, not an in-place reset model.

---

## 4. General Business classification

### 4.1 Do not overload `businesses.status`

`businesses.status` remains the Business lifecycle/status concept.

Pilot/test identity is a separate concern.

Introduce a general Business usage classification, recommended name:

```text
business_usage
```

Recommended values:

```text
LIVE
SYNTHETIC_TEST
PILOT_FIXTURE_TEMPLATE
PILOT_FIXTURE_INSTANCE
```

Exact database representation may be a constrained text field or repository-standard enum/check mechanism, but the concept must be first-class and validated.

### 4.2 Meaning

#### LIVE

A real customer/business dataset.

Rules:

- may contain only genuine Business data;
- may not be reset through pilot-fixture operations;
- cannot satisfy Pilot v1 fixture eligibility.

#### SYNTHETIC_TEST

A Business created for synthetic/scenario testing.

Rules:

- may contain fictional inputs;
- is not a consultant pilot fixture unless explicitly converted through a separately authorised process;
- must remain clearly distinguishable from live data.

#### PILOT_FIXTURE_TEMPLATE

A protected canonical Phase 1 baseline used only to manufacture fresh pilot instances.

Rules:

- not shown as a normal consultant workspace;
- never receives Phase 2 work;
- never reset through the consultant flow;
- source graph is immutable after template approval;
- may be replaced only by an explicit administrative template-version operation.

#### PILOT_FIXTURE_INSTANCE

A disposable Business clone created from a protected template.

Rules:

- eligible for the Phase 2 consultant pilot;
- receives normal Phase 2 work under the governing Phase 2 architecture;
- can be reset only through whole-instance disposal and recreation;
- must never be silently promoted into a LIVE Business.

### 4.3 No Baslon-specific rule

No eligibility rule may reference:

- the name `Baslon Digital`;
- a Baslon Digital Business ID;
- a particular Snapshot ID;
- a particular Diagnosis ID.

Eligibility derives from classification and structural validation only.

---

## 5. Template architecture

### 5.1 Template provenance

Each fixture template must record durable provenance outside the ordinary copied Phase 1 content.

Recommended metadata:

- `fixture_template_id`;
- `template_version`;
- template Business ID;
- source Business ID;
- source approved Diagnosis ID/version;
- source Snapshot ID/version/content hash;
- creation timestamp;
- creating actor;
- approval timestamp;
- approving actor;
- template content fingerprint/hash;
- template status: `ACTIVE`, `RETIRED`.

### 5.2 Source Business remains untouched

Creating a template is a read-from-source / write-new-copy operation.

The source Business is never:

- reclassified;
- modified;
- converted into a template;
- used directly as the consultant workspace.

### 5.3 Template freezes the pilot baseline

Once approved, a template version is immutable.

If the desired Phase 1 case changes:

```text
Template v1 → RETIRED
Template v2 → ACTIVE
```

Do not update Template v1 in place.

Existing pilot instances preserve which template version created them.

---

## 6. Fixture-instance architecture

Each Pilot Fixture Instance must record, outside or alongside the Business:

- fixture instance ID;
- Business ID;
- source fixture template ID/version;
- created timestamp;
- creating actor/system;
- reset generation number;
- prior fixture instance ID, if created by reset;
- status such as `ACTIVE`, `DISPOSED`, `FAILED_CREATION`;
- disposal/reset timestamp where applicable;
- disposal/reset actor;
- reset reason;
- creation verification result/fingerprint.
- a per-run provenance mapping from each cloned `analysis_runs.id` to its source/template run identifier and that source run's original `input_hash` and, where present, `snapshotContentHash`, distinct from the cloned run's remapped payload and recomputed hashes.

The instance itself contains a complete independent Phase 1 graph with regenerated identifiers.

---

## 7. Copy strategy

### 7.1 Deep graph copy

Fixture creation must be a deliberate graph-clone operation.

It must not use generic table copying.

The implementation must maintain an explicit **copy manifest** defining:

- copied table/entity;
- dependency order;
- primary identifier regeneration;
- parent identifier mapping;
- composite `business_id` remapping;
- unique-key regeneration;
- fields copied verbatim;
- fields deliberately regenerated;
- fields deliberately excluded;
- validation rules after insert.

### 7.2 New identifiers are mandatory

The fixture instance must receive a new:

- Business ID;
- Snapshot IDs;
- analysis-run IDs where copied;
- approved Diagnosis IDs;
- Diagnosis item IDs;
- reference IDs;
- calculation IDs;
- headline-set/headline IDs;
- evidence/evidence-gap IDs where part of the copied approved Phase 1 graph;
- review/approval/supporting IDs required by the copied graph.

No source primary identifier may be reused inside a new Business graph unless the schema defines it as a global immutable catalogue/reference identifier rather than a Business-owned record.

### 7.3 Preserve semantic content

While identifiers change, the clone must preserve the approved Phase 1 analytical meaning.

At minimum, the clone must preserve:

- source content;
- canonical evidence content;
- approved review decisions/corrections;
- Snapshot content;
- Diagnosis output;
- approved Diagnosis effective content;
- calculations and their derived/provenance status;
- evidence gaps;
- approved headline set where included in the Phase 2 binding;
- the full canonical provenance chain: extraction runs, evidence proposals, review sessions and review decisions, preserving same-Business linkage in the cloned graph;
- prompt/artifact/contract versions required to interpret historical content, with source analysis hashes retained separately as imported provenance and cloned run hashes recalculated against remapped inputs under those versions;
- approval metadata in a clearly cloned historical form.

### 7.4 Do not falsify original human identity

Copied historical records must not imply that the consultant or reset actor performed the original Phase 1 human review.

Where an immutable source artifact contains original human approval identity, preserve that source provenance as copied provenance and separately record:

> cloned into fixture instance from approved source/template.

Do not replace the original reviewer/approver with the fixture creator.

Copy `workflow_transitions` with regenerated transition and workflow identifiers as **imported source history**. Retain original actor, event, state and timestamp values, but record at the fixture metadata boundary that these transitions were copied from the source/template. A consultant-facing or audit view must distinguish imported history from transitions actually performed on this instance; the copy is not evidence that the instance itself executed those historical events.

### 7.5 Copy only the required approved Phase 1 boundary

The template/instance clone should contain only the Phase 1 graph required to reproduce the approved analytical baseline and satisfy Phase 2 entry.

Do not copy:

- Phase 2 artifacts;
- Phase 2 workspaces;
- Phase 2 analysis runs;
- Phase 3 artifacts;
- unrelated operational/test debris not part of the approved baseline.

The exact manifest must be derived from the repository schema and current approved Phase 1 binding before implementation.

If the implementation discovers an unclassified Business-owned dependency, fixture creation must fail closed rather than omit it silently.

---

## 8. Immutability and trigger handling

### 8.1 Global immutability remains unchanged

Do not weaken, remove or condition the global immutability triggers merely because a record belongs to a fixture.

Normal writes to copied approved records remain prohibited.

### 8.2 Clone insertion is not mutation of source

The architecture permits creation of new immutable records whose content is derived from a protected template.

This must happen through a dedicated administrative fixture-copy pathway.

The copy pathway is allowed to construct a new graph; it is not allowed to update the source graph.

### 8.3 No broad trigger bypass for cloning

Do not globally disable immutability triggers for the clone operation.

The read-only repository validation at `3e3e1cc` found that immutable-record triggers permit ordinary `INSERT`; cloning requires **no trigger bypass**. The three triggers that fire on insert enforce lifecycle rules and must be satisfied through legal state transitions. In particular, a copied successful `analysis_runs` row is inserted as `RUNNING` with immutable provenance fields already correct, then updated to `SUCCEEDED` with terminal output and completion fields. `claims.superseded_by_claim_id` requires a second pass after the related claims have been inserted. The exact copy manifest must cover these operations and the full provenance graph.

No broad or session-wide trigger disable is permitted. The existing transaction-scoped permanent-delete bypass is relevant to whole-instance disposal only, subject to §9.3's fixture guards.

---

## 9. Reset and disposal

### 9.1 Whole-instance disposal

Reset operates on the Pilot Fixture Instance as a disposable aggregate.

The conceptual command is:

```text
RESET_PILOT_FIXTURE(instanceId, reason)
```

Preconditions:

- instance exists;
- Business classification is exactly `PILOT_FIXTURE_INSTANCE`;
- fixture metadata agrees with Business classification;
- instance is not already disposed;
- caller has administrative pilot-reset authority;
- target Business is not LIVE, SYNTHETIC_TEST or PILOT_FIXTURE_TEMPLATE;
- active template version required for recreation is available, unless the reset explicitly targets the instance's original template version;
- a reviewed export for the current attempt is durably stored, has been verified as readable and complete under §9.5, and has been explicitly confirmed for disposal by an authorised actor.

### 9.2 Disposal boundary

Disposal may remove the instance's:

- Phase 2 workspaces;
- Phase 2 proposals/reviews/decisions;
- approved Phase 2 artifacts;
- Phase 2 analysis runs;
- copied Phase 1 graph;
- Business row;

only as part of deleting the **entire disposable fixture instance**.

There is no supported command to delete one approved strategic artifact from an otherwise surviving fixture Business.

### 9.3 Existing permanent-delete bypass

The existing permanent-delete capability is **not automatically approved as the reset mechanism** merely because it exists.

Implementation may reuse it only if repository inspection proves all of the following:

1. it can delete the complete Business-owned graph transactionally;
2. it is safe for the Phase 2 tables being introduced;
3. it can be restricted to `PILOT_FIXTURE_INSTANCE`;
4. it cannot be invoked accidentally against LIVE Businesses from the pilot reset pathway;
5. it does not require manual SQL or manual trigger manipulation;
6. failures roll back cleanly;
7. reset audit metadata survives outside the deleted Business graph.

If those conditions are not met, create a dedicated fixture-disposal service using the same lowest-level deletion primitives but with fixture-specific guards.

### 9.4 Atomic user-visible reset

From the product perspective, reset is one controlled operation.

Recommended implementation boundary:

1. create and commit an idempotent reset operation record in `REQUESTED` in its own transaction, before the destructive transaction begins;
2. validate target, template, authority, and the reviewed export and its confirmation;
3. lock/recheck the instance and reject a concurrent reset;
4. preferably dispose the old instance, create and verify the replacement, and mark success in one database transaction;
5. record `SUCCEEDED` with the new instance ID and export reference.

If the repository cannot safely delete and recreate in one database transaction because of existing infrastructure boundaries, the durable reset-operation record must make partial failure recoverable and explicit.

The user must never be left with a supposedly reset fixture whose state is ambiguous.

The same reset operation ID must return the same result on retry rather than deleting a replacement. Once disposal commits, a retry must use the recorded template/version and generation to complete recreation; it must never target the newly created instance as though it were the original. If the old and new graphs cannot be switched in one transaction, the persistent operation states and recovery rules in §§10 and 16 are mandatory.

If the disposal/recreation transaction rolls back, the previously committed `REQUESTED` record survives and must be marked `FAILED` with a useful reason through a separate guarded update. A crash that leaves it `REQUESTED` must be recoverable by the same idempotent operation, after rechecking the actual old/new instance state. The operator must never infer success from the request row alone.

### 9.5 Reviewed export before disposal — Product Owner decision

Pilot v1 uses **reviewed export before disposal**, rather than retaining a queryable copy of every completed attempt inside Baslon OS. Before an instance can be disposed, the authorised operator must:

1. generate an export containing the current approved Strategic Direction, Growth Plan, 90-Day Execution Plan and the relevant diagnosis, limitations, provenance and approval state; where the attempt is incomplete, capture the current available work and clearly mark its status;
2. review the export for completeness and readability, then explicitly confirm that it is the record to retain;
3. store the export outside the disposable Business graph under a durable reference and checksum, linked to the reset operation and attempt identity;
4. receive an explicit warning that the instance and all its underlying proposal, review, decision and run rows will be removed, and that the export is a retained summary rather than a live, queryable workspace.

Reset must fail closed if export generation, storage, verification or confirmation fails. The reset audit retains the export reference, checksum, reviewer/confirmation actor and timestamp. Export format, storage location, access and retention period are implementation and operational decisions to specify before enabling reset; no design may silently substitute an ephemeral browser download as the only retained copy. Any later requirement to compare full historical attempts in-product requires a separate retention design and Product Owner decision.

---

## 10. Reset audit trail

The reset audit trail must survive deletion of the disposable Business.

Therefore reset audit records must not be owned solely by the Business graph being deleted.

Recommended reset-operation fields:

- reset operation ID;
- disposed fixture instance ID;
- disposed Business ID;
- replacement fixture instance ID;
- replacement Business ID;
- fixture template ID/version;
- reset generation;
- requested at;
- requested by;
- reason;
- state: `REQUESTED`, `DISPOSING`, `RECREATING`, `VERIFYING`, `SUCCEEDED`, `FAILED`;
- failure code/detail where relevant;
- completed at;
- pre-disposal fingerprint;
- replacement verification fingerprint;
- reviewed-export reference and checksum, export verification timestamp, disposal-confirmation actor and timestamp.

The audit record must not store private chain-of-thought.

---

## 11. Phase 2 fixture eligibility

The Phase 2 Pilot v1 entry precondition is satisfied only when all of the following are true:

- Business `business_usage = PILOT_FIXTURE_INSTANCE`;
- associated fixture-instance metadata exists;
- associated fixture template exists;
- template version is recognised;
- instance has passed clone verification;
- Business is active;
- workflow is `PHASE1_APPROVED` for initial Phase 2 entry, or `PHASE2_STARTED` for another human-initiated workspace on the same instance under the governing active-workspace and diagnosis-binding rules;
- current approved Diagnosis exists;
- approved Diagnosis belongs to that Business;
- Diagnosis is bound to an immutable Snapshot;
- all normal Phase 2 workspace-entry binding checks pass.

Classification alone is never sufficient.

Structural validation alone is never sufficient without the classification.

---

## 12. Clone verification

A newly created fixture instance is not eligible until verification passes.

Verification must include:

### Identity isolation

- source Business ID != fixture Business ID;
- no Business-owned primary IDs are reused;
- all Business-owned foreign keys resolve to the fixture Business graph;
- no composite FK points back to the source Business accidentally.

### Phase 1 semantic equivalence

Compare source template and instance after normalising regenerated identifiers.

At minimum verify:

- canonical counts and content fingerprints;
- Snapshot content fingerprint;
- approved Diagnosis effective-content fingerprint;
- diagnosis item/reference/calculation equivalence;
- evidence-gap equivalence;
- approved headline-set effective-content equivalence where applicable;
- workflow exactly `PHASE1_APPROVED`.

For a freshly cloned instance, compare a **normalised semantic fingerprint** of the template and cloned Phase 1 graph after mapping Business-owned identifiers. The cloned Snapshot data must remap its embedded Business-owned IDs: preserving source IDs inside `snapshot_data` would make the clone internally false and fail same-Business validation. This necessarily changes its raw stable hash. The five Phase 2 workspace binding fields must refer to the clone's own approved Diagnosis, run and Snapshot.

**Hash storage decision for Gate A:** use the closed Phase 2 architecture's permitted fallback, with the **clone's own persisted analysis-run value** as the comparison target. Compute `snapshotContentHash` from the clone's remapped `snapshot_data` and store it in the cloned `analysis_runs.model_configuration` at `INSERT`, before the run's legal `RUNNING` → `SUCCEEDED` transition. At workspace entry, recompute the stable hash of that same cloned Snapshot and compare it with this cloned run value. Do not compare it to the source run's hash. A first-class `business_state_snapshots.content_hash` column is not required by this gate; introducing one and backfilling immutable existing rows would need a separate migration design and review.

The clone's `input_payload` or model input must likewise have all Business-owned IDs remapped, and its `input_hash` must represent that **cloned** input under the original versioned hashing contract. Retain the source run's original `input_hash` and, where present, `snapshotContentHash` in a **per-run** fixture provenance mapping keyed by cloned run ID; do not overwrite them or pass them off as validation of the clone. Any other copied field whose asserted hash or reference changes after remapping must be treated the same way. The exact source-to-clone provenance mapping, payload projection and historical-contract compatibility must be verified before a cloned approved diagnosis can be eligible. This is a deterministic copy of historical approved content, not a new AI generation or a new human approval.

A cloned run's remapped input and copied output are **not** a replay-verifiable input-to-output pairing. The original analysis pairing and its provenance remain with the source/template run identified by the per-run mapping. No feature may present a fixture run as evidence that the original AI output was produced from the remapped clone input; the fixture asserts approved baseline equivalence, not a new execution of that historical analysis.

### Phase 2 cleanliness

Verify there are zero:

- Phase 2 workspaces;
- Phase 2 option sets;
- Phase 2 decisions;
- Phase 2 approved artifacts;
- Phase 2 analysis runs owned by the instance.

### Source immutability

Fingerprint the protected template before and after clone creation and prove it is unchanged.

---

## 13. Second non-Baslon validation

The mechanism is not accepted merely because it works for a Baslon-derived template.

Before Pilot Fixture Architecture is considered implemented, the same mechanism must pass using a second Business whose:

- name is not Baslon Digital;
- IDs are unrelated to Baslon Digital;
- Phase 1 graph is independently created;
- content shape is sufficiently representative to exercise the copy manifest.

The test must demonstrate:

1. template creation;
2. fixture-instance creation;
3. Phase 2 eligibility;
4. at least one Phase 2 write once Phase 2 foundation exists;
5. reset/disposal;
6. fresh recreation;
7. source/template unchanged;
8. no hard-coded Business identity assumptions.

A mechanism that requires adding the second Business ID to code fails this criterion.

---

## 14. Consultant-facing behaviour

Consultant UX should show:

- clear **PILOT** labelling;
- fixture generation/version where useful;
- reset action only for authorised users;
- confirmation that reset discards all work in the current disposable pilot instance;
- a link to the reviewed export and a clear confirmation that it has been retained before reset;
- successful reset redirecting to the new instance.

The consultant must never be offered:

- the live source Business as the pilot workspace;
- the protected fixture template as the pilot workspace;
- a generic permanent-delete control as the normal reset UX.

---

## 15. Naming and data leakage

If a real Business such as Baslon Digital is the source material for a pilot template:

- the template and instance must be clearly labelled as pilot copies;
- the live Business remains distinct;
- access must be appropriate to the consultant/NDA boundary;
- fixture creation must not imply the copied data is synthetic;
- synthetic/scenario additions during the pilot must not flow back to the live source or template.

Pilot mutations are one-way and disposable.

There is no "sync back" operation.

---

## 16. Failure behaviour

### Clone creation failure

- no eligible fixture is exposed;
- partially created graph is rolled back or terminally marked for controlled cleanup;
- protected template remains unchanged;
- operation records failure explicitly.

### Reset failure before disposal

- existing fixture remains intact and usable unless explicitly marked unavailable for safety;
- no replacement is advertised;
- the export remains available and the operation can be retried using the same operation ID after its cause is resolved.

### Reset failure after disposal

- reset operation records the disposed instance and failure;
- recreation may be retried from the same protected template;
- system never claims the old instance still exists;
- verified export and confirmation remain discoverable through the reset audit;
- retry is idempotent and cannot dispose a newly created replacement.

### Verification failure

- replacement is not Pilot v1 eligible;
- no Phase 2 work may begin;
- failure reason is visible to an administrator.

---

## 17. Database and migration safety

Any schema work required by this architecture must:

- use normal Drizzle migrations;
- be tested against `baslon_os_test`;
- preserve the existing test-database guard;
- verify `current_database()` before destructive integration tests;
- require explicit Product Owner approval before any live migration.

No fixture test may use the live Baslon Digital Business as the disposable target.

---

## 18. Security and authority

Fixture operations are administrative operations.

Separate capabilities should exist conceptually for:

- create template;
- retire template;
- create fixture instance;
- reset fixture instance;
- dispose fixture instance.

Normal consultants need use of the instance, not template-management authority.

The final implementation may initially bind these capabilities to existing administrative authorization, but must not expose them simply because a user can edit a Business.

---

## 19. Explicit non-goals

Pilot Fixture Architecture does not:

- create general Business rollback;
- make approved artifacts editable;
- define Phase 2 strategic logic;
- redefine Phase 2 state machines;
- add post-approval re-diagnosis;
- create Phase 3 Management Loop functionality;
- synchronise fixture changes back into the source Business;
- convert synthetic test Businesses into live customer Businesses;
- make permanent deletion a normal consultant capability.

---

## 20. Required implementation sequence

After this architecture is approved, Phase 2 implementation should proceed in this order:

```text
A. Fixture domain foundation
   - Business usage classification
   - fixture template/instance/reset metadata
   - guarded fixture services

B. Fixture clone engine
   - repository-derived copy manifest
   - ID remapping
   - structural/equivalence verification

C. Phase 2 Entry + Workspace Foundation
   - START_PHASE2
   - CREATE_PHASE2_WORKSPACE
   - fixture eligibility enforcement

D. Fixture disposal/reset integration
   - extended to cover Phase 2 graph
   - audit-surviving reset operation

E. Second non-Baslon fixture validation

F. Remaining Phase 2 modules
```

A and B may be implemented before Phase 2 tables exist.

The disposal manifest must be extended and reverified as Phase 2 tables are introduced.

---

## 21. Binary acceptance criteria

### Classification

- [ ] A first-class general Business usage classification exists.
- [ ] It distinguishes LIVE, SYNTHETIC_TEST, PILOT_FIXTURE_TEMPLATE and PILOT_FIXTURE_INSTANCE.
- [ ] No pilot rule hard-codes Baslon Digital name or IDs.
- [ ] `businesses.status` remains separate from usage classification.

### Template

- [ ] Template is a separate Business graph, not the live source Business.
- [ ] Template provenance records its source analytical baseline.
- [ ] Approved template version is immutable.
- [ ] Template cannot receive normal Phase 2 consultant work.
- [ ] Source Business is unchanged by template creation.

### Instance creation

- [ ] Every instance receives a new Business ID.
- [ ] Business-owned identifiers are regenerated.
- [ ] Composite `business_id` foreign keys remain internally consistent.
- [ ] Copy uses an explicit repository-derived manifest.
- [ ] Unknown/unhandled Business-owned dependencies fail closed.
- [ ] Source/template fingerprints remain unchanged.
- [ ] New instance has zero Phase 2 work.
- [ ] New instance ends at valid `PHASE1_APPROVED`.
- [ ] Imported workflow transitions and human approvals are distinguishable from events performed on the new instance.

### Semantic equivalence

- [ ] Normalised Phase 1 content matches the template.
- [ ] Snapshot content is equivalent.
- [ ] Approved Diagnosis effective content is equivalent.
- [ ] Evidence gaps/calculations/headlines required by Phase 2 binding are equivalent.
- [ ] Derived calculations remain explicitly derived.
- [ ] Original analysis hashes remain separately labelled as source provenance; the clone's own persisted Snapshot and input hashes match its remapped payloads, and normalised semantic comparison validates equivalence.

### Immutability

- [ ] Global immutability is not weakened.
- [ ] Source/template approved records cannot be edited through fixture operations.
- [ ] Clone pathway does not use a broad uncontrolled trigger disable.
- [ ] Pilot reset does not update approved artifacts in place.

### Reset

- [ ] Reset replaces the whole fixture instance.
- [ ] Reset never rewinds workflow state in place.
- [ ] Reset requires no manual database editing.
- [ ] Reset cannot target LIVE, SYNTHETIC_TEST or PILOT_FIXTURE_TEMPLATE through the pilot pathway.
- [ ] Reset removes/disposes all Phase 2 work belonging to the disposable instance.
- [ ] Replacement receives fresh identifiers.
- [ ] Reset audit survives disposal.
- [ ] A complete, readable export is durably stored, reviewed and confirmed before disposal; failed export or confirmation blocks reset.
- [ ] Reset is idempotent and concurrent reset attempts cannot delete the replacement.

### Permanent-delete safety

- [ ] Existing permanent-delete bypass is reused only if proven safe against the stated requirements.
- [ ] Any deletion bypass is narrowly scoped and transactionally guarded.
- [ ] Pilot reset cannot accidentally delete a LIVE Business.

### Phase 2 entry

- [ ] Pilot v1 fixture eligibility requires `PILOT_FIXTURE_INSTANCE`.
- [ ] Fixture metadata and structural verification must also pass.
- [ ] All normal Phase 2 entry/binding rules still apply.
- [ ] Classification never bypasses Phase 2 integrity validation.
- [ ] Another workspace may be created at `PHASE2_STARTED` only under the governing active-workspace and analytical-binding guards.

### Second Business

- [ ] Full mechanism passes against a second non-Baslon Business.
- [ ] No identity-specific code/configuration is needed for that Business.

### Regression

- [ ] Existing Phase 1 integrity tests remain green.
- [ ] Live Baslon Digital approved Phase 1 graph remains unchanged.
- [ ] Protected fixture template remains unchanged across instance creation/reset.
- [ ] No real Business becomes contaminated by synthetic pilot input.

---

## 22. Architecture decisions incorporated

A. **Protected template + disposable fresh instance** is the canonical pilot model.  
B. **Reset means dispose-and-recreate**, never rollback or mutation in place.  
C. Pilot/test identity is a **general first-class Business usage classification**, separate from lifecycle status.  
D. Live source Business is **never** the consultant workspace.  
E. The protected template is **never** the consultant workspace.  
F. Copying is a **deep, manifest-driven graph clone** with regenerated Business-owned identifiers.  
G. Clone verification requires both **identity isolation** and **semantic Phase 1 equivalence**.  
H. Global immutability remains intact; fixture operations do not create general mutation exceptions.  
I. Approved Phase 2 artifacts may disappear only when the **entire disposable fixture Business** is destroyed by an authorised reset/disposal operation.  
J. The existing permanent-delete bypass is **conditionally reusable**, not assumed suitable.  
K. Reset audit must live **outside the disposable Business graph**.  
L. Fixture eligibility is based on **classification + metadata + structural validation**, never Business identity.  
M. The mechanism must pass on a **second non-Baslon Business**.  
N. There is **no sync-back** from pilot to live/template data.
O. A reviewed and verified export is retained outside the disposable graph before reset; disposal is blocked without it.
P. Source-analysis hash values remain separate historical provenance; a clone's persisted analysis hashes and current Phase 2 binding are calculated and validated against its own remapped graph.

---

## 23. Gate decision

This architecture resolves the fixture questions deferred by the closed Phase 2 core architecture:

- canonical fixture vs fresh clone;
- reset/delete/recreate semantics;
- identifier regeneration;
- composite foreign-key handling;
- safe copying of immutable Phase 1 artifacts;
- Phase 2 artifact disposal/recreation;
- permanent-delete bypass suitability;
- reset audit trail;
- general pilot/test domain classification;
- classification representation/validation;
- fixture eligibility without hard-coding Baslon Digital;
- second non-Baslon validation.

### Proposed v2.1 approval statement (not yet approved)

> **Pilot Fixture Architecture v2.1 APPROVED as the governing resettable-pilot architecture for Phase 2 Gate A. A protected fixture template creates disposable fresh Pilot Fixture Instances. Reset requires a verified, reviewed export retained outside the disposable graph, then whole-instance dispose-and-recreate. The source Business and template remain unchanged. Implementation planning may proceed under the closed Phase 2 architecture, with the exact hash/payload mapping and copy/disposal manifests verified before code is accepted.**

---

## 24. Next implementation-planning gate

Approval of this document does not itself authorise code or a live migration.

The v1 read-only repository validation was completed on 28 September 2026 against `3e3e1cc`. Before the first implementation brief is issued, the remaining focused engineering verification is:

1. inspect the exact Snapshot and analysis input hash projections, including Business-owned identifiers inside JSON payloads, and specify a truthful clone mapping;
2. verify the validated copy/disposal manifest remains complete against the implementation branch;
3. specify the export artifact's format, durable storage, access, retention and readability check before enabling reset;
4. show the transaction/idempotency recovery sequence for reset and the fixture-specific guard around the existing deletion primitives;
5. reconcile the source report's classification inventory with the chosen v2 migration scope; do not treat an unreviewed backfill of immutable Snapshot rows as an automatic migration.

These are implementation-planning checks, not a request to repeat the completed repository survey. David's approval of this v2 architecture is required before issuing implementation briefs.
