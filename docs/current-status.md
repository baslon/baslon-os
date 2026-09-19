# Baslon OS — Current Development Status

Updated: 19 September 2026

## Current engineering milestone

Milestone 3D pre-diagnosis hardening is merged (`8602b98`), followed by the
initial-intake review guard (PR #1, `93e03e3`).

Milestone 4A — Gap Resolution & Phase 1 Entry is merged (PR #2, `57bddec`). `GAP_RESOLUTION_REQUIRED` is a human
resolution checkpoint: a human can add information (with or without a surfaced
question) or explicitly continue with known gaps to `PHASE1_READY`. From
`PHASE1_READY` a human can still add information. No Phase 1 diagnosis engine,
diagnosis persistence or new database migration has been introduced. See
`docs/milestone-4a-gap-resolution-phase1-entry.md`.

M4-02A — Numeric Precision Foundation is implemented in the working tree on
`claude/milestone-4` and awaiting architectural review. New canonical Evidence and
Metrics carry explicit precision (`exact`, `approximate`, `estimate`, `range`,
`unspecified`), ranges keep both bounds, and records that predate it read as
`unspecified`. Migration `0006_numeric_precision` has been applied to
`baslon_os_test` only; applying it to `baslon_os` needs explicit approval. See
`docs/milestone-4-m4-02a-numeric-precision.md`.

## Active Baslon Digital Business

- Business ID: `74230122-26a9-4268-92c0-0fe963d1ee8f`
- Status: active
- Current workflow state: `GAP_RESOLUTION_REQUIRED` (observed read-only on
  17 September 2026)
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
