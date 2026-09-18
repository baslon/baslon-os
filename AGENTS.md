# Baslon OS — Codex Operating Instructions

## 1. Purpose of this repository

This repository contains Baslon OS, a strategic decision-support system.

Baslon OS is intended to help a business owner understand what is happening in a business, make better strategic decisions, prioritise opportunities, and ultimately convert strategy into controlled execution.

The system must be designed around evidence, traceability, explicit business rules and human strategic judgement.

It must not become a generic chatbot, CRM, task manager or AI report generator.

---

## 2. Core operating principle

The governing principle is:

**AI proposes. Software validates and calculates. Humans make material strategic decisions.**

Maintain a clear distinction between:

1. evidence;
2. facts;
3. assumptions;
4. interpretation;
5. deterministic calculations;
6. AI-generated reasoning;
7. human-approved decisions.

Never silently convert assumptions, AI output or user assertions into verified facts.

---

## 3. Source of truth

Before implementing work, read the relevant repository documentation.

Repository documentation is organised as follows:

- `/briefs` — individual implementation briefs;
- `/docs` — product, architecture, data model and business-rule documentation;
- `AGENTS.md` — permanent repository-level instructions.

A numbered build brief defines what should be implemented for that build.

Do not extend the scope of a build merely because additional functionality appears useful.

---

## 4. Scope discipline

Implement only functionality explicitly required by the active build brief.

Do not implement speculative future functionality.

In particular:

- do not add features merely because they may be useful later;
- do not prematurely generalise architecture;
- do not add infrastructure without a current requirement;
- do not build Phase 2 or Phase 3 functionality while implementing a Phase 1 brief;
- do not turn Baslon OS into a generic SaaS platform unless explicitly required.

Design cleanly for future extension, but do not build future features in advance.

If a proposed implementation materially expands scope, stop and explain why before proceeding.

---

## 5. Architecture principles

Prefer simple, explicit architecture over clever abstraction.

Core strategic concepts should normally be represented as explicit domain entities rather than hidden inside large arbitrary JSON objects.

Important relationships must remain queryable and traceable.

Preserve provenance for strategic information.

It should always be possible to understand where an important conclusion originated.

Historical strategic analysis must not be silently overwritten.

Where the product requires point-in-time analysis, preserve sufficient state or references to make the analysis reproducible.

---

## 6. AI implementation rules

Use an LLM only for tasks that genuinely require language interpretation, synthesis or reasoning.

Do not use AI for deterministic operations that ordinary program logic can perform reliably.

Appropriate AI tasks may include:

- extracting proposed claims;
- identifying evidence gaps;
- identifying contradictions;
- analysing patterns;
- proposing root causes;
- generating strategic interpretations;
- producing structured diagnosis outputs.

Ordinary application code should handle:

- identifiers;
- relationships;
- validation;
- calculations;
- state transitions;
- persistence;
- permissions;
- versioning;
- deterministic business rules.

AI output must be validated before it becomes application data.

Prefer structured outputs validated using Zod.

Invalid AI responses must fail safely and must not be silently persisted as valid strategic information.

AI must never automatically approve its own strategic recommendation or diagnosis.

---

## 7. Human authority

Baslon OS is a decision-support system, not an autonomous business decision-maker.

Material strategic decisions require explicit human approval.

AI-generated analysis and recommendations must remain distinguishable from human-approved decisions.

Never overwrite an approved strategic decision merely because a later AI analysis disagrees with it.

---

## 8. Technology

Unless superseded by an approved architecture decision or build brief, the preferred application stack is:

- Next.js;
- TypeScript;
- PostgreSQL;
- Drizzle ORM;
- Zod;
- OpenAI API;
- server-side handling of secrets and privileged operations.

Use strong TypeScript typing.

Do not expose API keys, database credentials or secrets to client-side code.

Do not commit secrets to Git.

---

## 9. Database changes

Treat the domain model as strategically important.

Before making a substantial schema change:

1. understand the product concept being modelled;
2. inspect existing entities and relationships;
3. avoid unnecessary duplication;
4. consider historical/versioning requirements;
5. preserve traceability.

All schema changes must use migrations.

Do not manually alter production database structure outside the migration system.

---

## 10. Testing

Critical domain behaviour must have automated tests.

Tests are especially important for:

- validation;
- workflow state transitions;
- strategic record versioning;
- historical preservation;
- relationships between claims and evidence;
- AI structured-output validation;
- approval rules;
- deterministic calculations.

When completing implementation work, run the appropriate:

- automated tests;
- TypeScript checks;
- linting;
- build verification.

Do not declare work complete while known relevant tests are failing.

---

## 11. Working with build briefs

Before implementing a build brief:

1. read the entire brief;
2. inspect the current repository;
3. compare the requested behaviour with the existing architecture;
4. identify genuine conflicts or blockers;
5. propose the implementation approach;
6. implement only the authorised milestone.

If the brief specifies milestone-by-milestone implementation, stop at the end of the current milestone.

Do not automatically continue to the next milestone.

---

## 12. When requirements are unclear

Do not silently make material product decisions.

If ambiguity concerns a minor implementation detail, choose the simplest reasonable solution consistent with existing architecture.

If ambiguity affects:

- product behaviour;
- strategic meaning;
- data integrity;
- security;
- future architecture;
- irreversible implementation choices;

explain the issue and ask for a decision before proceeding.

---

## 13. Repository hygiene

Keep the repository understandable.

Prefer:

- clear file names;
- small focused modules;
- explicit types;
- meaningful domain terminology;
- concise comments explaining why rather than obvious code mechanics.

Avoid:

- giant files;
- hidden side effects;
- unnecessary dependencies;
- duplicated business rules;
- premature framework abstractions;
- speculative utility layers.

Do not perform unrelated refactoring during a scoped implementation task.

---

## 14. Git discipline

Keep changes focused on the active task.

Before completing work:

- inspect the diff;
- ensure no unrelated files were changed;
- ensure generated secrets or environment files are not being committed;
- report the files changed and the reason for each material change.

Do not rewrite Git history unless explicitly instructed.

---

## 15. Baslon Digital

Baslon Digital may be used as Business #001 for development and testing.

It must not receive hard-coded or special-case application behaviour.

It must use the same domain model and workflow that future businesses use.

---

## 16. Definition of good implementation

A good Baslon OS implementation is not the one with the most features or the most sophisticated technology.

It is the implementation that:

- accurately represents the strategic domain;
- preserves evidence and provenance;
- distinguishes facts from assumptions;
- exposes uncertainty rather than hiding it;
- keeps AI reasoning constrained and inspectable;
- preserves human authority;
- is straightforward to test;
- is straightforward to change;
- adds only the functionality currently required.

When simplicity and speculative sophistication conflict, prefer simplicity.

---

## 17. Real Business data safety

Never use Baslon Digital or another real Business for fictional smoke-test inputs.
Synthetic, scenario-only or fabricated data must be submitted only to a clearly
labelled test Business. Information may enter a real Business only when the user
has explicitly confirmed that it is genuine.

Real-model testing does not make synthetic data genuine. Any test that persists
Source Submissions, canonical records, snapshots or analyses must use a dedicated
synthetic Business unless the user has explicitly approved the information as
genuine for that real Business.

---

## 18. Claim–Evidence relationship strength

Claim ↔ Evidence relationship strength represents confidence that the selected
relationship type accurately describes the semantic link between those two
records. It must never be interpreted as the probability a Claim is true or as
Evidence reliability, corroboration, quality, materiality or diagnostic
importance.

Models and deterministic logic must not use relationship strength as proof weight
or as authority to promote a Claim's epistemic status.

---

## 19. Analysis and strategic-write safety

Module-specific analysis code must scope every `analysis_runs` lookup by module.
An abandoned `RUNNING` run must be terminally failed through a conditional,
same-Business recovery operation before retry creates a new run; never rewrite or
delete the historical run.

Strategic writes must lock and recheck the active Business row first inside their
transaction. Multi-record application commands such as Add Information must
commit their source, provenance links, workflow transition and initial run
atomically while keeping external AI calls outside the transaction.

Workflow state and actor legality are necessary but not sufficient for future
material transitions. Use the Orchestrator's event-specific precondition boundary
to require the relevant persisted artifact; do not invent placeholder artifacts
for a future milestone.
