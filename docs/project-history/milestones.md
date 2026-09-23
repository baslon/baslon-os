# Baslon OS — Milestone Map

The stages the project actually went through, using the repository's own names. See [`timeline.md`](timeline.md) for the narrative and [`decision-log.md`](decision-log.md) for the reasoning.

## A note on naming

The repository's milestone naming is **not a clean sequence**, and this document preserves it rather than tidying it:

- Milestones 1, 2 (2A/2B) and 3 (3A/3B/3C/3D) are numbered stages with their own documents.
- Milestone 4 is a large body of work tracked mostly by **finding identifiers** (`M4-02`, `M4-02A`, `M4-03`, `M4-04`, `M4-05/06/07`, `M4-10`, `M4-11`, `M4-12`, `M4-13`) from the [findings register](../baslon-os-consolidated-code-review-findings-register.md), plus a separately named **Milestone 4A**.
- Two later bodies of work — the Diagnosis information architecture and the Diagnosis Item Headline extension — carry no M4 finding number and are identified by their PRs and their own documents.
- "Phase 1" and "Phase 2" are **product phases**, not milestone numbers. Phase 1 Diagnosis was delivered by Milestone 4 work.

---

## Milestone 1 — Foundation

**Dates** 13 September 2026

**Purpose** Establish the domain model before any AI work.

**Major deliverables** Business; workflow state model; Claims, Evidence, Metrics and Claim–Evidence relationships; immutable Business State Snapshots; provenance; analysis runs.

**Closure state** Complete.

**Key commits** `7d94fec`, `0c3fb6c`

**Deferred** Extraction, review and analysis all still to come.

**Entry to next stage** A schema able to hold canonical evidence honestly.

**Document** [`milestone-1-foundation.md`](../milestone-1-foundation.md)

---

## Milestone 2 — Evidence Engine (2A extraction, 2B human review)

**Dates** 13–15 September 2026

**Purpose** Turn messy human prose into canonical evidence without letting a model author truth.

**Major deliverables** Evidence Extraction behind a versioned prompt with strict schema validation; human Evidence Review with Accept / Correct / Reject / Unresolved; UX redesign around review; Business archive and restore; guarded permanent delete.

**Closure state** Complete.

**Key commits** `b22a798` (2A), `1b310ab` (2B), `4f82448`, `8acc709`, `0ab626c`, `edb60e9`

**Deferred** Review-card completeness, later corrected by M4-11; numeric precision, later added by M4-02A.

**Entry to next stage** Canonical evidence exists and is human-authorised.

**Document** [`milestone-2-evidence-engine.md`](../milestone-2-evidence-engine.md)

---

## Milestone 3 — Continuous evidence and coherence (3A, 3B, 3C, 3D)

**Dates** 15–18 September 2026

**Purpose** Absorb new information repeatedly, and surface what the evidence cannot support.

**Major deliverables**
- 3A continuous evidence foundation (`0009530`);
- 3B repeatable Add Information (`cbdff69`);
- 3C **Evidence Coherence** — contradictions, evidence gaps, questions, all analytical and snapshot-bound (`3c77a48`);
- 3D pre-diagnosis hardening — analysis isolation by module, stale-run recovery, archive-safe strategic writes, PostgreSQL test-database safety, initial-intake guard (`8602b98`, `aebd25a`, `60c8920`, PR #1 `93e03e3`).

**Closure state** Complete. The consolidated findings register was created during 3D (`44e2bc1`) and has tracked open work ever since.

**Deferred** Reference handles (later M4-12, after two live coherence failures); diagnosis itself.

**Entry to next stage** A hardened evidence workflow with visible gaps.

**Documents** [`milestone-3c-evidence-coherence.md`](../milestone-3c-evidence-coherence.md), [`milestone-3d-pre-diagnosis-hardening.md`](../milestone-3d-pre-diagnosis-hardening.md), [`milestone-3d-architectural-review-handoff.md`](../milestone-3d-architectural-review-handoff.md)

---

## Milestone 4A — Gap Resolution and Phase 1 Entry

**Dates** 18 September 2026

**Purpose** Make gap resolution a human checkpoint and give Phase 1 a controlled, audited entry.

**Major deliverables** `GAP_RESOLUTION_REQUIRED` as a human checkpoint; Add Information from gap resolution; explicit `CONTINUE_WITH_GAPS` into `PHASE1_READY`.

**Closure state** Complete, PR #2 (`57bddec`). It added no diagnosis engine, persistence or migration.

**Deferred** Everything about diagnosis itself.

**Entry to next stage** `PHASE1_READY`, with any unresolved gaps explicitly carried forward.

**Document** [`milestone-4a-gap-resolution-phase1-entry.md`](../milestone-4a-gap-resolution-phase1-entry.md)

---

## Milestone 4 — M4-02 / M4-02A: Numeric precision

**Dates** 19 September 2026

**Purpose** Stop uncertainty becoming false precision.

**Major deliverables** `exact` / `approximate` / `estimate` / `range` / `unspecified` on new canonical Evidence and Metrics; ranges keep both bounds; migration `0006_numeric_precision`; H4 live-model validation on fictional input only.

**Closure state** Resolved. Applied to live with Product Owner approval on 19 September 2026; no row changed. PRs #3 (`bba1d08`), #4 (`94a887e`), #5 (`7997f50`).

**Deferred** **M4-02B** (historical retrofit) not started — pre-precision records read as `unspecified` and are not retrofitted. **B-31** recorded from validation.

**Entry to next stage** Numeric semantics that analysis can trust.

**Documents** [decision](../baslon-os-m4-02-numeric-precision-architecture-decision.md), [implementation](../milestone-4-m4-02a-numeric-precision.md), [H4 validation](../m4-02a-h4-live-model-validation.md), [completion report](../m4-02a-completion-report.md)

---

## Milestone 4 — M4-11 / N-1 and M4-10: Review completeness and approximation scope

**Dates** 20 September 2026

**Purpose** Close two defects at the human-review / canonical-persistence boundary, then tighten how far an approximation cue carries.

**Major deliverables** Review card shows the complete canonical object Accept will persist; evidence type, source notes and Metric dimensions correctable; application-owned provenance; `reviewCardVersion = "m4_11_v1"`; M4-10 approximation-scope refinement.

**Closure state** Resolved. PRs #6 (`13f5df1`), #7 (`d0df5a7`), #8 (`fddca0b`). No migration needed; no data changed.

**Deferred** Older reviewed records keep a read-time warning rather than being rewritten. The in-progress rebuild was **paused and superseded**, not repaired.

**Entry to next stage** A review surface a reviewer can be accountable for.

**Documents** [`milestone-4-m4-11-review-completeness-provenance.md`](../milestone-4-m4-11-review-completeness-provenance.md), [`m4-11-architectural-analysis.md`](../m4-11-architectural-analysis.md)

---

## Milestone 4 — M4-12: Evidence Coherence reference handles

**Dates** 21 September 2026

**Purpose** Stop model-corrupted canonical identifiers breaking coherence runs.

**Major deliverables** Snapshot-local handles (`C`, `E`, `M`) in the coherence contract, resolved by the application; `evidence_coherence_input_v3` / `evidence_coherence_v4`.

**Closure state** Resolved after a live regression on Snapshot 4. PRs #9 (`d370d7d`), #10 (`6b48a14`), #11 (`dc1d78a`). The approved run `bcc6fd6c-…` then succeeded with 0 contradictions and 6 validated gaps.

**Deferred** None specific; the handle pattern was carried into the diagnosis contract.

**Entry to next stage** A successful coherence run on Snapshot 4, and six gaps on the record.

**Document** [M4-12 decision](../baslon-os-m4-12-evidence-coherence-reference-handles-architecture-decision.md)

---

## Milestone 4 — M4-05 / M4-06 / M4-07 (with M4-04, M4-03, M4-13): The Phase 1 Diagnosis contract

**Dates** 21–22 September 2026

**Purpose** Define and enforce what a diagnosis may claim, how it cites evidence, and how a human approves it.

**Major deliverables** Deterministic calculations as derived inputs; grounding and citation rules; the evidence/interpretation boundary; immutable diagnosis run, items and references; human review with Accept / Correct / Reject; server-built immutable approved artifact; transaction-scoped workflow preconditions (M4-04); the effective-item review surface (M4-13); migration `0007_phase1_diagnosis`, applied live after approval.

**Closure state** Resolved. PRs #13 (`ca63e4f`), #15 (`7c498b3`), #16 (`f6be11c`), #17 (`d40a794`), #18 (`23750b4`), #19 (`ca36489`).

**Deferred** **M4-03 remains open**, dispositioned as non-blocking for Snapshot 4 under a no-`v7` guardrail.

**Entry to next stage** A contract safe enough to run once, live, on real evidence.

**Documents** [decision](../baslon-os-m4-05-m4-06-m4-07-phase1-diagnosis-contract-architecture-decision.md), [implementation](../milestone-4-m4-05-06-07-phase1-diagnosis-contract.md)

---

## Phase 1 Diagnosis — first live run and approval

**Dates** 22 September 2026

**Purpose** Prove the whole chain on the real Baslon Digital rebuild.

**Major deliverables**

```text
Snapshot            da6e9a8e-…  (Snapshot 4, fingerprint bd0e75c5…)
Diagnosis run       1a03e409-0f2e-4bb7-9de9-01be66c0f84f   14 items
Human review        10 ACCEPTED, 4 CORRECTED, 0 REJECTED
Approved diagnosis  a4e4f0e0-3544-4650-95ee-f13d31b36517   version 1
Artifact            phase1_diagnosis_artifact_v1, content md5 0f9fe3b0…
Workflow            PHASE1_APPROVED v21
```

**Closure state** **COMPLETE AND APPROVED.** PR #20 (`5910d5e`) recorded the approval and the Phase 2 entry boundary.

**Deferred** The six evidence gaps remain unresolved; the six calculations remain derived values; the diagnosis remains non-canonical.

**Entry to next stage** `PHASE1_APPROVED` with an immutable approved artifact bound to Snapshot 4.

**Document** [`current-status.md`](../current-status.md)

---

## Diagnosis information architecture

**Dates** 22 September 2026

**Purpose** Make the approved diagnosis readable by a consultant or business owner.

**Major deliverables** Workflow-gated approved presentation that fails closed (PR #21, `32996a6`); the five-view model — Overview, Full Diagnosis, Evidence Gaps, Calculations, Audit & Provenance — with progressive disclosure (PR #23).

**Closure state** **COMPLETE**, merge `45ed2f839ee48955fabd627aa027f00a2c6901e7`, verified post-merge against the live approved diagnosis with no data change.

**Deferred** None outstanding; the surface was extended later by headlines.

**Entry to next stage** A stable presentation foundation to label.

**Key PRs** #21 (`32996a6`), #22 (`c412f41`), #23 (`45ed2f8`)

---

## Diagnosis Item Headline extension

**Dates** 22–23 September 2026

**Purpose** Make the diagnosis scannable without giving presentation authority over analysis.

**Major deliverables** Version dispatch on the run's recorded prompt version; `phase1_diagnosis_v2` / `phase1_diagnosis_artifact_v2` for future native headlines; an immutable, append-only companion headline set for the existing v1 diagnosis; deterministic headline validation; migration `0008_diagnosis_headlines` (additive, no backfill), applied live; headline review surface; headline resolution in the approved views.

**Closure state** **COMPLETE AND LIVE.** PR #24 (`32f5529`).

```text
Proposal run    d97b01b7-d41c-4312-a9b9-2b9186ad4da6
Review session  33622bdf-e530-45c4-ab8b-eb902abc23f9   10 ACCEPTED, 4 CORRECTED
Headline set    b586678b-3871-4939-9446-de84fceddba5   version 1, approved by David Demetrius
```

**Deferred** No headline-set version 2. Native v2 headlines are implemented but unused, because the current approved diagnosis is v1.

**Entry to next stage** A labelled, approved diagnosis with the approved statements untouched.

**Document** [`milestone-4-diagnosis-item-headline-extension.md`](../milestone-4-diagnosis-item-headline-extension.md) — includes the full list of the 14 approved headlines

---

## Operational baseline — P-13

**Dates** 22–23 September 2026

**Purpose** Make live changes recoverable.

**Major deliverables** Backup and restore runbook; a verified restore point at migration baseline 9, proved by restoring into a disposable database and comparing fingerprints; a pre-change backup rule; a minimum retention policy.

**Closure state** **RESOLVED at the minimum operational baseline** (PR #25, `0624c74`).

**Deferred** Scheduled backups; offsite or encrypted storage; incident handling; a formal migration rollback / forward-fix procedure. The production checklist item for rollback runbooks remains unticked.

**Entry to next stage** A tested restore point before further material live writes.

**Document** [`operations/postgres-backup-restore-runbook.md`](../operations/postgres-backup-restore-runbook.md)

---

## Phase 1 closure

**Date** 23 September 2026, merge `c5e9c4c267c14ca96f1849ceed17aa704c681f8c` (PR #26)

```text
Phase 1 / Milestone 4 diagnosis work   CLOSED / COMPLETE
Diagnosis IA                           COMPLETE
Headline extension                     COMPLETE AND LIVE
Headline set                           VERSION 1 APPROVED
Operational baseline                   P-13 minimum baseline
Phase 2                                NOT STARTED
```

### Still open at closure

Phase 1 being complete does not make the project defect-free. Unchanged by this closure:

| Item | State |
|---|---|
| M4-03 | Open — non-blocking for Snapshot 4 |
| M4-02B | Not started — historical numeric retrofit |
| B-09, B-19, B-31, B-32, B-33 | Backlog / accepted design, per the register |
| Production hardening beyond P-13 | Open |

Statuses belong to the [findings register](../baslon-os-consolidated-code-review-findings-register.md); this document only reports them.

### Phase 2 entry boundary

Phase 2 is **not started, not designed and not authorised**. The repository records only the conditions it would have to respect: `PHASE1_APPROVED` as prerequisite; the approved artifact as analytical authority; explicit provenance back to the approved diagnosis, run and snapshot; gaps that stay gaps; calculations that stay derived; qualifiers that never become truth weights; a staleness guard against a superseded approved diagnosis; and human checkpoints before material strategic choices.

The full boundary is recorded in [`current-status.md`](../current-status.md).

---

## Product and commercial context

Market, ICP, Design Partner and pricing context lives in [`product-commercial-context.md`](../product-commercial-context.md). It is explicitly context rather than an engineering specification, and no part of this history treats it as a product requirement.
