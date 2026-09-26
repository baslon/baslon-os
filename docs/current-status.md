# Baslon OS — Current Development Status

Updated: 24 September 2026

For how the project reached this state, see [docs/project-history/](project-history/README.md): the [timeline](project-history/timeline.md), the [decision log](project-history/decision-log.md) and the [milestone map](project-history/milestones.md).

For what the product must be capable of before a real consultant tests it end to end, see [docs/product/consultant-pilot-ready-v1.md](product/consultant-pilot-ready-v1.md).

For the approved Phase 2 core architecture, see [docs/phase-2/](phase-2/): the [architecture and entry design](phase-2/baslon-os-phase-2-architecture-and-entry-design-v6.md) and its [approval addendum](phase-2/baslon-os-phase-2-architecture-v6-approval-addendum-v11-final.md).

## Current engineering milestone

**Current position (24 September 2026):** Milestone 4.
- The first live Baslon Digital Phase 1 cycle is complete and **approved**: rebuild v2 is at `PHASE1_APPROVED` v21 (details below).
- M4-04, M4-05, M4-06, M4-07, M4-12 and M4-13 are resolved. M4-03 stays open (non-blocking for Snapshot 4).
- **Phase 2 core architecture is CLOSED** (24 September 2026). The approved baseline is the two documents in `docs/phase-2/` (details below). **Phase 2 implementation has not started**, and **Pilot Fixture Architecture is a separate pending architecture gate that has not started**.
- The Diagnosis information architecture and the Diagnosis Item Headline extension are **complete and live**: migration `0008_diagnosis_headlines` is applied to `baslon_os`, and an approved companion headline set (version 1) labels the approved diagnosis without altering it (details below).
- P-13 (backups and restore) is **resolved at the minimum operational baseline**; the wider production hardening it names stays open.
- Repository baseline: `main` at the PR #25 merge (`0624c74d4c4571d94d9e507a335d2ff27e89d22c`, backup/restore runbook). Earlier baselines: PR #24 (`32f5529`, headline extension) and PR #23 (`45ed2f8`, Diagnosis IA).

Milestone 3D pre-diagnosis hardening is merged (`8602b98`), followed by the
initial-intake review guard (PR #1, `93e03e3`).

Milestone 4A — Gap Resolution & Phase 1 Entry is merged (PR #2, `57bddec`). `GAP_RESOLUTION_REQUIRED` is a human
resolution checkpoint: a human can add information (with or without a surfaced
question) or explicitly continue with known gaps to `PHASE1_READY`. From
`PHASE1_READY` a human can still add information. Milestone 4A itself introduced no
diagnosis engine, diagnosis persistence or migration; those came later with
M4-05/06/07 (below). See `docs/milestone-4a-gap-resolution-phase1-entry.md`.

M4-02A — Numeric Precision Foundation is merged (PR #3, `bba1d08`; implementation
commit `4260071`). New canonical Evidence and
Metrics carry explicit precision (`exact`, `approximate`, `estimate`, `range`,
`unspecified`), ranges keep both bounds, and records that predate it read as
`unspecified`. Migration `0006_numeric_precision` is applied to both `baslon_os_test`
and, with Product Owner approval on 19 September 2026, `baslon_os`. On `baslon_os`,
all 45 Evidence and 18 Metric rows and all 6 snapshots were unchanged by the
migration, and every row reads `unspecified`. M4-02A remains complete. See
`docs/milestone-4-m4-02a-numeric-precision.md`.

H4 live-model validation is **COMPLETED — PASSED** (19 September 2026). The
pre-rebuild live-model validation requirement is satisfied. `evidence_extractor_v6`/`v7`
were run 7 times against `gpt-5.6-luna` using fictional input only, with no database
rows created. Precision classification was correct in every run, and question
context stayed non-evidentiary. One run was rejected, as designed, when the model
turned "five-day" into 5 (backlog B-31). No prompt, model or code change followed.
See `docs/m4-02a-h4-live-model-validation.md`.

**First (pre-M4-11) rebuild: superseded, not continued.**

- Rebuild Business `9aec14e1-4eae-47cd-9ddd-d43d8d26d8de` ("Baslon Digital — Rebuild 2026") holds S1 only (Snapshot 1 `6056c37f-…`).
- S2 has not been processed. Nothing has been archived.
- The rebuild was paused because M4-11 was material: Accept had committed qualifiers the reviewer was not shown.

**M4-11 + N-1 (human review completeness and application-owned provenance)** are merged (PR #6, `13f5df1`; implementation commit `c7e0b6d`). No schema migration was required.

- The review card now shows the complete canonical object Accept will persist.
- Evidence type, source notes and Metric dimensions are correctable.
- Provenance comes from the extraction run, not the model.
- New records carry `reviewCardVersion = "m4_11_v1"`.
- Older reviewed records, including the rebuild's S1, show a read-time warning; no data changed.
- See `docs/milestone-4-m4-11-review-completeness-provenance.md`.

Architectural review and a manual browser smoke test both passed (15 of 15 checks, on `baslon_os_test`; see `docs/milestone-4-m4-11-review-completeness-provenance.md` and `docs/m4-11-architectural-analysis.md`).

The rebuild's S1 records predate the complete review card and therefore show the
read-time warning. Per the approved architecture decision, the next rebuild step is
to re-run S1 in a **fresh** rebuild Business under the new review card, before S2.
Rebuild Business `9aec14e1-…` is kept as history; archiving it is a separate
Product Owner decision.

The M4-10 approximation-scope refinement is merged (PR #8, `fddca0b`): one
approximation cue governs a later measurement of the same coordinated phrase
("roughly a three-day, 30-hour working week"), and nothing wider.

**Baslon Digital controlled rebuild v2: Phase 1 APPROVED on Snapshot 4 (`PHASE1_APPROVED` v21, 22 September 2026).** The Product Owner continued with 6 known gaps (`CONTINUE_WITH_GAPS`, 21 September 2026) before diagnosis.
Rebuild Business `a658df7e-a161-4487-a6c7-3b9f8b01b1fd` ("Baslon Digital — Rebuild
2026 v2") has processed approved sources S1–S4 through human review:

- Snapshot 4 `da6e9a8e-1ae0-4436-ab67-429a7d33197b` (fingerprint `bd0e75c5c0c8662dba0edb60b35d5e3b`): 39 Claims, 59 Evidence, 18 Metrics, 54 relationships.
- Documented deviations are accepted and left unrepaired: five S3 Evidence records carry inferred period boundaries (`2025-09-01` → `2026-08-31`); S4 has a garbled `claim_1`, a duplicate clean `claim_2`, and a non-standard `metric_1` dimension.
- Evidence Coherence run `9883e5cb-f2d8-4798-b4ac-16647c203d53` on Snapshot 4 failed because the model corrupted a canonical UUID. It was the second failure of this kind on the same Evidence (Snapshot 3 run `8c3f1af5-…`).
- The Product Owner-approved Evidence Coherence run `bcc6fd6c-d0cb-4d8d-b2d1-64813738ce9e` on Snapshot 4 **SUCCEEDED** under `evidence_coherence_input_v3` / `evidence_coherence_v4`, with 0 contradictions and 6 validated gaps (4 high, 2 medium).
- On 21 September 2026 at 15:25 UTC, the Product Owner took `CONTINUE_WITH_GAPS` exactly once through the application.
  - Transition: `GAP_RESOLUTION_REQUIRED → PHASE1_READY` (workflow version 18).
  - The event records Snapshot 4 (`da6e9a8e-…`, version 4), run `bcc6fd6c-…` and prompt `evidence_coherence_v4`.
  - Canonical records, Snapshots 1–4 and all findings are unchanged.
- The workflow then moved through Phase 1 Diagnosis and review to `PHASE1_APPROVED` (see "Phase 1: APPROVED" below). Nothing has been archived or deleted.

**Six validated gaps carried into Phase 1.** Continuing did **not** resolve these; they remain open on record:

1. **High — financial performance:** direct delivery costs, operating costs, founder compensation, profit/loss and cash generated are not reliably tracked.
2. **High — sales and conversion:** no reliable end-to-end opportunity history or lead-to-sale conversion history.
3. **High — marketing and acquisition:** channel-level opportunities, sales, revenue, acquisition cost and founder time are not reliably tracked.
4. **High — financial performance / revenue mix:** no reliable comparable historical revenue-mix baseline, and no established target recurring-revenue percentage.
5. **Medium — customers and market:** reliable customer counts, revenue, lifetime value, retention and conversion metrics are not available by customer segment.
6. **Medium — delivery and capacity:** current founder working-time allocation across production, strategy, sales, marketing, administration and product work is not reliably tracked.

**Phase 1: APPROVED** (22 September 2026). The first live Phase 1 cycle ran end to end.

| | |
|---|---|
| Workflow | **`PHASE1_APPROVED`**, version 21 |
| Approved diagnosis | `a4e4f0e0-3544-4650-95ee-f13d31b36517`, `phase1_diagnosis_artifact_v1`, version 1 |
| Diagnosis run | `1a03e409-0f2e-4bb7-9de9-01be66c0f84f` (SUCCEEDED; `phase1_diagnosis_input_v1` / `phase1_diagnosis_v1`) |
| Human review | Session `db3f8a0a-0c5f-4926-a203-4be6abaae75e`, COMPLETED: **10 ACCEPTED / 4 CORRECTED / 0 REJECTED** (I001, I002, I006 and I014 corrected) |
| Approved content | 14 items; 6 carried-forward evidence gaps; 6 deterministic calculations (`annualised_run_rate v1`) |
| Snapshot | Snapshot 4 `da6e9a8e-1ae0-4436-ab67-429a7d33197b` (version 4; content hash `ada69463…`; fingerprint `bd0e75c5…`): **unchanged** |
| Phase 2 | **NOT STARTED** |

**First live cycle, as validated:**
1. Snapshot 4 stayed immutable.
2. The diagnosis succeeded in one attempt.
3. The human review recorded 10/4/0.
4. M4-13 was resolved before approval.
5. One approved artifact was created.
6. The session moved `OPEN → COMPLETED`.
7. One `APPROVE_PHASE1` moved the workflow `PHASE1_AWAITING_REVIEW → PHASE1_APPROVED` (v20 → 21).
8. All 14 approved items matched the effective pre-approval reviewed values field for field.
9. Canonical Claims, Evidence, Metrics and relationships were unchanged.
10. No Phase 2 action occurred.

Current counts: approved_diagnoses 1; `APPROVE_PHASE1` 1; `REQUEST_REVISION` 0; `REJECT_PHASE1` 0.

**What approval means.** Phase 1 approval accepts the reviewed diagnosis as the current analytical basis for the next strategic phase. It does not make any Claim true, resolve an evidence gap, convert an AI interpretation into canonical evidence, or approve any future recommendation. Specifically:
- canonical truth remains the immutable, snapshot-bound Claim/Evidence/Metric set;
- the approved diagnosis is a non-canonical analytical artifact;
- corrected review values are the approved values, and original AI values remain audit history;
- the six carried-forward gaps remain unresolved;
- the calculations remain derived values, not founder-supplied facts.

Approval does not validate the diagnosis conclusions as objective truth.


**Phase 1 closure.** Phase 1 Diagnosis is complete and approved for the current Baslon Digital snapshot. The approved
diagnosis stays bound to Snapshot 4 and keeps its original `phase1_diagnosis_artifact_v1` analytical artifact. A separately
reviewed, immutable companion headline set (version 1) supplies business-facing labels without altering any approved
diagnosis content. The five-view Diagnosis information architecture, the six evidence gaps, the six deterministic
calculations and the provenance surfaces are live and verified. **Phase 2 remains NOT STARTED.**

## Diagnosis presentation and the approved companion headline set

**Diagnosis information architecture: complete** (PR #23, merge `45ed2f839ee48955fabd627aa027f00a2c6901e7`). The approved
diagnosis is presented through five views — Overview, Full Diagnosis, Evidence Gaps, Calculations, and Audit & Provenance.
Overview is the default business-facing view; Full Diagnosis holds all 14 approved items; Evidence Gaps holds the six
unresolved gaps; Calculations holds the six deterministic calculations; Audit & Provenance holds technical provenance and
the original AI proposals for the four corrected items. Progressive disclosure keeps business meaning primary and audit
detail secondary.

**Diagnosis Item Headline extension: complete and live** (PR #24, merge `32f5529781b6b68a19bfdff8ab3a4c204d42cde4`).
Migration `0008_diagnosis_headlines` is applied to live `baslon_os` (migration count 9). The governing rule is:

> The approved diagnosis statement remains the substantive analytical authority. The headline is a human-reviewed
> presentation label.

Future diagnoses can carry native reviewed headlines through `phase1_diagnosis_v2` and `phase1_diagnosis_artifact_v2`.
v1 compatibility is preserved by version dispatch on the run's recorded prompt version, and **the existing Baslon approved
v1 diagnosis was not mutated**: its content hash is unchanged and it carries no headline field.

**Approved companion headline set (version 1).**

| | |
|---|---|
| Headline set | `b586678b-3871-4939-9446-de84fceddba5`, version 1 |
| Approved diagnosis | `a4e4f0e0-3544-4650-95ee-f13d31b36517` (version 1), diagnosis run `1a03e409-0f2e-4bb7-9de9-01be66c0f84f` |
| Proposal run | `d97b01b7-d41c-4312-a9b9-2b9186ad4da6` (`diagnosis_headlines` module, `diagnosis_headlines_v1`) |
| Headline review | Session `33622bdf-e530-45c4-ab8b-eb902abc23f9`, COMPLETED: **10 ACCEPTED / 4 CORRECTED** (I001, I002, I005 and I009 corrected) |
| Approved by | David Demetrius, 2026-09-23T07:33:13.531Z |
| Workflow effect | **none** — the workflow stayed `PHASE1_APPROVED` v21 with 20 transitions |

The set is immutable and append-only by version; the current set is the latest approved version. There is no version 2.

The 14 approved headlines are recorded in `docs/milestone-4-diagnosis-item-headline-extension.md`. They label the approved
statements and never replace them.

**Current Diagnosis UX.** Headline resolution uses the approved companion set (source: approved companion headline set,
version 1), because the approved artifact is v1 and carries no native headline. On Overview, nine headline-led items appear
and the five Limitations stay summarised rather than individually listed; each statement remains visible beneath its
headline, importance stays visible, and redundant type and review-status badges are reduced. Full Diagnosis renders all 14
approved headlines above their approved statements and keeps the 10 Accepted / 4 Corrected Phase 1 decision badges with
full type and review detail. Audit & Provenance gained a `Headline set` group recording the set id, version, approver,
approved timestamp, companion-label semantics and the exact binding to the approved diagnosis; every existing provenance
group is intact.

**Operational state.** Live `baslon_os` is at migration count 9 with `0008` applied, and all headline implementation
objects are live. A verified production backup baseline exists (P-13, `docs/operations/postgres-backup-restore-runbook.md`,
documentation merged in PR #25, `0624c74d4c4571d94d9e507a335d2ff27e89d22c`). P-13 is resolved at the minimum operational
baseline only: scheduled backups, offsite or encrypted storage, incident handling and a formal migration rollback /
forward-fix procedure remain open.

**Phase 2 entry boundary** (recorded 23 September 2026, before the Phase 2 core architecture was approved; it remains accurate and is now defined in full by the approved architecture below):
- **Prerequisite:** workflow `PHASE1_APPROVED`. For this cycle that is v21.
- **Analytical authority:** the approved artifact `a4e4f0e0-…` (`phase1_diagnosis_artifact_v1` v1), not raw model output, unreviewed items, mutable review state, rejected items or superseded values.
- **Provenance:** any Phase 2 input keeps an explicit trail to `approvedDiagnosisId`, `diagnosisRunId`, `snapshotId`, `snapshotVersion` and `snapshotContentHash`.
- **Gaps stay gaps:** the six gaps enter Phase 2 as limitations and unresolved information needs. They are never silently resolved, turned into negative facts, filled by model inference, or ignored when a recommendation depends on them. Missing data ≠ poor performance.
- **Calculations stay derived:** they carry provenance and derived status. They are `annualised_run_rate v1` run-rates, not realised annual revenue.
- **Diagnosis is not canonical evidence:** it is never reclassified as Claims. Neither interpretation confidence nor `strengthScore`, reliability, directness or recency becomes a truth weight. Nothing is written back to canonical evidence automatically.
- **Staleness guard (intent):** Phase 2 must not proceed silently on a stale or superseded approved diagnosis. Its entry contract must prove the approved diagnosis is still the current approved basis. A newer snapshot plus a new Phase 1 approval would supersede this one.
- **Human decisions stay human:** Phase 2 may propose; material strategic choices need defined human checkpoints before becoming approved state.

**Not yet authorised:** a Phase 2 model call, Phase 2 analysis runs, strategy, recommendations, initiative ranking, objectives, roadmaps, implementation plans, any workflow move beyond `PHASE1_APPROVED`, recommendation approval, or any Phase 2 artifact.

**Phase 2 core architecture: CLOSED** (24 September 2026).

The governing Phase 2 architecture baseline for Gate A is these two documents together:

- [`docs/phase-2/baslon-os-phase-2-architecture-and-entry-design-v6.md`](phase-2/baslon-os-phase-2-architecture-and-entry-design-v6.md)
- [`docs/phase-2/baslon-os-phase-2-architecture-v6-approval-addendum-v11-final.md`](phase-2/baslon-os-phase-2-architecture-v6-approval-addendum-v11-final.md)

Recorded for this closure:

- **Both documents are governing.** Neither stands alone: the addendum records the approved clarifications and the binary acceptance criteria that supplement the architecture's own, and it controls for those clarifications only. Where it is silent, the architecture governs.
- **Architecture review is complete.** The core architecture went through six revisions and the approval addendum through eleven. The substantive design findings closed at addendum v6; the revisions after that were verification coverage and document integrity.
- **Requirements-to-criteria verification is complete.** Every normative requirement in the addendum's §§2–10 has at least one binary acceptance criterion in its §11 (111 criteria across 17 blocks). That section is regenerated from the requirements rather than edited incrementally, and the criteria supplement the architecture's own §28.
- **Phase 2 implementation has not started.** No Phase 2 schema, migration, prompt, model contract, service, workflow state or UI exists. The workflow enum still ends at `PHASE1_APPROVED`, and `analysis_runs` still holds only `evidence_coherence`, `phase1_diagnosis` and `diagnosis_headlines`.
- **Pilot Fixture Architecture is a separate pending architecture gate, and no work on it has started.** No implementation brief may be issued until it is separately approved. It must settle, among other things, whether a general pilot/test domain classification is required and how fixture eligibility is validated without hard-coding Baslon Digital — an entry precondition in the approved architecture depends on that decision.

**M4-13 (approval review surface): RESOLVED** (22 September 2026). Merged in PR #18 (`23750b4`) and verified post-merge before approval. The review page shows the exact effective items that approval persists.

**M4-04 (artifact-specific workflow preconditions): RESOLVED** (22 September 2026).
`CONTINUE_WITH_GAPS`, `GENERATE_PHASE1`, Phase 1 `MARK_ANALYSIS_COMPLETE` and `APPROVE_PHASE1`
each check their real artifact inside the transaction-scoped Orchestrator transition. No
placeholder artifacts were created. Resolving it does not authorise a diagnosis run.

**M4-03 (question-context grounding): OPEN, but non-blocking for Baslon Digital Snapshot 4
Phase 1 under the no-`v7` guardrail** (Solution Architect disposition, 22 September 2026).
- **Platform gap still open:** Claims and some descriptive semantic fields still lack deterministic grounding.
- **Snapshot 4 is not affected:** it was built only through paths without question context. All seven rebuild extraction runs used `evidence_extractor_v6`, with 0 `v7` runs and 0 question links, and S1–S4 were all human-reviewed.
- **Temporary guardrail:** until M4-03 is resolved, do not admit new Baslon Digital canonical evidence through `evidence_extractor_v7` / question-context extraction during this Phase 1 cycle. Any new information goes through standalone founder Add Information (`v6`) → Evidence Review → newer snapshot → Evidence Coherence → gap decision → `PHASE1_READY` → a fresh diagnosis.
- **No run authorised:** this disposition does not authorise the first diagnosis run.

**M4-05 / M4-06 / M4-07 (Phase 1 Diagnosis contract): RESOLVED** (22 September 2026). The
resolution rests on the architecture decision, implementation, validation and live
deployment together, not on the merge alone.

- **Merged:** PR #13 (`ca63e4f`). Implementation `6c59857`, plus two Solution Architect pre-merge amendments: `7d6a540` (approval needs a surviving item) and `183c41b` (v1 revision semantics).
- **Validation:** 286 unit/PGlite and 109 PostgreSQL tests; synthetic integration, bounded live-model and browser review-flow validation, all on synthetic data or `baslon_os_test`.
- **Deployed:** `0007_phase1_diagnosis` was applied to live `baslon_os` exactly once, with Product Owner approval, through `drizzle-kit migrate`.
  - The 5 diagnosis enums, 7 tables, FKs, CHECKs and triggers were verified; the schema matches `baslon_os_test`.
  - All 7 tables had 0 rows, and there were 0 `phase1_diagnosis` runs.
  - Permanent Delete coverage was verified by tests, without deleting a live Business.
  - Live application compatibility was verified with read-only page loads.
- **Baslon Digital unchanged:** rebuild `a658df7e-…` is `PHASE1_READY` v18 on Snapshot 4 `da6e9a8e-…` (fingerprint `bd0e75c5c0c8662dba0edb60b35d5e3b`), with 39 Claims, 59 Evidence, 18 Metrics and 54 relationships (row fingerprints identical before and after migration). There were 0 `GENERATE_PHASE1` transitions at migration time.
- **Repository baseline at resolution:** `57ad36e` (after the status PR #14).

- **Versions:** `phase1_diagnosis_input_v1` / `phase1_diagnosis_v1`.
- **Input:** exact-snapshot binding, run-local C/E/M/G/D handles and software-owned calculations.
- **Validation:** fail-closed, covering grounding, the missing-data guardrail and M4-06 qualifier/precision semantics.
- **Human review:** mandatory at `PHASE1_AWAITING_REVIEW`, with ACCEPT/CORRECT/REJECT and an immutable, server-built approved artifact. Approval needs at least one ACCEPTED or CORRECTED item.
- **Revision (v1):** after `REQUEST_REVISION`, a new diagnosis needs a newer snapshot. `REVISION_REQUIRED` returns through ordinary Add Information and the normal evidence path to `PHASE1_READY`; same-snapshot re-diagnosis is refused.
- **Migration `0007_phase1_diagnosis`** (additive) is applied to `baslon_os_test` and live `baslon_os`.

See `docs/baslon-os-m4-05-m4-06-m4-07-phase1-diagnosis-contract-architecture-decision.md`
and `docs/milestone-4-m4-05-06-07-phase1-diagnosis-contract.md`.

**M4-12 (Evidence Coherence snapshot-local reference handles): RESOLVED.** Merged in PR #9
(`d370d7d`, implementation `449cbe4`), post-merge verified, and confirmed by the Snapshot 4
live regression `bcc6fd6c-…`.

- `evidence_coherence_input_v3` and `evidence_coherence_v4` are active. They replace model-reproduced canonical UUIDs with handles (`C001`, `E001`, `M001` …), which application code resolves to canonical UUIDs after validation.
- In the live regression, all 39 model references were valid handles, and no UUID was exposed to or emitted by the model.
- The Evidence the model had corrupted twice was cited as `E040` and resolved to its correct canonical UUID.
- Canonical state and Snapshots 1–4 were unchanged.
- v2/v3 are frozen and still available, persistence still stores canonical UUIDs, and no migration was needed.

See `docs/baslon-os-m4-12-evidence-coherence-reference-handles-architecture-decision.md`
and Findings Register entry M4-12.

Still open as follow-ups: B-09 (qualifier vocabulary), M4-03 (question-context
grounding; non-blocking for Snapshot 4 Phase 1 under the no-`v7` guardrail), B-31 (compound number words), B-32 (`PHASE1_AWAITING_REVIEW + ADD_EVIDENCE`
is defined but not reachable) and B-33 (SQL migration line endings). B-19 is unchanged.

Not started: M4-02B and Phase 2 (see the Phase 2 entry boundary above). The current Baslon Digital Business has not been archived.

## Active Baslon Digital Business

- Business ID: `74230122-26a9-4268-92c0-0fe963d1ee8f`
- Status: active
- Current workflow state: `GAP_RESOLUTION_REQUIRED` v11, unchanged since
  16 September 2026 (observed read-only on 22 September 2026)
- Not archived. The controlled rebuild has been run in separate rebuild Businesses
  (see above); this Business itself has not been changed by it.
- Initial clean Snapshot 1: `b9f55eae-66f1-46d4-817a-c9b74f665873`
- Current cumulative Snapshot 2: `2041745c-71c0-48ed-9c95-685f9f993b6a`
- Snapshot 2 contains the approved clean rebuild source plus David's reviewed
  answer about recent meaningful client channels, approximate project values,
  sale outcomes, and unknown pipeline-entry dates.
- Snapshot 2 Evidence Coherence run: `98ce12e0-953d-4f3a-88a6-4427355bd95e`
  (succeeded; six non-low-materiality questions, none answered at observation).
- 11 of its 12 numeric Evidence records come from "approximately" excerpts but
  were stored as plain numbers before precision existed. After M4-02A they read
  as `unspecified`, never `exact`. They are not retrofitted. Correcting them
  needs new human-authorised evidence, which is a separate decision.

Continuing this Business with known gaps (`CONTINUE_WITH_GAPS`) is a product
decision for David. Milestone 4A makes the action available in the UI; it must not
be taken on the real Business as a test.

Future work on the real Baslon Digital Business must use this active Business ID.
Only information explicitly confirmed as genuine by David may be submitted to it.

## Archived contaminated Baslon Digital Business

- Business ID: `68bb7e68-9f0f-4810-ac80-2a563b8451ab`
- Status: archived, read-only
- Historical snapshots:
  - Snapshot 1: `7953b116-7b30-4dcb-a312-cce733c402eb`
  - Contaminated Snapshot 2: `63741f8a-3198-4245-8ae1-064e343b9b80`
  - Contaminated Snapshot 3: `1d3de3d9-8f8c-41b0-a2e0-37920cecfc45`
- Historical contaminated Evidence Coherence run:
  `94bc6f0d-2eed-4dc8-afc2-c064b2a98366`

This archived Business preserves the development audit trail. Its fictional
£195/month website-performance-review data, synthetic referral data, snapshots,
findings and questions must not be copied into the active Baslon Digital Business.
It must not be restored or permanently deleted without separate explicit approval.

## Clean Evidence Coherence history

- Clean Snapshot 1 Evidence Coherence run:
  `4d3c3221-cec2-458a-8baa-cb4a63efe64b`
- Input Snapshot: `b9f55eae-66f1-46d4-817a-c9b74f665873`
- Current Evidence Coherence prompt: `evidence_coherence_v4` with input
  `evidence_coherence_input_v3` (M4-12 reference handles). `v3` with input
  `evidence_coherence_input_v2` added numeric precision (M4-02A); `v1`–`v3` remain historical.
- Result: succeeded with no material contradictions, five evidence gaps and five
  questions.
- The first question received a genuine answer through the implemented Question →
  Add Information path, producing cumulative Snapshot 2. The Snapshot 1 analysis
  remains immutable historical analysis and must not be represented as analysis of
  Snapshot 2.

## Synthetic testing Business

- Business name: `Baslon OS Synthetic Smoke Test`
- Business ID: `43445cd1-135b-4e48-beba-ec3c3403ab04`
- Status: active
- Workflow state: `EVIDENCE_PROCESSING` v9, last changed 18 September 2026 (observed
  read-only on 22 September 2026)

Use this clearly labelled Business for fictional, scenario-only, fabricated or
destructive development smoke-test inputs. Do not populate it with unapproved
Baslon Digital information.

## Testing and database safety

Real-model testing does not make synthetic data genuine. Any manual or automated
test that persists Source Submissions, canonical Claims, Evidence, Metrics,
relationships, snapshots or analyses must use a dedicated synthetic Business
unless David has explicitly approved that information as genuine for the named
real Business.

Automated PostgreSQL tests must target `baslon_os_test`, never the `baslon_os`
development database.

## Relationship-strength semantic guardrail

Canonical Claim ↔ Evidence relationships currently store nullable 0–1
`strengthScore` values, and the values are included in snapshot-bound Evidence
Coherence input. Their locked meaning is semantic-link confidence: confidence that
the recorded `supports`, `contradicts` or `context` relationship is appropriate.
They are not evidentiary credibility or Claim-truth scores.

No deterministic threshold, workflow rule or diagnosis logic currently consumes
these values. Milestone 4 must preserve this distinction in its versioned
contracts and prompts. Existing values in immutable snapshots retain this meaning
and must not be rewritten or reinterpreted. A future rename to
`semantic_link_confidence` remains deferred and would require explicit
schema/contract compatibility work.
