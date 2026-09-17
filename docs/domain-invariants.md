# Baslon OS — Domain Invariants

## Claim–Evidence relationship strength

`claim_evidence.strength_score` is a nullable 0–1 semantic-link-confidence value.
It answers: “How confident are we that this specific Evidence stands in the
recorded `supports`, `contradicts` or `context` relationship to this Claim?”

It does not answer whether the Claim is objectively true. Claim truth/readiness
must be assessed using the Claim's epistemic type and status together with
Evidence provenance, reliability, directness, recency and independent
corroboration. Relationship strength is not Evidence quality, materiality or
diagnostic importance, and it cannot authorize fact admission.

The value is not a calibrated probability. It must not be aggregated, thresholded
or converted into strategic confidence without a separately approved, versioned
rule. Historical values retain this definition permanently. Existing immutable
snapshots must not be rewritten, and current scores must not be reinterpreted as
evidence credibility. Any future change in meaning requires explicit versioning.
