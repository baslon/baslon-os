# Baslon OS — AI Boundaries

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
