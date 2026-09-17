# Baslon OS — Current Development Status

Updated: 16 September 2026

## Active Baslon Digital Business

- Business ID: `74230122-26a9-4268-92c0-0fe963d1ee8f`
- Status: active
- Current workflow state: `EVIDENCE_READY`
- Initial clean Snapshot 1: `b9f55eae-66f1-46d4-817a-c9b74f665873`
- Current cumulative Snapshot 2: `2041745c-71c0-48ed-9c95-685f9f993b6a`
- Snapshot 2 contains the approved clean rebuild source plus David's reviewed
  answer about recent meaningful client channels, approximate project values,
  sale outcomes, and unknown pipeline-entry dates.

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
- Prompt: `evidence_coherence_v1`
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
