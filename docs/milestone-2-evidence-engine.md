# Milestone 2 — Evidence Engine

## Implemented scope

Milestone 2A accepts messy human-supplied business intake and sends it through
an injectable Evidence Extraction model. The module uses the versioned
`evidence_extractor_v4` prompt, validates untrusted output with strict Zod
schemas, then applies deterministic proposal-reference and provenance rules.

The live adapter uses the official OpenAI JavaScript/TypeScript SDK, Responses
API, and strict JSON Schema Structured Outputs. `OPENAI_API_KEY` and
`OPENAI_MODEL` are read only when a live extraction executes; no model is chosen
by default.

## Proposal boundary

AI output creates proposals, not strategic truth. Validated Claim, Evidence,
Metric, and Claim/Evidence relationship proposals are stored in
`evidence_proposals` and remain separate from canonical strategic tables.
Extraction provenance, prompt/model configuration, raw intake, safely
representable raw output, status, and validation failures are retained in
`evidence_extraction_runs`.

The Evidence Extractor cannot propose `fact` or `decision` Claims. Business IDs
come from application input and are not part of the model output contract.
Relationships and Metric evidence references must resolve within the complete
validated result. Evidence and Metric excerpts must occur in the supplied raw
intake. Failed results persist no proposals, and neither successful nor failed
extraction mutates Claims, Evidence, Metrics, snapshots, or workflow state.

## Milestone 3A — Continuous Evidence foundation

A Source Submission is the immutable original information supplied to Baslon OS.
It is distinct from an Extraction Run, which is one processing attempt against
that source, and from Evidence Proposals, which remain AI interpretations until
human review. Existing historical Extraction Runs retain a null Source Submission
reference because provenance is never fabricated.

```text
Source Submission
       ↓
1..* Extraction Runs over time
       ↓
Evidence Proposals
       ↓
Human Review
       ↓
Canonical Evidence State
```

A Source Submission can also own `0..*` attachment metadata records. Milestone 3A
stores ownership and provenance metadata only: it does not provide file upload,
binary storage, document parsing, or an Add Information user interface.

Source Submissions and attachment metadata are immutable during ordinary
application activity. Composite foreign keys prevent cross-Business source,
attachment, and Extraction Run associations. Archived Businesses cannot receive
new submissions. The authorised permanent Business deletion transaction removes
the complete Source Submission graph using its existing Business-specific,
transaction-local deletion context.

## Milestone 3B — Repeatable Add Information

Completed Businesses expose `/businesses/[businessId]/information`. A dedicated
AddInformationService validates text, persists an immutable `additional_text`
Source Submission, and uses the Orchestrator's human-only ADD_EVIDENCE transition
from EVIDENCE_READY to EVIDENCE_PROCESSING. Initial intake remains a separate action.
The extractor still receives only the new source and uses evidence_extractor_v4.
No schema or prompt change is required.

Failed extraction retains its source and run. The retry action accepts a failed
run identifier, resolves its same-Business source on the server, and creates a
new run using that original text. Retry fields cannot alter the original source.
Only the latest failed run can be retried; successful proposals proceed to review.

Existing per-decision transactions append Accepted/Corrected records with their
audit entries. Rejected/Unresolved records do not enter canonical state. Completion
creates a full cumulative snapshot; it does not batch-apply decisions. Earlier
snapshots and unrelated canonical records survive each cycle. Completing an old
review again cannot advance a newer extraction's workflow. The review page exposes
the full linked source text. Semantic comparison, canonical replacement and
historical relationship targeting remain deferred.

## Milestone 2B — Human Evidence Review and Evidence State (existing semantics)

A human can open one review session for a successful extraction run and record
an explicit decision for every immutable proposal: accepted, corrected,
rejected, or unresolved. Accepted and corrected proposals are applied to
canonical strategic tables in the same database transaction as their audit
record. Rejected and unresolved proposals create no canonical state.

Corrections are deliberately limited by proposal type. Source provenance and
relationship endpoints cannot be rewritten, corrected numerical values must
still be explicit in the original excerpt, and dependent Metrics and
relationships can only be applied after their referenced Evidence and Claims
have been accepted. Review records and extraction proposals are immutable.

Review completion requires all proposals to have a decision, creates one
immutable Business State Snapshot, and advances the existing workflow from
`EVIDENCE_PROCESSING` to `EVIDENCE_READY` through the Strategy Orchestrator.
Repeated application and completion calls are idempotent.

The minimal UI supports Business creation, messy intake extraction, proposal
review, and a read-only Evidence State grouped into Facts, Observations,
Management Beliefs, Hypotheses, AI Inferences, and Unknowns. Fact admission
remains a separate explicit human operation requiring selected supporting
Evidence. The current reviewer identity is asserted by server-side form handling;
authentication and user accounts are intentionally deferred.

## Stabilisation after the first live review

Extraction now asks for one proposal per independent assertion and explicitly
separates measurements with different units. Deterministic validation rejects
Evidence that combines incompatible measurement families, including currency
and percentages, or encodes several units in one unit field. Relationship
instructions require specific semantic relevance and tell the model to omit
uncertain relationships rather than link records merely because both exist.

Proposal cards are read-only by default. Edit opens a separate correction form,
and an unchanged correction is rejected by the application service. Review
notes are labelled as audit notes and do not alter structured content.
Relationship cards show the underlying Claim and Evidence statements before
their internal references. Reject and Unresolved actions require browser
confirmation, and the UI states that submitted decisions cannot currently be
changed.

Failed extraction runs remain the server-side source for restoring raw intake
and source reference on retry. Provider errors are not placed into the browser
URL. Evidence reliability/confidence and strategic materiality remain separate
fields and are described separately in the review interface.

Decision undo/change remains deliberately deferred. The database continues to
allow one immutable review decision per proposal, and no additional migration
was introduced by this stabilisation pass.

Migration `0002_evidence_review.sql` adds review sessions, proposal decisions,
same-Business relational constraints, and immutability triggers.

## Not yet implemented

There is no Gap Analysis, Contradiction Analysis, diagnosis, recommendation,
automated evidence-quality judgment, authentication, Phase 2, or Phase 3
functionality. These omissions are deliberate; Milestone 2C has not begun.
