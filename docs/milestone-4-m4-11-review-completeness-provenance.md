# Milestone 4 — M4-11 + N-1: Human Review Completeness and Application-Owned Provenance

M4-11 and N-1 close two defects at the human-review / canonical-persistence
boundary.

- Governing decision: `baslon-os-m4-11-human-review-completeness-and-provenance-architecture-decision.md` (approved).
- Analysis: `docs/m4-11-architectural-analysis.md`.

> **If Accept will write it, the reviewer must be able to see it.**
> **True provenance belongs to the application, not the model.**

## Broadened M4-11 Scope

The original finding named four hidden qualifiers. Inspection showed that Accept persisted the **whole** proposal while the card showed only part of it, across three proposal types:

- **Claims:** subject area, confidence score, confidence basis and source type.
- **Evidence:** evidence type, value text, unit, period, reliability level and score, directness, recency, source notes and provenance.
- **Metrics:** metric key, unit, period, dimension and source-Evidence link.

Relationships were already complete (R-13).

## N-1 — Model-Authored Provenance

Evidence `sourceType`, `sourceReference` and `sourceMetadata.suppliedBy`, and Claim `sourceType`, were persisted from the model's output. The model echoes the application's input, but nothing validated it, so a model could write arbitrary provenance into canonical Evidence.

## What Changed

### Review card (`app/proposal-review-summary.tsx`)

The pending card now renders the complete canonical object Accept will persist:

- **Existing sections:** headline, attributes, source excerpt, numeric value/precision/range, and relationship endpoints.
- **"Recorded if you accept"** (AI-proposed, correctable):

  | Type | Fields |
  |---|---|
  | Claim | subject area, confidence score, confidence basis |
  | Evidence | evidence type, value as written, unit, period, reliability, reliability score, directness, recency, source notes |
  | Metric | metric key, unit, period, dimension, source Evidence (statement and reference) |

- **"Provenance (recorded by Baslon OS, read-only)"**:
  - Claim and Evidence source type;
  - Evidence source reference and supplied-by;
  - extraction run, proposal and reviewer.

There is no per-field confirmation: Accept authorises the whole visible card.

### Correctability (`app/proposal-review-controls.tsx`, `app/actions.ts`, `src/domain/evidence-review.ts`)

Newly correctable:

- Evidence `evidenceType`;
- Evidence `sourceMetadata.notes` (sent as `sourceNotes`, merged into `sourceMetadata.notes`);
- Metric `dimensionData` (dimension and value).

Metric `dimensionData` was already accepted by the correction schema, but the form didn't expose it. Existing correctable fields are unchanged.

Provenance and lineage are not correctable: the correction schemas are strict and reject `sourceType`, `sourceReference` and `sourceMetadata`.

### Application-owned provenance (`src/domain/review-card.ts`, `src/services/evidence-review-service.ts`)

`applicationProvenance(run)` derives provenance from the reviewed extraction run. The review card and the review service both use it, so what is shown is what is written.

| Canonical field | Source |
|---|---|
| Evidence and Claim `source_type` | `evidence_extraction_runs.source_type` (`business_intake`, `additional_text`); `unrecorded` if the run recorded none |
| Evidence `source_reference` | `evidence_extraction_runs.source_reference` |
| Evidence `source_metadata.suppliedBy` | `evidence_extraction_runs.source_metadata.suppliedBy` (application sets `human_ui`) |
| Evidence `raw_payload` | `{ excerpt, sourceExcerpt }` from the validated source excerpt, plus `extractionRunId` and `proposalId` |
| `evidenceReview` lineage (Claim `confidence_basis`, Evidence `source_metadata`, Metric `dimension_data`) | review session, extraction run, proposal, reviewer, review-card version |

- **Same-Business integrity:** the service refuses to derive provenance from a run belonging to another Business. The existing same-Business foreign keys are unchanged.
- **`sourceType` is not overloaded:**
  - the extractor prompt never instructs the model on it, so the model only echoes the application's input;
  - every stored value is a channel;
  - the AI's interpretive classification of a source lives separately in `evidenceType`, which stays AI-proposed and is now visible and correctable.

  No schema change was needed.
- **Unchanged proposals:** model-echoed provenance stays inside the immutable proposal payload and is never persisted canonically.

### Review contract stamp

Newly accepted Claims, Evidence and Metrics carry `evidenceReview.reviewCardVersion = "m4_11_v1"` in their existing lineage JSON. Relationships have no lineage JSON; they are recorded through `proposal_reviews`, and their review was already complete.

### Historical presentation

Nothing is backfilled or rewritten. On Evidence State, a reviewed Claim, Evidence record or Metric whose lineage lacks the stamp shows, at read time:

> Qualifiers were AI-assigned and were not all displayed at the original review.

Records entered outside Evidence Review keep their existing label.

## Regression Invariant

`src/domain/review-card.ts` holds a field manifest assigning every proposal-schema field one location:

- a card location: `headline`, `attributes`, `source`, `numeric`, `endpoints` or `details`;
- `provenance` (application-assigned);
- `internal` (`proposalRef`, and Evidence `rawPayload`, which is replaced by the application).

`tests/unit/review-card.test.tsx` checks that:

- the manifest keys **equal** the proposal schema keys for Claims, Evidence, Metrics and relationships, so a new field fails the test until it is placed;
- every `details` and `provenance` field produces a rendered row whose label and exact value appear on the card.

**Application-derived fields, intentionally not shown as proposal fields:**

- canonical IDs and timestamps; `businessId`;
- `evidenceReview` lineage;
- `rawPayload`;
- Metric `sourceEvidenceId` and relationship endpoint IDs, resolved from accepted records. The source Evidence statement *is* shown.

## Tests

| Test file | Coverage |
|---|---|
| `tests/unit/review-card.test.tsx` (11) | manifest invariant; complete rendering for each type; run provenance shown read-only, and model provenance never shown or correctable; `unrecorded` fallback; new correction fields; relationships unchanged; legacy warning |
| `tests/integration/evidence-review.test.ts` (+3; 1 updated) | canonical provenance from the run, not model text; review-card stamp on Claim, Evidence and Metric; corrected evidence type, source notes and dimension persisted; provenance corrections rejected; relationships unchanged. The M2B provenance test now expects the run's reference. |
| `tests/postgres/evidence-review.postgres.test.ts` (+1) | run provenance, the `unrecorded` fallback and the review-card stamp on PostgreSQL 17 |

## Not Changed

- **Out of scope, not touched:** schema and migrations, extractor prompts, precision semantics, validator vocabulary, Evidence Coherence prompts, diagnosis.
- **Findings still open:**
  - **B-09:** controlled vocabulary for reliability, directness and recency;
  - **M4-03:** question-context grounding of Claims and descriptive fields.
- **M4-06 unchanged:** reliability, directness, recency, confidence and `strengthScore` remain non-truth-weights.
- **Rebuild paused:** the Baslon Digital controlled rebuild is paused. Rebuild Business `9aec14e1-4eae-47cd-9ddd-d43d8d26d8de` and its S1 records were not modified; they will show the legacy warning. Per the decision, S1 is to be re-run in a fresh rebuild Business after this fix is reviewed and merged.
