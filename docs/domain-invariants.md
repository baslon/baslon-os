# Baslon OS — Domain Invariants

## Continuing with known gaps

`CONTINUE_WITH_GAPS` (`GAP_RESOLUTION_REQUIRED` → `PHASE1_READY`) is a human
decision to begin Phase 1 using the current reviewed evidence despite known
unresolved gaps. It never means a gap is resolved, a question is answered, a
finding is closed or the evidence is complete, and it never changes Evidence
Coherence findings, questions, runs or snapshots.

Only a human actor may trigger it; no AI output, finding count, materiality or
`strengthScore` may trigger or authorize it. It commits only when the latest
canonical snapshot has a successful Evidence Coherence run, checked inside the
transition transaction. Its `workflow_transitions` row is the durable audit and
records the accepted `snapshotId`, `snapshotVersion`, `analysisRunId` and
`analysisPromptVersion`.

Adding information remains possible from `PHASE1_READY` through the normal Add
Information command and evidence review loop.

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
