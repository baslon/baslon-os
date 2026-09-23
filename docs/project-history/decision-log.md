# Baslon OS — Decision Log

The decisions that materially shaped Baslon OS, with the problem each solved and what it committed the product to. Every entry is supported by repository records; where a decision is only partly settled, that is stated.

`D-` identifiers exist **only in this folder**. They are not retrofitted into code, architecture documents or the findings register.

See [`timeline.md`](timeline.md) for the chronology and [`milestones.md`](milestones.md) for the stage map.

---

## Foundations

### D-001 — AI proposes, software validates, humans decide

| | |
|---|---|
| **Date** | 13 September 2026 |
| **Problem** | A model that writes business facts directly produces confident, unauditable fiction. |
| **Decision** | AI proposes; software validates and calculates; humans make material strategic decisions. Baslon OS is explicitly not a chatbot, CRM, task manager or report generator. |
| **Consequence** | Every AI feature since follows propose → validate → human decision → persist. It is the reason review checkpoints exist at extraction, diagnosis and headlines. |
| **Status** | Permanent governing principle |
| **Source** | [`briefs/001-phase-1-strategic-diagnosis.md`](../../briefs/001-phase-1-strategic-diagnosis.md), [`AGENTS.md`](../../AGENTS.md), [`docs/domain-invariants.md`](../domain-invariants.md) |

### D-002 — Separate canonical truth from analytical interpretation

| | |
|---|---|
| **Date** | 13 September 2026 |
| **Problem** | Evidence, assumptions, calculations, AI reasoning and approved decisions blur together once they share a table. |
| **Decision** | Canonical business state (Claims, Evidence, Metrics, relationships) is kept structurally separate from analytical state (coherence findings, diagnosis items, approved diagnoses, headlines). |
| **Consequence** | Analytical records are bound to their analysis run and snapshot and can never update canonical evidence. Diagnosis findings are not Claims. |
| **Status** | Permanent |
| **Source** | [`docs/milestone-1-foundation.md`](../milestone-1-foundation.md), [`docs/milestone-3c-evidence-coherence.md`](../milestone-3c-evidence-coherence.md) |

---

## Evidence and truth

### D-003 — AI output does not become canonical truth automatically

| | |
|---|---|
| **Date** | 13–14 September 2026 (Milestone 2) |
| **Problem** | Extraction produces plausible structured records from messy prose, but plausibility is not authorisation. |
| **Decision** | Extraction output is a **proposal**. Canonical Claims, Evidence and Metrics exist only after an explicit human decision (Accept, Correct, Reject, Unresolved). Invalid model output fails closed and is never partially admitted. |
| **Consequence** | A human is always accountable for canonical state; model output is preserved as audit history. |
| **Status** | Permanent |
| **Source** | [`docs/milestone-2-evidence-engine.md`](../milestone-2-evidence-engine.md) |

### D-004 — Provenance belongs to the application, not the model

| | |
|---|---|
| **Date** | 20 September 2026 (M4-11 / N-1) |
| **Problem** | Model-supplied provenance was being trusted, and the review card committed qualifier values the reviewer had never seen. |
| **Decision** | Provenance comes from the extraction run recorded by the application. The review card must display the complete canonical object that Accept will persist. |
| **Consequence** | "If Accept will write it, the reviewer must be able to see it." Records carry `reviewCardVersion`; older records show a read-time warning rather than being rewritten. |
| **Status** | Resolved, merged PR #6 (`13f5df1`) |
| **Source** | [`docs/milestone-4-m4-11-review-completeness-provenance.md`](../milestone-4-m4-11-review-completeness-provenance.md) |

### D-005 — Snapshots are immutable; new information creates a newer state

| | |
|---|---|
| **Date** | 13–15 September 2026 |
| **Problem** | Re-analysing a moving target makes results irreproducible, and editing history destroys the audit trail. |
| **Decision** | Business State Snapshots are immutable. New information is reviewed and produces a **newer** snapshot; earlier snapshots are never edited. |
| **Consequence** | Any analysis can be replayed against the exact state it read. It is why a revised diagnosis requires a newer snapshot rather than a re-run of the same one. |
| **Status** | Permanent |
| **Source** | [`docs/milestone-1-foundation.md`](../milestone-1-foundation.md), [`docs/milestone-3c-evidence-coherence.md`](../milestone-3c-evidence-coherence.md) |

### D-006 — Contaminated and superseded work is preserved, not erased

| | |
|---|---|
| **Date** | 14–20 September 2026 |
| **Problem** | Development had put fictional data into a Baslon Digital Business, and a later rebuild was overtaken by the M4-11 defect. |
| **Decision** | The contaminated Business is archived read-only and never restored or copied from; the superseded rebuild is kept as history at Snapshot 1; the clean rebuild starts in a fresh Business. |
| **Consequence** | Three Businesses coexist with distinct roles, and the record shows what actually happened. |
| **Status** | Standing; the archived and superseded Businesses remain untouched |
| **Source** | [`docs/current-status.md`](../current-status.md) |

---

## Numeric semantics

### D-007 — Preserve the precision the business actually stated

| | |
|---|---|
| **Date** | 19 September 2026 (M4-02 / M4-02A) |
| **Problem** | "About £80,000" stored as `80000` becomes false precision that every later calculation inherits. |
| **Decision** | Canonical Evidence and Metrics carry explicit precision: `exact`, `approximate`, `estimate`, `range`, `unspecified`. Ranges keep both bounds and are never collapsed to a midpoint. |
| **Consequence** | Uncertainty survives into analysis; diagnosis must not restate an approximate value as exact. |
| **Status** | Resolved; migration `0006` applied to live 19 September 2026 (PR #3, `bba1d08`) |
| **Source** | [Decision](../baslon-os-m4-02-numeric-precision-architecture-decision.md), [implementation](../milestone-4-m4-02a-numeric-precision.md) |

### D-008 — `unspecified` is not `exact`, and history is not retrofitted

| | |
|---|---|
| **Date** | 19 September 2026 |
| **Problem** | Records created before precision existed had no precision to read. |
| **Decision** | They read as `unspecified` — never `exact` — and are **not** retrofitted. Correcting one requires new human-authorised evidence. |
| **Consequence** | The live migration changed no row. The original Baslon Digital Business still holds 11 numeric Evidence records from "approximately" excerpts that read as `unspecified`, which is a known, recorded state rather than a defect to patch. |
| **Status** | Standing |
| **Source** | [`docs/milestone-4-m4-02a-numeric-precision.md`](../milestone-4-m4-02a-numeric-precision.md), [`docs/current-status.md`](../current-status.md) |

### D-009 — Model number-handling failures are recorded, not silently patched

| | |
|---|---|
| **Date** | 19 September 2026 (H4 validation) |
| **Problem** | During live-model validation one run turned "five-day" into `5`. |
| **Decision** | Reject the run as designed, record the behaviour as backlog **B-31**, and change no prompt, model or code in response. |
| **Consequence** | Validation is allowed to fail visibly; the limitation stays on the register. |
| **Status** | B-31 remains **backlog** |
| **Source** | [`docs/m4-02a-h4-live-model-validation.md`](../m4-02a-h4-live-model-validation.md) |

---

## Analysis

### D-010 — Analysis reads one exact, immutable snapshot

| | |
|---|---|
| **Date** | 17 September 2026 onward |
| **Problem** | Analysis over live, shifting state cannot be reproduced or audited. |
| **Decision** | Evidence Coherence and Phase 1 Diagnosis each read one snapshot, record the exact model input and a stable hash, and are bound to that snapshot and analysis run. |
| **Consequence** | Any run can be re-derived and proved to have read what it claims. |
| **Status** | Permanent |
| **Source** | [`docs/milestone-3c-evidence-coherence.md`](../milestone-3c-evidence-coherence.md), [`docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`](../milestone-4-m4-05-06-07-phase1-diagnosis-contract.md) |

### D-011 — Models cite local handles, never canonical UUIDs

| | |
|---|---|
| **Date** | 21 September 2026 (M4-12) |
| **Problem** | Two coherence runs on the Baslon rebuild failed because the model corrupted canonical UUIDs — the second time on the same Evidence. |
| **Decision** | Snapshot-local handles (`C001`, `E014`, `M003`, later `G` for gaps and `D` for calculations) replace UUIDs in model contracts; the application resolves them. |
| **Consequence** | Citation became reliable, and the same pattern was carried into the diagnosis contract. |
| **Status** | Resolved, PR #9 (`d370d7d`) |
| **Source** | [M4-12 decision](../baslon-os-m4-12-evidence-coherence-reference-handles-architecture-decision.md) |

### D-012 — Diagnosis is analytical state, never canonical evidence

| | |
|---|---|
| **Date** | 21–22 September 2026 (M4-05/06/07) |
| **Problem** | A diagnosis reads like a set of facts and could easily be treated as one. |
| **Decision** | Diagnosis items are non-canonical. They are never reclassified as Claims, and nothing is written back to canonical evidence automatically. |
| **Consequence** | The approved diagnosis is an analytical artifact with provenance, not a new source of truth. |
| **Status** | Permanent |
| **Source** | [Diagnosis contract decision](../baslon-os-m4-05-m4-06-m4-07-phase1-diagnosis-contract-architecture-decision.md) |

### D-013 — Gaps stay gaps; missing data is not evidence of poor performance

| | |
|---|---|
| **Date** | 18 September 2026 (Milestone 4A), reaffirmed 21 September |
| **Problem** | Absent data invites negative inference — "no profit figures" becoming "unprofitable". |
| **Decision** | Gaps are first-class records. `CONTINUE_WITH_GAPS` proceeds **without resolving them**. Diagnosis must state what cannot be established and cite the limiting gap, and a definitive negative verdict requires quantitative primary support. |
| **Consequence** | Six gaps (4 High, 2 Medium) carried into Phase 1 and remain unresolved after approval. |
| **Status** | Standing |
| **Source** | [`docs/milestone-4a-gap-resolution-phase1-entry.md`](../milestone-4a-gap-resolution-phase1-entry.md), [`docs/current-status.md`](../current-status.md) |

### D-014 — Calculations are deterministic and stay derived

| | |
|---|---|
| **Date** | 21–22 September 2026 |
| **Problem** | Asking a model to do arithmetic invites invented figures and lost precision. |
| **Decision** | Software computes the calculations; the model receives them as derived inputs with rule key, rule version, formula and precision. An annualised run-rate is labelled as a run-rate, not realised annual revenue. |
| **Consequence** | The six calculations on the approved diagnosis remain derived values after approval. |
| **Status** | Permanent |
| **Source** | [`docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`](../milestone-4-m4-05-06-07-phase1-diagnosis-contract.md) |

### D-015 — Qualifiers are not truth weights

| | |
|---|---|
| **Date** | Milestone 4 |
| **Problem** | Relationship strength, reliability, directness, recency and interpretation confidence look like probabilities and invite scoring. |
| **Decision** | Claim–Evidence relationship strength is confidence that the **relationship type** is semantically right — never the probability a Claim is true. None of these qualifiers may be combined, averaged or converted into a truth score, and validation rejects output that does so. |
| **Consequence** | No composite "confidence score" exists anywhere in the product. |
| **Status** | Permanent; **B-09** (wider label semantics) remains backlog |
| **Source** | [`AGENTS.md`](../../AGENTS.md) §18, [`docs/current-status.md`](../current-status.md), [findings register](../baslon-os-consolidated-code-review-findings-register.md) |

---

## Workflow

### D-016 — Material decisions stay human, and the workflow stops for them

| | |
|---|---|
| **Date** | Milestone 2 onward |
| **Problem** | An autonomous pipeline would quietly make strategic choices. |
| **Decision** | The workflow halts at defined human checkpoints: Evidence Review, gap resolution, diagnosis review, diagnosis approval and headline review. AI never approves its own output. |
| **Consequence** | A successful diagnosis run stops at `PHASE1_AWAITING_REVIEW`; only an explicit human approval reaches `PHASE1_APPROVED`. |
| **Status** | Permanent |
| **Source** | [`docs/ai-boundaries.md`](../ai-boundaries.md), [`docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`](../milestone-4-m4-05-06-07-phase1-diagnosis-contract.md) |

### D-017 — Workflow preconditions are enforced inside the transaction

| | |
|---|---|
| **Date** | 22 September 2026 (M4-04) |
| **Problem** | Workflow state and actor legality are necessary but not sufficient — a transition could outrun the artifact it depends on. |
| **Decision** | Event-specific preconditions are checked transactionally, with the active Business row locked and rechecked; placeholder artifacts are never invented to satisfy a future state. |
| **Consequence** | Approval cannot record a state the data does not support. |
| **Status** | Resolved, PR #16 (`f6be11c`) |
| **Source** | [`docs/current-status.md`](../current-status.md), [findings register](../baslon-os-consolidated-code-review-findings-register.md) |

### D-018 — Approve only what the reviewer can see

| | |
|---|---|
| **Date** | 22 September 2026 (M4-13) |
| **Problem** | The review page showed generated items while approval would persist **corrected** values. |
| **Decision** | One shared effective-item function serves both the review page and the artifact builder, so the reviewer sees exactly what approval will write. |
| **Consequence** | All 14 approved items matched the effective pre-approval values field for field. |
| **Status** | Resolved, PR #18 (`23750b4`) |
| **Source** | [`docs/current-status.md`](../current-status.md) |

### D-019 — A revision needs new evidence, not a re-run

| | |
|---|---|
| **Date** | 21 September 2026 |
| **Problem** | Re-running a diagnosis on the same snapshot would invite retrying until the output is liked. |
| **Decision** | A diagnosis sent back for revision requires updated evidence and a **newer snapshot**; an all-rejected review cannot be approved at all. |
| **Consequence** | Disagreement with an interpretation is handled by Correct during review, or by new evidence — not by re-rolling the model. |
| **Status** | Standing (`183c41b`, `7d6a540`, PR #13) |
| **Source** | [`docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`](../milestone-4-m4-05-06-07-phase1-diagnosis-contract.md) |

### D-020 — Approval is explicit, and its meaning is recorded with it

| | |
|---|---|
| **Date** | 22 September 2026 |
| **Problem** | "Approved" could be read as "verified as objectively true". |
| **Decision** | Approval accepts the diagnosis as the current analytical basis for the next phase, and the artifact itself carries that statement. It does not make a Claim true, resolve a gap, convert interpretation into canonical fact, or approve a recommendation. |
| **Consequence** | The approved artifact and the UI both state the limits of what was approved. |
| **Status** | Standing; approved diagnosis `a4e4f0e0-…`, `PHASE1_APPROVED` v21 |
| **Source** | [`docs/current-status.md`](../current-status.md) |

---

## Diagnosis presentation

### D-021 — Approved presentation is gated on workflow state and fails closed

| | |
|---|---|
| **Date** | 22 September 2026 |
| **Problem** | If the workflow and the approved artifact disagreed, the UI might show an "approved" diagnosis that was not. |
| **Decision** | The approved view renders only when the workflow is `PHASE1_APPROVED` **and** an approved artifact exists. Any mismatch shows an integrity notice, offers no action, and repairs nothing. |
| **Consequence** | The presentation layer cannot manufacture an approved state. |
| **Status** | Standing, PR #21 (`32996a6`) |
| **Source** | Git history; [`docs/current-status.md`](../current-status.md) |

### D-022 — Business meaning first, audit detail second

| | |
|---|---|
| **Date** | 22 September 2026 (PR #23) |
| **Problem** | A correct diagnosis that reads like a database view does not support a decision. |
| **Decision** | Five views — Overview, Full Diagnosis, Evidence Gaps, Calculations, Audit & Provenance — with progressive disclosure, and identifiers, hashes and original AI proposals confined to the audit layer. |
| **Consequence** | Nothing was merged, re-ranked, rewritten or summarised: the views are a deterministic projection of the frozen artifact. |
| **Status** | Complete, merge `45ed2f8` |
| **Source** | Git history; [`docs/current-status.md`](../current-status.md) |

### D-023 — The statement is the authority; the headline is a label

| | |
|---|---|
| **Date** | 22–23 September 2026 |
| **Problem** | Short labels make a diagnosis scannable, but generated labels could become the thing people act on. |
| **Decision** | A headline is a human-reviewed presentation label for an approved statement. It adds no finding, recommendation, ranking, priority or certainty, and deterministic validation forbids a number the statement does not carry. Nothing is generated at render time. |
| **Consequence** | Headlines lead the Overview while every approved statement stays visible beneath. |
| **Status** | Complete and live, PR #24 (`32f5529`) |
| **Source** | [`docs/milestone-4-diagnosis-item-headline-extension.md`](../milestone-4-diagnosis-item-headline-extension.md) |

### D-024 — Do not mutate an approved artifact to add presentation

| | |
|---|---|
| **Date** | 22–23 September 2026 |
| **Problem** | The simplest way to add headlines to the existing approved diagnosis would have been to write them into `approved_diagnoses.approved_content`. |
| **Decision** | The approved v1 artifact is immutable. Future diagnoses carry native headlines (`phase1_diagnosis_v2` / `phase1_diagnosis_artifact_v2`); the existing one is labelled by a separate immutable **companion headline set**, bound to that exact approved diagnosis, version and run, and versioned append-only. Version dispatch on the run's recorded prompt version keeps v1 parsing unchanged. |
| **Consequence** | The approved content hash `0f9fe3b0…` is unchanged and contains no headline field. A headline change means a new set version, reviewed and approved again. |
| **Status** | Complete; companion set `b586678b-…` version 1 approved 23 September 2026 |
| **Source** | [`docs/milestone-4-diagnosis-item-headline-extension.md`](../milestone-4-diagnosis-item-headline-extension.md) |

### D-025 — Presentation changes create no workflow transition

| | |
|---|---|
| **Date** | 23 September 2026 |
| **Problem** | A headline approval is a strategic-feeling act and could have been modelled as a workflow event. |
| **Decision** | Headline-set approval locks and rechecks the Business, refuses archived Businesses and requires the exact current approved diagnosis — but creates **no** workflow transition. |
| **Consequence** | The workflow stayed `PHASE1_APPROVED` v21 with 20 transitions across the entire headline rollout. |
| **Status** | Standing |
| **Source** | [`docs/milestone-4-diagnosis-item-headline-extension.md`](../milestone-4-diagnosis-item-headline-extension.md), [`docs/current-status.md`](../current-status.md) |

---

## Operations

### D-026 — Test databases are separated from live by construction

| | |
|---|---|
| **Date** | 17 September 2026 |
| **Problem** | A test run against the live database would be unrecoverable. |
| **Decision** | Automated PostgreSQL tests run only against `baslon_os_test`, enforced by a shared guard and a runtime `current_database()` check that fails safely. Applying a migration to live requires explicit Product Owner approval. |
| **Consequence** | Every live migration in this history (`0006`, `0007`, `0008`) was separately approved. |
| **Status** | Permanent |
| **Source** | [`AGENTS.md`](../../AGENTS.md) §9A, [`docs/milestone-3d-pre-diagnosis-hardening.md`](../milestone-3d-pre-diagnosis-hardening.md) |

### D-027 — A backup only counts once it has been restored and checked

| | |
|---|---|
| **Date** | 22–23 September 2026 (P-13) |
| **Problem** | Migration `0008` was applied to live with no restore point in existence. |
| **Decision** | Define the minimum procedure — backup, checksum, secure storage outside the repository, structural inspection, restore into a disposable database, fingerprint comparison, drop — and require it before any material live write. A production restore is a deliberate Product Owner decision, never an automatic reaction to a failure. |
| **Consequence** | A verified restore point exists at migration baseline 9. |
| **Status** | **Resolved at the minimum operational baseline only.** Scheduled backups, offsite or encrypted storage, incident handling and a formal migration rollback / forward-fix policy remain open. |
| **Source** | [`docs/operations/postgres-backup-restore-runbook.md`](../operations/postgres-backup-restore-runbook.md), [findings register P-13](../baslon-os-consolidated-code-review-findings-register.md) |

### D-028 — Real Business data is never used for synthetic testing

| | |
|---|---|
| **Date** | Standing from Milestone 2 onward |
| **Problem** | Development data had already contaminated one Baslon Digital Business. |
| **Decision** | Synthetic, scenario-only or fabricated information goes only into clearly labelled test Businesses. Information enters a real Business only when the Product Owner confirms it is genuine, and real-model testing does not make synthetic data genuine. |
| **Consequence** | The rebuild ran in dedicated rebuild Businesses; the original active Business was left untouched. |
| **Status** | Permanent |
| **Source** | [`AGENTS.md`](../../AGENTS.md) §17, [`docs/current-status.md`](../current-status.md) |

---

## Open at the current endpoint

These are recorded here so the history does not read as though Phase 1 closure resolved everything. Statuses are owned by the [findings register](../baslon-os-consolidated-code-review-findings-register.md) and are unchanged by this document.

| Item | State |
|---|---|
| M4-03 | Open — non-blocking for Snapshot 4 under the agreed guardrail |
| B-09 | Backlog — wider label/qualifier semantics |
| B-19 | Accepted design, Milestone 4 review |
| B-31 | Backlog — model number-word handling (see D-009) |
| B-32 | Backlog — a defined but unreachable workflow transition |
| B-33 | Backlog — SQL migration line endings |
| Production hardening beyond P-13 | Open — scheduling, offsite/encrypted storage, incident handling, migration rollback policy |
| Phase 2 | **NOT STARTED** |
