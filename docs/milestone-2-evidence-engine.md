# Milestone 2A — Evidence Extraction Core

## Implemented scope

Milestone 2A accepts messy human-supplied business intake and sends it through
an injectable Evidence Extraction model. The module uses the versioned
`evidence_extractor_v1` prompt, validates untrusted output with strict Zod
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

## Not yet implemented

This is Milestone 2A, not completion of Milestone 2. Human proposal review and
application are not implemented. The Evidence State UI is not implemented.
There is no Gap Analysis, Contradiction Analysis, diagnosis, recommendation,
Phase 2, or Phase 3 functionality.
