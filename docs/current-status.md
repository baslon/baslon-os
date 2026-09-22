# Baslon OS — Current Development Status

Updated: 21 September 2026

## Current engineering milestone

Milestone 3D pre-diagnosis hardening is merged (`8602b98`), followed by the
initial-intake review guard (PR #1, `93e03e3`).

Milestone 4A — Gap Resolution & Phase 1 Entry is merged (PR #2, `57bddec`). `GAP_RESOLUTION_REQUIRED` is a human
resolution checkpoint: a human can add information (with or without a surfaced
question) or explicitly continue with known gaps to `PHASE1_READY`. From
`PHASE1_READY` a human can still add information. No Phase 1 diagnosis engine,
diagnosis persistence or new database migration has been introduced. See
`docs/milestone-4a-gap-resolution-phase1-entry.md`.

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

**Baslon Digital controlled rebuild v2: at `PHASE1_READY` on Snapshot 4. The Product Owner continued with 6 known gaps (`CONTINUE_WITH_GAPS`, 21 September 2026).**
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
- From `PHASE1_READY` a human can still add information. Nothing has been archived or deleted.

**Six validated gaps carried into Phase 1.** Continuing did **not** resolve these; they remain open on record:

1. **High — financial performance:** direct delivery costs, operating costs, founder compensation, profit/loss and cash generated are not reliably tracked.
2. **High — sales and conversion:** no reliable end-to-end opportunity history or lead-to-sale conversion history.
3. **High — marketing and acquisition:** channel-level opportunities, sales, revenue, acquisition cost and founder time are not reliably tracked.
4. **High — financial performance / revenue mix:** no reliable comparable historical revenue-mix baseline, and no established target recurring-revenue percentage.
5. **Medium — customers and market:** reliable customer counts, revenue, lifetime value, retention and conversion metrics are not available by customer segment.
6. **Medium — delivery and capacity:** current founder working-time allocation across production, strategy, sales, marketing, administration and product work is not reliably tracked.

**Phase 1 boundary: the Business is `PHASE1_READY`, but Phase 1 Diagnosis has not started.**
`PHASE1_READY` does not authorise a diagnosis run. Diagnosis execution remains blocked
until the diagnosis contract (M4-05, M4-06, M4-07) is reviewed and merged, migration
`0007` is applied to `baslon_os` with Product Owner approval, and the Product Owner
separately authorises a run.

**M4-05 / M4-06 / M4-07 (Phase 1 Diagnosis contract): implemented on `claude/milestone-4`,
awaiting Solution Architect review.**

- **Versions:** `phase1_diagnosis_input_v1` / `phase1_diagnosis_v1`.
- **Input:** exact-snapshot binding, run-local C/E/M/G/D handles and software-owned calculations.
- **Validation:** fail-closed, covering grounding, the missing-data guardrail and M4-06 qualifier/precision semantics.
- **Human review:** mandatory at `PHASE1_AWAITING_REVIEW`, with ACCEPT/CORRECT/REJECT and an immutable, server-built approved artifact. Approval needs at least one ACCEPTED or CORRECTED item.
- **Revision (v1):** after `REQUEST_REVISION`, a new diagnosis needs a newer snapshot. `REVISION_REQUIRED` returns through ordinary Add Information and the normal evidence path to `PHASE1_READY`; same-snapshot re-diagnosis is refused.
- **Migration `0007_phase1_diagnosis`** (additive) is applied to `baslon_os_test` only. **`baslon_os` is not migrated.**

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
grounding), B-31 (compound number words) and B-32 (`PHASE1_AWAITING_REVIEW + ADD_EVIDENCE`
is defined but not reachable).

Not started: M4-02B and Phase 1 Diagnosis (see the Phase 1 boundary above). The current Baslon Digital Business has not been archived.

## Active Baslon Digital Business

- Business ID: `74230122-26a9-4268-92c0-0fe963d1ee8f`
- Status: active
- Current workflow state: `GAP_RESOLUTION_REQUIRED` (observed read-only on
  19 September 2026)
- Not archived and not rebuilt; the rebuild has not started.
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
- Current Evidence Coherence prompt: `evidence_coherence_v3` with input
  `evidence_coherence_input_v2`, adding numeric precision (M4-02A); `v1`/`v2` remain historical.
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
- Workflow state: `NEW`

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
