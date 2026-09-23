# Baslon OS — Project History

## Purpose

This folder is the durable historical record of how Baslon OS evolved. It exists so the project can be understood from the repository alone, without relying on any assistant conversation history.

Three documents answer three different questions:

| Question | Document |
|---|---|
| Where are we now? | [`docs/current-status.md`](../current-status.md) |
| How did we get here? | [`timeline.md`](timeline.md) |
| Why were the important decisions made? | [`decision-log.md`](decision-log.md) |
| What were the stages, and what closed? | [`milestones.md`](milestones.md) |

## Documents

### [`timeline.md`](timeline.md)

The chronological story of the project, from the first commit on 13 September 2026 to the Phase 1 closure on 23 September 2026. Each entry states the problem, what was decided or built, the result, why it mattered, and where the authoritative records are.

### [`decision-log.md`](decision-log.md)

The decisions that materially shaped the product — about evidence and truth, numeric semantics, analysis, workflow, diagnosis presentation and operations — with the reason for each and its consequence. Decisions carry project-history IDs (`D-001`, `D-002`, …) that exist only in this folder.

### [`milestones.md`](milestones.md)

The milestone and stage map, with purpose, deliverables, closure state, key merges and the deferred items each stage left behind.

## Relationship to current status

```text
current-status.md   = the present state of the system and the live Baslon Digital Business
project-history/*   = the historical path that produced it, and the reasoning behind it
```

When the two appear to disagree, `current-status.md` is the authority on what is true now. This folder explains how that state came about and does not redefine it.

## Historical authority

These files are **summaries and navigation aids**. They are written to be read, not to be a second source of technical truth. The detailed record remains:

- the merged pull requests and commits in Git history;
- the architecture decisions and milestone documents in [`docs/`](..);
- the [findings register](../baslon-os-consolidated-code-review-findings-register.md);
- the migrations in `drizzle/`, the application code in `src/` and `app/`, and the tests in `tests/`;
- the persisted artifacts in the database itself.

Where this folder summarises something, it links to that record. If a detail matters, follow the link.

## Product and commercial context

The product's intended market, Design Partner approach and pricing assumptions are recorded separately in [`docs/product-commercial-context.md`](../product-commercial-context.md). That document is context rather than an engineering specification, and this history does not restate or extend it.
