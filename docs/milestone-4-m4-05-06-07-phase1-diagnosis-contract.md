# Milestone 4 — M4-05 / M4-06 / M4-07 Phase 1 Diagnosis Contract

**Governing decision:** `docs/baslon-os-m4-05-m4-06-m4-07-phase1-diagnosis-contract-architecture-decision.md`\
**Migration:** `0007_phase1_diagnosis` (additive), approved at the migration gate with amendments (below)\
**Status:** RESOLVED (22 September 2026). Merged in PR #13 (`ca63e4f`); `0007` applied to live `baslon_os` and verified. No Baslon Digital diagnosis has run; the first run needs separate Product Owner approval.

> **AI analyses the evidence snapshot. Software enforces the contract. Humans approve material strategic interpretation.**

## Flow

```text
PHASE1_READY
  → GENERATE_PHASE1 (human)                      → PHASE1_ANALYSING
  → deterministic input + calculations → model → deterministic validation
  → MARK_ANALYSIS_COMPLETE (system, precondition) → PHASE1_AWAITING_REVIEW
  → human decides every item (ACCEPT / CORRECT / REJECT)
  → APPROVE_PHASE1 (human, precondition)          → PHASE1_APPROVED
```

- **Existing workflow states and events are reused.** `PHASE1_AWAITING_REVIEW` is the mandatory review checkpoint (`DIAGNOSIS_REVIEW_REQUIRED` in the Architecture Decision).
- **Failed runs:** a failed or invalid run leaves the workflow at `PHASE1_ANALYSING`, where a retry may run. A failed run never advances the workflow.
- **Revision:** `REQUEST_REVISION` sends a whole diagnosis back without creating an artifact. B-19 behaviour is unchanged.

## Revision semantics (v1)

After `REQUEST_REVISION`, a new Phase 1 Diagnosis requires a **newer evidence snapshot** than the one used by the diagnosis sent for revision.

- **No same-snapshot re-diagnosis.** In `REVISION_REQUIRED`, the service refuses before any run lookup. It creates no run, reuses no earlier run, makes no model call, records no `GENERATE_PHASE1` and leaves the workflow unchanged. The UI hides Run Phase 1 Diagnosis and explains: "A new diagnosis requires updated evidence and a new snapshot. Add or review information first, then run Phase 1 Diagnosis again. If the evidence is correct but an interpretation needs changing, use Correct during diagnosis review."
- **Return route.** Ordinary Add Information is accepted in `REVISION_REQUIRED`, using the existing `REVISION_REQUIRED + ADD_EVIDENCE` rule. No transition was added:

  ```text
  REVISION_REQUIRED → ADD_EVIDENCE → EVIDENCE_PROCESSING → Evidence Review → EVIDENCE_READY (newer snapshot)
    → Evidence Coherence → GAP_RESOLUTION_REQUIRED → gap decision → PHASE1_READY → GENERATE_PHASE1
  ```

- **Dead transition removed.** `REVISION_REQUIRED + GENERATE_PHASE1` is no longer in the state machine. A newer snapshot can only exist after leaving `REVISION_REQUIRED`, so a fresh diagnosis always starts from `PHASE1_READY`.
- **History is preserved.** `REQUEST_REVISION` leaves the original run, items, calculations, review session, decisions and snapshot unchanged. A diagnosis of the newer snapshot is a new run with a new review lifecycle. Run idempotency (`analysis_runs_equivalent_active_unique`) is unchanged.
- **Canonical state changes only through Evidence Review**, never through diagnosis generation or revision.
- **Future possibility (not implemented).** Re-diagnosing the same snapshot with explicit human revision instructions would need its own run-identity and revision contract, for example a revision discriminator in the run identity, and a separate architecture decision.

## Versions

| Contract | Version |
|---|---|
| Diagnosis input | `phase1_diagnosis_input_v1` |
| Prompt / output | `phase1_diagnosis_v1` |
| Approved artifact | `phase1_diagnosis_artifact_v1` |
| Calculation rule | `annualised_run_rate` `v1` |

## Exact snapshot binding and reproducibility

- **Run record:** the run is an `analysis_runs` row with `module = 'phase1_diagnosis'`. It is FK-bound to one immutable snapshot, and its provenance is immutable under the existing lifecycle trigger.
- **Recorded provenance:** `analysis_runs.model_configuration` holds `snapshotContentHash` (SHA-256 of the snapshot's stable serialization), `gapSourceRunId` and the calculation rule versions. With the snapshot FK and the deterministic input hash, this is the approved "equivalent verification" of the fingerprint.
- **Continuation basis:** the input is built only from the snapshot and the validated gaps of the Evidence Coherence run recorded by the latest `CONTINUE_WITH_GAPS` transition.
- **Hash check before reuse:** before review decisions or approval use a run, the service rebuilds its input and proves it still reproduces the recorded input hash.

## Snapshot/run-local handles

| Prefix | Record | Source |
|---|---|---|
| `C###` | Claim | Evidence Coherence v3 projection of the same snapshot (admission order, then UUID) |
| `E###` | Evidence | same |
| `M###` | Metric | same |
| `G###` | Validated Evidence Coherence gap | continued-with run; priority, then gap ID |
| `D###` | Deterministic diagnosis calculation | this run |

- **No canonical UUID reaches the model.**
- **Resolution is exact:** application code resolves handles by exact lookup. Unknown, malformed, wrong-namespace, cross-snapshot and cross-Business handles fail closed.
- **Handles are not canonical references:** the database stores canonical IDs.

## Deterministic calculations (software calculates; AI interprets)

- **Generic rules only.** Rules are generic over canonical Metric structure. None is keyed to a Business or metric key.
- **v1 rule: annualised run-rate.** Each Metric in `<currency> per month` becomes `× 12`, labelled "a run-rate, not realised revenue".
- **Precision preserved.**
  - The precision class is kept. Approximate stays approximate.
  - A range stays a range with both bounds scaled; there is no midpoint.
  - `unspecified` is never upgraded.
  - Arithmetic uses exact decimals.
- **Calculations are part of the run.** They are persisted with the run in `diagnosis_calculations`. Explicit source relationships go in `diagnosis_calculation_sources` (FK-backed, same-Business).
- **Insufficient inputs.** Where inputs are insufficient, no value is derived. For example, a historical revenue mix whose period coverage exists only in free-text dimensions is not calculated.

## Output and validation (fail-closed)

- **Each item carries** `itemType`, `statement`, `rationale`, `grounding` (`evidence_backed` / `calculated` / `interpretive` / `hypothesis`), `materiality`, `interpretationConfidence` and `limitations`, plus handle references with roles `primary` / `context` / `limiting_gap`.
- **No priority rank.** It is omitted, as the Solution Architect preferred.
- **Validation runs on model output and on every human correction alike:**
  - **Handles:** each resolves exactly. Only gaps may use `limiting_gap`, and gaps must use it.
  - **Grounding:** `evidence_backed` needs a primary Claim, Evidence or Metric. `calculated` needs a primary calculation. `interpretive` and `hypothesis` need stated limitations. The last rule is also a table CHECK.
  - **Missing-data guardrail:** a definitive negative performance verdict ("is unprofitable", "is ineffective") needs quantitative primary support. Missing data is not evidence of poor performance.
  - **M4-06:** qualifiers, `strengthScore` or confidence used as a truth weight or probability are rejected. So is an "exactly / precisely" claim on a non-exact source, and a range midpoint.
  - **Whole-output failure:** any issue rejects the whole output. Nothing partial is persisted.

## Qualifier semantics (M4-06)

- **`strengthScore`** stays semantic-link confidence. It is passed through unchanged and never aggregated.
- **Reliability, directness, recency and precision** are descriptive only. No code computes a truth weight or a diagnosis confidence from them.
- **`interpretationConfidence`** is diagnosis-local: confidence in the interpretation, not a truth probability.
- **Materiality** means "could materially affect the business or its strategy", not truth.
- **Scope:** these labels are defined only for diagnosis. B-09 stays open.

## Human review (M4-07)

- **Complete review surface.** The page shows every persisted material field with its exact value and definition, together with the carried-forward gaps, the software calculations (labelled derived) and read-only provenance.
- **Field manifest.** A manifest test keeps the review fields equal to the output schema and to the persisted columns (the M4-11 lesson).
- **ACCEPT / CORRECT / REJECT.**
  - CORRECT may change every material field, including references and grounding. The corrected item must pass the same validation.
  - REJECTED items are excluded from the artifact.
- **Approval** requires exactly one decision on every item, enforced by the application and by trigger.
- **Approval also requires at least one ACCEPTED or CORRECTED item** (pre-merge amendment). An all-rejected review cannot be approved: the UI hides Approve and points to Request Revision, and the repository, the `APPROVE_PHASE1` precondition and the `approved_diagnosis_guard` trigger all refuse it.
- **The approved artifact** (`approved_diagnoses`):
  - is built server-side from immutable items, validated decisions, calculations and resolved references;
  - never accepts browser-supplied JSON;
  - is versioned and immutable;
  - always includes the carried-forward gaps;
  - records what approval does and does not mean.

## Solution Architect migration-gate amendments (implemented)

1. **Explicit calculation provenance:** `diagnosis_calculation_sources`, immutable, FK-backed and same-Business.
2. **Handle namespaces:** C / E / M / G / D approved.
3. **Fingerprint:** `snapshotContentHash` in immutable run provenance. No new column.
4. **Corrections:** all material fields are correctable, including references and grounding (not downgrade-only), subject to validation. `priority_rank` is omitted.
5. **Same-run integrity** by composite FKs:
   - a review's session and item belong to one run (`diagnosis_item_reviews_*_same_run_fk`);
   - a cited calculation belongs to the item's run (`diagnosis_item_references_calculation_same_run_fk`);
   - an approval's session reviewed the approved run (`approved_diagnoses_session_same_run_fk`).
6. **Review completeness:** `COMPLETED` only when every item has exactly one decision (trigger and application).
7. **Artifact:** versioned, generated by the application, REJECTED excluded, CORRECTED incorporated, immutable.
8. **Failed runs:** stay at `PHASE1_ANALYSING`; retry is permitted there.
9. **B-19:** unchanged.
10. **Rollout:** `0007` is applied to `baslon_os_test` and PGlite, and, with Product Owner approval on 22 September 2026, to live `baslon_os`. There it was applied exactly once, verified as schema-only and data-neutral, and left the Baslon Digital rebuild unchanged.

## Database (`0007_phase1_diagnosis`, additive only)

- **New enums:** `diagnosis_item_type`, `diagnosis_grounding`, `diagnosis_interpretation_confidence`, `diagnosis_reference_role` and `diagnosis_review_session_status`. `finding_materiality`, `evidence_review_decision` and `numeric_precision` are reused.
- **New tables:** `diagnosis_calculations`, `diagnosis_calculation_sources`, `diagnosis_items`, `diagnosis_item_references`, `diagnosis_review_sessions`, `diagnosis_item_reviews` and `approved_diagnoses`.
- **Integrity:** every table is Business-owned, with composite same-Business FKs.
- **Triggers:**
  - diagnosis output may only be written while its own `phase1_diagnosis` run is RUNNING;
  - output, reviews and approvals are immutable;
  - the review session lifecycle and completeness are enforced;
  - an approval must match its run's snapshot, snapshot version, input and prompt versions and input hash, and requires a COMPLETED review with at least one ACCEPTED or CORRECTED item.
- **Permanent Delete** covers all seven tables.
- **No existing table, column, enum or row is changed.**
- **Rollback** is clean while the tables are empty. After diagnosis data exists, only forward fixes are appropriate.

## Workflow preconditions (Orchestrator, in-transaction)

- **`GENERATE_PHASE1`** (from `PHASE1_READY` only): the latest snapshot must equal the recorded continuation snapshot, and the recorded Evidence Coherence run must be the continued-with successful run on it.
- **`MARK_ANALYSIS_COMPLETE`** (from `PHASE1_ANALYSING` only): needs a successful diagnosis of the latest snapshot.
- **`APPROVE_PHASE1`:** needs the approved artifact of the current diagnosis of the latest snapshot, and at least one ACCEPTED or CORRECTED item in its review.
