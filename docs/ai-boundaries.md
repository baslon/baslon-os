# Baslon OS — AI Boundaries

## Review completeness and provenance

AI-proposed values reach canonical state only after a human has seen them on the
review card:

- Claim subject area, confidence score and confidence basis;
- Evidence type, value text, unit, period, reliability, directness, recency and
  source notes;
- Metric key, unit, period, dimension and source-Evidence link.

A model must not author canonical provenance. The source type, source reference
and supplied-by it echoes stay in the immutable proposal only; canonical records
take them from the extraction run.

Showing a qualifier to the reviewer does not change its meaning. Reliability,
directness, recency, confidence and `strengthScore` remain non-truth-weights
(M4-06), and their vocabulary is still uncontrolled (B-09).

## Relationship-strength interpretation

An AI model may emit Claim ↔ Evidence relationship strength only as confidence in
the semantic appropriateness of the selected relationship type. A high score is
permitted where Evidence precisely corresponds to a management belief or
hypothesis, but it must not elevate that Claim's epistemic status or imply that
the source is independently reliable.

Models consuming the evidence graph must not treat relationship strength as proof
weight, truth probability, corroboration or Evidence quality. They must use Claim
epistemic type/status and Evidence provenance, reliability, directness and recency
for those judgments. Any change to this meaning requires explicit contract and
prompt versioning and must preserve the interpretation of historical snapshots.

Any Milestone 4 diagnosis input or prompt that receives `strengthScore` must
explicitly define it as semantic-link confidence. Milestone 4 must not consume it
as the probability that a Claim is objectively true, source reliability, evidence
credibility, proof weight, independent corroboration, materiality or diagnostic
importance. It may be used only as semantic-link confidence unless a future
approved, versioned design introduces a separate evidence-quality concept.

## Numeric precision

The extractor (`evidence_extractor_v6`/`v7`) may propose only `exact`,
`approximate`, `estimate` or `range`, and never `unspecified`. Every proposed
precision must be grounded in the wording next to the number in the cited excerpt
from the human-supplied source text. Precision wording in an interpretive question
does not count. Deterministic validation rejects any precision it cannot ground,
rather than silently changing it. A human reviewer decides the final precision.

AI must not infer or backfill precision for historical records. Evidence Coherence
(`evidence_coherence_v3`) must not treat `unspecified` values as exact or report
contradictions that depend on more precision than the values carry. Any future
diagnosis input must carry precision and bounds, and must not produce exact-looking
results from approximate, estimated, range or `unspecified` inputs.
