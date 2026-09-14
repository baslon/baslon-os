# Milestone 1 — Foundation

## Product purpose

Baslon OS is a strategic decision-support system. It preserves the distinction
between evidence, beliefs, hypotheses, unknowns, deterministic calculations,
AI-generated reasoning, and human-approved decisions.

## Architecture

```text
Next.js UI/API
  → application services
  → deterministic Strategy Orchestrator
  → Zod validation
  → repositories
  → Drizzle ORM
  → PostgreSQL
```

The application uses the `pg` driver in production. Tests use PGlite as an
in-process PostgreSQL-compatible runtime and execute the checked-in SQL migration.

`BusinessStateService` is the application-facing mutation boundary for Business
Profiles, Claims, Evidence, Claim/Evidence links, Metrics, and Business State
Snapshots. It delegates persistence and existing validation to
`FoundationRepository`; factual Claim admission remains exclusive to
`FactAdmissionService`.

## Domain model and database schema

Milestone 1 contains:

- business identity and a one-to-one flexible JSONB profile;
- typed claims, immutable-source evidence, many-to-many claim/evidence links;
- relational metrics with optional source evidence;
- immutable, monotonically versioned business-state snapshots;
- one workflow per business and append-only transition history.

Businesses use archive semantics. Foreign keys from strategic history use
`RESTRICT`, so deleting a Business cannot cascade through Evidence or Snapshots.
Composite foreign keys enforce same-Business ownership for Claim/Evidence links,
Metric source Evidence, and Claim supersession.

## Business lifecycle

Archive is reversible. It makes a Business read-only and removes it from active
work surfaces while preserving its identity, canonical Evidence State, snapshots,
extraction/review records, and workflow history. Restore reactivates that same
Business and history without regenerating strategic records.

Permanent Delete is irreversible and is available only after Archive. It removes
the complete Business-owned graph in one explicit transaction. The target is
always the immutable Business ID; the typed, server-derived confirmation phrase
is a human safety check and supports duplicate Business names. Ordinary root and
immutable-history deletion remains restricted outside this pathway. The narrow
trigger exception uses a transaction-local, Business-specific context and is an
accidental-deletion safeguard, not a security boundary against arbitrary SQL or
a compromised database credential. No Business-owned deletion receipt survives.

Flexible JSONB is limited to profile data, provenance/support metadata, transition
metadata, and snapshot payloads. Strategic entities and relationships remain
relational and queryable.

## Phase 1 state machine

All state changes pass through `StrategyOrchestrator`. Its explicit transition
map rejects invalid transitions and enforces human-only and system-only events.
AI actors cannot submit intake, continue despite gaps, or approve Phase 1.
Technical processing status is not represented as a strategic workflow state.
The PostgreSQL workflow writer is private to the Orchestrator factory and accepts
only opaque transition commands produced by the validated domain rule.

## Fact admission

Generic Claim persistence rejects direct creation or promotion to `fact`.
`FactAdmissionService` is the only application operation for factual status.
It requires server-derived human authority and one or more same-Business
supporting Evidence records, creates `supports` relationships, and records the
actor, operation, timestamp, and Evidence IDs in the Claim confidence basis.
Evidence quality is deliberately not used to automate truth in Milestone 1.

## Testing strategy

Unit tests cover Zod schemas and deterministic transition/authority rules.
Integration tests execute the real migration and cover repositories, provenance,
cross-business reference rejection, snapshot versioning/immutability, and
persisted workflow history. The Milestone 1 acceptance test exercises Business
creation through structured state and snapshot creation, then verifies valid and
invalid Orchestrator transitions and persisted transition history through the
application service path.

A separate real-PostgreSQL 17 target is available and requires a disposable test
database through `TEST_DATABASE_URL`. It is intentionally not substituted by
the embedded PGlite suite.

## Current milestone

Milestone 1 — Foundation.

## Explicit out of scope

No AI provider, evidence extraction, gap/contradiction analysis, diagnostic
engine, Phase 2/3 functionality, CRM, integrations, or generic chatbot exists.

## Architecture decisions

- The wider Phase 1 table list is deferred to the milestones that introduce those
  concepts; Milestone 1 creates only its explicitly named entities.
- `created_from_analysis_run_id` is nullable and intentionally has no foreign key
  until analysis runs are introduced.
- Snapshot immutability is enforced by a PostgreSQL trigger as well as by exposing
  no repository update/delete operation.
- Cross-business claim/evidence and metric/evidence references are rejected in
  repository transactions.
