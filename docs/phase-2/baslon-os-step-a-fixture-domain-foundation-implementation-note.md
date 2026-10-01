# Baslon OS — Step A: Fixture Domain Foundation Implementation Note

**Date:** 1 October 2026
**Engineer:** Claude Code
**Branch:** `claude/phase-2`
**Baseline:** `76ba7a0a902ff646b276b74c6999ae7b1f0c4830`
**Governing architecture:** [`baslon-os-pilot-fixture-architecture-v2.1.md`](baslon-os-pilot-fixture-architecture-v2.1.md) (approved 29 September 2026)

Step A of the approved A–F sequence: Business usage classification, durable fixture
template/instance/reset metadata, and guarded internal services.

**This does not complete the fixture mechanism and does not complete Phase 2 Gate A.**
No clone engine, no reset orchestration, no export generator, no Phase 2 tables, no
endpoint and no UI. Consultant Pilot Ready v1 is unchanged.

---

## 1. The §24 planning checks, resolved against this baseline

The architecture's §24 required five focused engineering checks before implementation.
Each is answered here from the repository rather than re-surveyed.

### 1.1 Snapshot and analysis input hash projections

`src/domain/phase1-diagnosis-projection.ts` computes `snapshotContentHash` as
`stableSha256(input.snapshot.snapshotData)`, and `canonical-snapshot.ts` builds
`snapshotData` from whole database rows — the `businesses` row, claims, evidence,
claim–evidence links and metrics, each carrying its own `id` and `business_id`.

**`snapshot_data` is therefore saturated with Business-owned identifiers.** A clone that
regenerates identifiers necessarily produces a different `snapshotContentHash`. Any
design that expected a cloned Snapshot hash to equal its source's would be wrong, and a
hash-equality fallback between source and clone could never match.

The truthful mapping Step B must implement:

| Value | On the source/template | On the clone |
|---|---|---|
| `analysis_runs.input_hash` | retained verbatim in fixture run provenance | recomputed from the remapped payload at INSERT |
| `snapshotContentHash` | retained verbatim in fixture run provenance | recomputed from the cloned `snapshot_data` |
| identifiers inside `snapshot_data` | source ids | regenerated, consistently with the row ids |

This is why `fixture_instance_run_provenance` stores `source_input_hash` and
`source_snapshot_content_hash` as separate retained columns: the source's originals live
there, the clone's recomputed values live on the cloned rows, and the two are never
conflated. Step B must not overwrite the source columns, or a copied run would become
indistinguishable from a fresh AI execution.

Consistent with the brief's boundary, **no first-class Snapshot hash column and no
backfill of immutable Snapshot rows is introduced here.**

### 1.2 Copy/disposal manifest still complete at this baseline

Re-verified against `src/repositories/business-deletion-repository.ts` on `76ba7a0`:

- the deletion sequence walks an explicit list of **31 direct Business-owned tables**
  plus `workflow_transitions` (owned via `workflow_id → strategy_workflows`);
- the residue check counts those same tables and raises
  `"Business-owned data remains after deletion sequence"`;
- 33 tables exist in total; `businesses` and `workflow_transitions` are the two without
  a `business_id` column.

**No additions to that manifest were found.** The four tables introduced here are
deliberately **outside** it — see §4.

### 1.3 Export artifact — specified as a Step D dependency, not implemented

Architecture §9.5 requires format, durable storage, access, retention and a readability
check to be specified **before enabling reset**. Those are operational decisions and
remain open. Step A therefore:

- persists the export **reference, checksum, verification timestamp and explicit
  disposal-confirmation actor/time** on the reset operation;
- enforces them as all-or-nothing by CHECK, so a half-recorded confirmation cannot look
  valid;
- refuses the `REQUESTED → DISPOSING` transition until the confirmation exists;
- exposes `generateReviewedExport()` as a contract that **throws**.

**The unresolved operational choices block enabling reset. They do not block this
schema work**, which is the ordering §24 asks for.

### 1.4 Reset transaction and idempotency recovery sequence

Recorded here as the design Step D must follow; the metadata and guards to support it
exist now.

```text
1. commit a durable REQUESTED operation in its own transaction, keyed by a caller
   supplied operation id, before any destructive work
2. validate target, template, authority, and the reviewed export + confirmation
3. lock and recheck the instance; reject a concurrent reset
4. destructive transaction: dispose old, create and verify replacement, mark success
5. on rollback, a separate guarded update marks the surviving REQUESTED row FAILED
   with a reason
6. a crash leaving REQUESTED is recoverable by replaying the same operation id, after
   rechecking actual old/new instance state
```

What Step A already enforces, so Step D cannot get it wrong quietly:

- the operation id is the primary key, and a replay returns the existing row;
- a replay naming a **different original instance or generation is refused**, so a retry
  can never destroy the wrong graph;
- `replacement_instance_id` cannot be rebound once recorded, so a retry cannot target
  the replacement as though it were the original;
- `SUCCEEDED` requires a replacement, a completion time, a verification fingerprint and
  a confirmed export, by CHECK — a request row alone can never read as success;
- `FAILED` requires a failure code;
- terminal states are frozen by trigger.

**Fixture-specific guard around the existing deletion primitive.** Architecture §9.3
lists seven conditions before the permanent-delete capability may be reused. Of these,
this baseline satisfies transactional whole-graph deletion, clean rollback (serializable
transaction with a residue check), and no manual SQL or trigger manipulation. Still
**unproven and owned by Step D**: safety for Phase 2 tables that do not exist yet, and
restriction to `PILOT_FIXTURE_INSTANCE`. Step A contributes the restriction material —
classification plus metadata agreement — but does **not** wire the pathway. Condition 7,
audit survival, is implemented here and demonstrated by test.

### 1.5 Classification inventory reconciled with the migration scope

The v1 validation report's inventory is confirmed: `businesses.status` is plain text
with no CHECK, carrying only `"active"` and `"archived"` in practice, and **no usage or
classification field existed** before this change.

The chosen migration scope is therefore a single additive column with a default, and
**no backfill of immutable Snapshot rows** — exactly the thing §24 warns against
treating as automatic. See §3 for the classification policy.

---

## 2. What was built

| Area | Path |
|---|---|
| Domain vocabulary, state machines, eligibility, contracts | `src/domain/pilot-fixture.ts` |
| Administrative authority tokens | `src/domain/fixture-authority.ts` |
| Schema: usage column + 4 tables | `src/db/schema.ts` |
| Migration incl. guards | `drizzle/0009_pilot_fixture_foundation.sql` |
| Guarded persistence | `src/repositories/pilot-fixture-repository.ts` |
| Guarded service + fail-closed contracts | `src/services/pilot-fixture-service.ts` |
| Generic create accepts only self-assignable usage | `src/domain/schemas.ts`, `src/repositories/foundation-repository.ts` |
| Integration acceptance (18 tests) | `tests/postgres/pilot-fixture-foundation.postgres.test.ts` |
| Domain unit tests (20 tests) | `tests/unit/pilot-fixture.test.ts` |

---

## 3. Business usage classification and the existing-row policy

Four values, as approved: `LIVE`, `SYNTHETIC_TEST`, `PILOT_FIXTURE_TEMPLATE`,
`PILOT_FIXTURE_INSTANCE`, as a `business_usage` pgEnum following repository convention
(the value array lives in the domain module and the enum imports it).

**`businesses.status` is untouched.** Lifecycle and classification are orthogonal, and a
test demonstrates that archiving and restoring never alters usage.

### 3.1 Existing rows become `LIVE`

The column is `DEFAULT 'LIVE' NOT NULL`, so existing rows are classified `LIVE` by the
default — no data-dependent backfill, no inference.

This is the conservative direction, and deliberately so: `LIVE` is **ineligible for
pilot reset and for fixture eligibility**. A misclassification therefore withholds a
capability rather than exposing a real Business to disposal. The opposite error —
treating a real Business as synthetic or disposable — is the one that destroys data.

**No fixture status is inferred from names, identifiers or the presence of an approved
Diagnosis.** There is no Baslon-specific rule anywhere in this change.

Ambiguous legacy classification is handled by this same rule rather than by guesswork:
any row whose true nature is unknown is `LIVE` until an authorised pathway says
otherwise. Reclassifying a genuine `LIVE` Business to `SYNTHETIC_TEST` remains a
deliberate human act through ordinary update, and **cannot** reach a protected fixture
value at all.

**The approved source Business is not reclassified into a template.** Template
registration refuses a `LIVE` template Business outright, and refuses a source that is
itself a template or instance.

### 3.2 Authority boundary

| Path | May assign |
|---|---|
| `businessInputSchema` / generic create | `LIVE`, `SYNTHETIC_TEST` only — the type does not admit the others |
| Guarded fixture pathway | the two protected values, inside its own transaction |
| Raw SQL / any other update | **nothing protected** — refused by trigger |

The database half is `enforce_business_usage_change()`, a trigger on
`BEFORE INSERT OR UPDATE ON businesses`. It refuses any insert or update that sets or
clears a protected classification unless the transaction-local setting
`baslon.fixture_usage_change` is `'on'`, which only the fixture repository sets. This
mirrors the established `baslon.permanent_delete_business_id` convention, so the
protection does not depend on every caller remembering to use the right service.

A fixture therefore cannot be silently promoted to `LIVE`, and a fixture identity cannot
be manufactured by a generic request — both are demonstrated by test against raw SQL,
not merely against the service.

Administrative capability is separate from ordinary Business edit authority:
`deriveFixtureAdminAuthority` issues branded, unforgeable tokens carrying
`template_admin`, `instance_admin` or `reset_admin`. A hand-built object literal is
rejected, and **an AI actor cannot hold fixture authority at all**.

---

## 4. Metadata relationships, immutability and audit survival

Two kinds of link, labelled in the schema:

- **relational** — a real foreign key, where the target must still exist;
- **retained identity** — a bare `uuid` with no FK, where the target is expected to be
  deleted and the identifier must outlive it.

| Table | Relational | Retained identity |
|---|---|---|
| `fixture_templates` | template Business (+ composite usage), source Business, source Diagnosis and Snapshot (composite same-Business) | — |
| `fixture_instances` | `business_id` (nullable, cleared on disposal), template (+version), predecessor | `historical_business_id` |
| `fixture_instance_run_provenance` | owning instance | cloned run id, source run id |
| `fixture_reset_operations` | template (+version) only | original/replacement instance and Business ids |

**None of the four tables is in the permanent-delete manifest**, and
`fixture_reset_operations` owns no Business and is referenced by none. That is what makes
the audit outlive the graph it describes. `DELETE` on it is refused by trigger outright.

`fixture_instances.business_id` is nullable on purpose: Step D disposal deletes the
Business row, so the live link is cleared while `historical_business_id` retains the
identity. A CHECK keeps the pair consistent — both present and equal, or both absent.

### 4.1 Composite usage binding

`businesses` gained `UNIQUE (id, business_usage)`, letting the fixture tables carry a
redundant usage column constrained by CHECK to a single legal value and composite-FK it
back. "This Business really is classified as the template/instance it claims to be"
becomes a **database fact**, not a service convention. A test asserts zero mismatched
rows.

### 4.2 Immutability

| Table | Frozen | Permitted change |
|---|---|---|
| `fixture_templates` | every provenance, identity, fingerprint, actor and timestamp field | `ACTIVE → RETIRED` only, with actor and timestamp |
| `fixture_instance_run_provenance` | everything — `UPDATE` always refused | none |
| `fixture_reset_operations` | id, original target, template, generation, request details; replacement once set; confirmed export once set; terminal state | state progression, failure fields, fingerprints, completion |

Retirement is demonstrated to preserve every provenance field, and un-retirement is
refused. Replacement means a new template version, never an edit.

### 4.3 Uniqueness

- one template per Business; `(source_business_id, template_version)` unique — **versions
  are numbered per source family**, so the §13 second non-Baslon fixture can have its own
  v1 without colliding, and no single-global-ACTIVE constraint blocks it;
- one instance per Business, one per `historical_business_id`, one replacement per
  predecessor (a reset cannot fork);
- `(instance, cloned run)` and `(instance, source run)` unique;
- `(original_instance_id, reset_generation)` unique — a retry reuses the row.

### 4.4 A deliberate consequence

While an instance holds its live link, its Business **cannot be permanently deleted** —
the restrict FK refuses it. Step A has no disposal engine, so that is the correct
behaviour, and it is covered by test. The same protection applies to a template Business
while its template exists. Ordinary Businesses are unaffected; the existing deletion
suite is green.

---

## 5. Services

Every mutating operation is a **registration primitive**: it records provenance that
something else produced, validates cross-record consistency inside its transaction, and
is unreachable through generic CRUD. Implemented: template registration and retirement,
instance registration, verification recording, failed-creation marking, run provenance,
reset request/export confirmation/state advance, and reads including the
classification-and-metadata eligibility evaluation.

**Reserved contracts that fail closed**, rather than returning a fabricated success:
`createTemplateFromSource`, `createInstanceFromTemplate`, `verifyClone` (Step B);
`resetPilotFixture`, `disposePilotFixtureInstance`, `generateReviewedExport` (Step D).
Each throws `PilotFixtureEngineUnavailableError`, proven by test.

**No route, endpoint or UI was added.** There is no functional reset or delete surface to
find.

### 5.1 Eligibility is only half the gate

`evaluateFixtureInstanceEligibility` answers the classification and metadata half of
architecture §11: correct usage, active Business, instance metadata present, ACTIVE,
**clone verification passed**, attached, and a recognised template version. It returns
stable machine-readable reasons.

Still owned by **Step C**: workflow state (`PHASE1_APPROVED` / `PHASE2_STARTED`), current
approved Diagnosis existence and ownership, immutable Snapshot binding, and the normal
Phase 2 workspace-entry binding checks. A true result here **does not open Phase 2**.

Because `verification_passed` starts false and can only be set with a full evidence set
(fingerprint, actor, timestamp — enforced by CHECK), **a metadata row or a classification
alone can never present an instance as pilot-ready**. Forging the flag by raw SQL is
refused, and tested.

---

## 6. Validation

All commands run from this checkout against its own assigned test instance,
`127.0.0.1:5442`, database `baslon_os_test`, PostgreSQL 170011, role
`baslon_test_claude`, verified by the shared guard plus an independent
`current_database()` check before any mutation.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **pass** |
| `npm run lint` | **pass**, 0 errors 0 warnings |
| `npm test` (unit + integration) | **pass** — 34 files, **371 tests** |
| `npm run test:postgres` | **pass** — 15 files, **135 tests** |
| `npm run build` | **pass** — compiled successfully |
| `npx drizzle-kit migrate` | **pass** on the test instance; 419 pre-existing rows classified `LIVE` |

Baseline before this work was 117 postgres tests and 351 unit/integration; the increase
is the 18 new integration and 20 new unit tests. **No pre-existing test was modified.**

### 6.1 Two honest notes

**A pre-existing flake.** On the first baseline run,
`tests/postgres/initial-intake.postgres.test.ts` failed one concurrency-race assertion
on the untouched baseline. It then passed 3/3 in isolation and every subsequent full-suite
run. Recorded as an intermittent pre-existing condition, not introduced here and not
fixed here.

**A generated-migration reorder.** drizzle-kit emitted the
`businesses_id_usage_unique` composite UNIQUE **after** the foreign keys that reference
it, so the generated order could not apply. The statement was hoisted to directly follow
the new column, with a comment recording why. Nothing else in the generated SQL was
changed; the trigger block was appended.

---

## 7. Boundaries honoured

- no Baslon-specific name, Business, Snapshot or Diagnosis eligibility rule;
- no change to the approved source graph or source human identities;
- no weakened immutability and no broad trigger bypass — the one new bypass is
  transaction-local, scoped to a single column, and sets nothing else;
- no clone engine, Phase 2 tables, workspace, export generator or reset orchestration;
- no in-place reset, workflow rewind, selective deletion of approved artifacts, sync-back;
- no first-class Snapshot hash column and no Snapshot backfill;
- **no live migration**; every migration and test ran only against `baslon_os_test`;
- test data is independently seeded synthetic graphs — **the live Baslon Digital graph
  was never used as a test target**;
- the shared test guard is unchanged (0 diff).

---

## 8. Open items and the exact next dependency

**Still unimplemented, by design:** the clone engine and its verification (Step B);
Phase 2 entry and eligibility enforcement (Step C); disposal/reset orchestration and the
fixture-specific guard around the deletion primitive (Step D); the second non-Baslon
fixture validation (Step E).

**Operational decisions still blocking reset**, carried from §1.3: export format, durable
storage location, access control, retention period and the readability check.

**Remaining future Phase 2 guard integration**, not pretended here: protecting templates
from consultant mutation at the Phase 2 workspace boundary, which cannot exist until
Phase 2 tables do. Step A protects templates through service authority and database
immutability only.

### The exact next dependency for Step B — not started

> A repository-derived copy manifest and ID-remapping plan for the 33-table graph, whose
> cloned `analysis_runs` rows recompute `input_hash` and the clone's own
> `snapshotContentHash` **at INSERT**, while leaving the source values already retained in
> `fixture_instance_run_provenance` untouched.

The insertion order is the proven deletion order reversed; the three `analysis_runs`
INSERT-time guards mean a cloned run must be inserted `RUNNING` with
`completed_at IS NULL` and then completed, exactly as a real run is. 21 of the 24
immutability triggers fire on `UPDATE OR DELETE` only, so ordinary cloning needs no
bypass.

Step B is not started and is not authorised by this note.

---

**Status: Step A delivered for Solution Architect review. PR left unmerged. Steps B–F
pending. Phase 2 Gate A and Consultant Pilot Ready v1 are not complete.**
