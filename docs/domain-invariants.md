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

## Human review completeness

Every material field that human Accept persists to canonical state must be visible
to the reviewer on the pending review card before the decision. One Accept
authorises the whole visible card; per-field confirmation is not required.

- AI-proposed semantic fields are shown as AI-proposed and are correctable where
  disagreement is legitimate.
- The field manifest in `src/domain/review-card.ts` must account for every
  proposal field, and tests enforce this.
- Newly admitted Claims, Evidence and Metrics record
  `evidenceReview.reviewCardVersion`.
- Records without the marker are older and are labelled at read time; they are
  never rewritten.

## Canonical provenance

True provenance is assigned by the application from the extraction run, never
authored by a model:

- source type (channel);
- source reference;
- supplied-by;
- extraction run, proposal and review lineage.

Provenance is visible to the reviewer, read-only and tied to the same Business.
AI interpretation of a source, such as `evidenceType` or source notes, is labelled
as AI-proposed and must not masquerade as provenance.

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

## Numeric precision

Every canonical Evidence value and Metric has an explicit precision: `exact`,
`approximate`, `estimate`, `range` or `unspecified`. Storing a number never
makes it exact. A value is `exact` only when its source and human review support
it.

- A range keeps both bounds and has no single value. It is never collapsed to a
  bound, midpoint or average.
- `unspecified` means precision was never established. Records that predate
  M4-02A and qualitative Evidence are `unspecified`. It must never be treated as
  `exact`.
- Historical records are not retrofitted and historical snapshots are not
  rewritten. Establishing better precision for an old value needs new
  human-authorised evidence.
- A Metric taken from numeric Evidence has the same precision as that Evidence,
  at extraction and after human review. Their values may differ.
- Precision is separate from reliability, directness, recency, materiality and
  `strengthScore`.
- A calculation cannot be more precise than its least-precise material input
  (for example, approximate × exact = approximate). Ranges propagate bounds.
- The database enforces the shape: range bounds are ordered and exclusive of a
  single value, and other precisions have no bounds.
