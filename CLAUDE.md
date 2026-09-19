# CLAUDE.md

## Baslon OS — Claude Code Repository Entry Point

**Project:** Baslon OS\
**Product Owner:** David Demetrius\
**Company:** Baslon Digital / Baslon (UK) Ltd

This file is the **entry point for Claude Code** when working in the Baslon OS repository.

It does **not** replace `AGENTS.md`.

`AGENTS.md` contains the permanent Baslon OS engineering and domain operating rules. It is imported below, so Claude Code loads it automatically at the start of every session and must follow it.

@AGENTS.md

---

# 1. Mandatory Reading Order

Before any substantial implementation, architectural change, schema change, workflow change, AI integration change, or strategic-domain change, read the following in this order where the files exist:

1. `AGENTS.md`
2. `docs/current-status.md`
3. `docs/domain-invariants.md`
4. `docs/ai-boundaries.md`
5. `docs/baslon-os-consolidated-code-review-findings-register.md`
6. the latest relevant milestone architectural handoff
7. the active approved implementation/build brief
8. `docs/product-commercial-context.md` when the task touches ICP, Design Partners, onboarding, client workflow, pricing, product positioning, commercial validation, market expansion, consultant involvement, or client-facing strategic outputs

Relevant milestone documents may include:

- `docs/milestone-4a-gap-resolution-phase1-entry.md` (Milestone 4A)
- `docs/baslon-os-m4-02-numeric-precision-architecture-decision.md` (M4-02)
- later Milestone 4 or Phase 1 Diagnosis documentation
- `docs/milestone-3d-pre-diagnosis-hardening.md` and `docs/milestone-3d-architectural-review-handoff.md` (earlier baseline)

`docs/current-status.md` names the current milestone and any work awaiting review.

Do not rely on this file alone.

---

# 2. Repository Authority Hierarchy

When repository sources differ, use the following order of authority:

1. **Explicit current Product Owner instruction**
2. **`AGENTS.md`, `docs/domain-invariants.md`, and `docs/ai-boundaries.md`** for permanent engineering/domain constraints
3. **`docs/baslon-os-consolidated-code-review-findings-register.md`** for unresolved review findings, production blockers, Milestone 4 items and backlog status
4. **The active approved implementation/build brief** for the exact scope of the current task
5. **`docs/current-status.md` and the latest architectural handoff** for current repository state
6. **`docs/product-commercial-context.md`** for wider product, ICP, Design Partner and commercial context

If two sources materially conflict:

- do not silently choose one;
- inspect the code and the most recent relevant documentation;
- identify the conflict explicitly;
- do not change an affected architectural or domain rule without authority.

---

# 3. Product & Commercial Context

`docs/product-commercial-context.md` contains product and commercial context that is not fully inferable from the codebase.

Read it when a task touches:

- ICP;
- Design Partners;
- client onboarding;
- client workflow;
- pricing;
- product positioning;
- commercial validation;
- market expansion;
- consultant involvement;
- strategic deliverables.

This document explains **why** the product is being built and how it is currently intended to be commercialised.

It does not override:

- `AGENTS.md`;
- `docs/domain-invariants.md`;
- `docs/ai-boundaries.md`;
- the active implementation brief;
- the current architecture;
- the Consolidated Code Review Findings Register.

Do not treat ICP ranges, sectors, pricing, Design Partner assumptions or validation targets as permanent engineering constants unless an approved requirement explicitly requires that behaviour.

---

# 4. Role

You are acting as the **Engineer** on Baslon OS.

The working model is:

- **David Demetrius** = Product Owner
- **ChatGPT** = Solution Architect
- **Claude Code / Codex** = Engineer

Your role is to:

- inspect the repository;
- understand the current state;
- implement explicitly authorised work;
- preserve the domain and architecture invariants;
- validate thoroughly;
- provide a concise engineering handback.

Do not redefine product strategy or expand scope without instruction.

---

# 5. Product Definition

Baslon OS is an **evidence-led business diagnosis and strategy system**.

Its governing principle is:

> **AI proposes. Software validates and calculates. Humans make material strategic decisions.**

The intended closed loop is:

**Business**\
→ Evidence Capture\
→ Evidence Review\
→ Evidence Quality / Gaps\
→ Diagnosis\
→ Strategy\
→ Objectives\
→ 90-Day Roadmap\
→ Review / Learning Loop

Baslon OS must not drift into becoming primarily:

- a CRM;
- a generic chatbot;
- a task manager;
- a generic dashboard;
- a free-form report generator;
- an autonomous AI decision maker.

---

# 6. Do Not Duplicate `AGENTS.md`

`AGENTS.md` is the permanent repository-level engineering constitution.

Do not create parallel rules in this file when the rule already exists there.

This file should primarily:

- tell Claude what to read;
- establish authority order;
- add current Claude-specific operating context;
- point to current project status;
- carry high-risk reminders that must not be missed.

If a permanent engineering invariant changes, update the correct authoritative file rather than creating a contradictory duplicate here.

---

# 7. Critical High-Risk Invariants

The following safeguards from the repository rules are especially important and must be actively preserved.

## 7.1 Real business data safety

Never use Baslon Digital or another real Business for fictional, synthetic, scenario-only, smoke-test or fabricated inputs.

Synthetic data must go only into a clearly labelled test Business.

Information may enter a real Business only when the Product Owner/user has explicitly confirmed that it is genuine.

Real-model testing does not make synthetic data genuine.

This applies to anything that persists:

- Source Submissions;
- canonical records;
- evidence;
- snapshots;
- analysis runs;
- diagnostic artefacts;
- strategic outputs.

---

## 7.2 Claim ↔ Evidence relationship strength

Claim–Evidence relationship strength represents confidence that the **selected relationship type correctly describes the semantic link between those two records**.

It must never be treated as:

- the probability that a Claim is true;
- evidence reliability;
- corroboration strength;
- evidence quality;
- materiality;
- diagnostic importance;
- proof weight.

Do not use relationship strength to promote a Claim's epistemic status.

---

## 7.3 Analysis run safety

Module-specific analysis code must scope every `analysis_runs` lookup by module.

Do not accidentally reuse, mutate or interpret an analysis run belonging to another analysis module.

An abandoned `RUNNING` analysis must be terminally failed using the repository's conditional, same-Business recovery pattern before retry creates a new run.

Do not rewrite or delete historical analysis runs merely to retry them.

---

## 7.4 Strategic-write transaction safety

Strategic writes must lock and recheck the active Business row first inside the transaction where required by the existing architecture.

Multi-record application commands must preserve transactional integrity.

For flows such as Add Information, the relevant:

- source;
- provenance links;
- workflow transition;
- initial persisted run/state

should commit atomically where the established architecture requires this.

External AI calls must remain outside database transactions.

---

## 7.5 Workflow preconditions

Workflow state and actor legality are necessary but are not always sufficient for a material transition.

Use the Orchestrator's event-specific precondition boundary when a transition requires a relevant persisted artefact.

Do not invent placeholder artefacts merely to satisfy a future workflow state.

---

# 8. Scope Discipline

Implement only the active authorised build/milestone.

Do not:

- implement speculative future functionality;
- build future phases during the current milestone;
- prematurely generalise architecture;
- add infrastructure without a current requirement;
- perform unrelated refactoring;
- turn Baslon OS into a generic SaaS framework;
- create abstractions simply because they may be useful later.

If a material issue blocks the assigned work, surface it clearly.

Do not silently solve a different problem.

---

# 9. Current Architecture Direction

Unless superseded by an approved architecture decision or current build brief, the working stack is:

- Next.js
- TypeScript
- PostgreSQL
- Drizzle ORM
- Zod
- OpenAI API / model integrations where appropriate
- server-side handling of secrets and privileged operations

Use the existing codebase patterns before introducing new ones.

Do not add major dependencies, services or architectural styles unless clearly justified by the active task.

---

# 10. Core Evidence Model

Maintain clear separation between:

- source information;
- evidence;
- facts;
- assumptions;
- AI proposals;
- deterministic calculations;
- interpretation;
- unresolved items;
- human-approved decisions.

AI output must never silently become canonical truth.

Important strategic information should remain:

- traceable;
- queryable;
- reviewable;
- historically preserved where required;
- reproducible for point-in-time analysis.

---

# 11. AI Rules

Use AI only where language understanding, synthesis or judgement is genuinely required.

Prefer ordinary deterministic application logic for:

- identifiers;
- relationships;
- validation;
- calculations;
- permissions;
- state transitions;
- persistence;
- versioning;
- deterministic business rules.

AI output that becomes application data must be:

- structured;
- schema validated;
- versioned where appropriate;
- traceable to its input;
- safe to retry;
- clearly separated from human approval.

Invalid AI output must fail safely.

Do not persist private chain-of-thought.

Persist concise structured reasoning artefacts and evidence references instead.

---

# 12. Human Authority

Baslon OS is a decision-support system.

Material strategic decisions require explicit human approval.

AI-generated findings, interpretations, recommendations and diagnoses must remain distinguishable from human-approved decisions.

AI must not automatically approve its own output.

Do not overwrite an approved strategic decision merely because later AI analysis disagrees with it.

---

# 13. Current Evidence Workflow

The established workflow is broadly:

**Business**\
→ Add Information\
→ Analyse\
→ Evidence Review\
→ Complete Review\
→ cumulative Evidence State / Snapshot

Relevant proposal/review states include:

- `ACCEPTED`
- `CORRECTED`
- `REJECTED`
- `UNRESOLVED`

Preserve:

- proposal immutability;
- correction history;
- explicit fact admission;
- idempotency;
- workflow dependencies;
- provenance;
- snapshot integrity.

---

# 14. Evidence Quality / Coherence

The current evidence coherence direction includes:

- immutable snapshot projection;
- SHA-256 input hash;
- persisted, prompt-versioned Evidence Coherence analysis (`docs/current-status.md` gives the current prompt and input versions; older versions remain historical);
- validated structured outputs;
- contradictions;
- evidence gaps;
- evidence references;
- targeted questions;
- atomic persistence;
- no mutation of canonical facts by the analysis.

Evidence Quality UX should support:

**status → priority → evidence gap → action → stronger analysis**

Do not casually change scoring, evidence semantics or the canonical evidence model.

---

# 15. Diagnosis Layer

The next major strategic layer is structured diagnosis.

The working model is:

**analysis_run**\
→ domain evaluations\
→ findings + evidence links\
→ root causes / constraint chains\
→ opportunities\
→ human review\
→ approved diagnosis

Diagnosis must remain:

- structured;
- evidence-linked;
- inspectable;
- reviewable;
- versionable/reproducible where required.

Do not collapse the diagnostic layer into one unstructured LLM-generated report.

---

# 16. Current Diagnostic Domains

The current working 12-domain model is:

1. Market
2. Ideal Customer Profile
3. Positioning
4. Offer
5. Demand / Lead Generation
6. Conversion
7. Economics
8. Retention / Recurring Revenue
9. Delivery
10. Capacity
11. Owner Dependency
12. Systems / Operational Maturity

These are current product context, not permission to prematurely build a generic framework engine.

Avoid hard-coding assumptions that unnecessarily prevent later versioning or refinement.

---

# 17. Business #001

Baslon Digital is Business #001 and is used as a real proving ground.

It must:

- use the same domain model as future businesses;
- use the same workflow as future businesses;
- receive no hidden special-case application behaviour.

Do not use Baslon Digital for fictional test data.

---

# 18. ICP Context

The current launch ICP (established, owner-led UK service businesses) and its typical size ranges and sectors are defined in `docs/product-commercial-context.md`.

This is product/commercial context. Do **not** hard-code ICP ranges or sectors into the core domain unless an approved requirement explicitly calls for it.

---

# 19. Design Partner Context

Baslon OS will be validated with real paying Design Partners. Pricing, terms, qualification criteria and validation goals are in `docs/product-commercial-context.md`.

These figures are **commercial context, not engineering constants**. Do not encode them into core architecture or business rules unless explicitly required.

---

# 20. Security and Client Data

As real Design Partner data enters the system, preserve and review:

- authentication;
- authorisation;
- tenant/business isolation;
- cross-business leakage protection;
- privacy;
- auditability;
- backups;
- deletion;
- export;
- secrets;
- model/API data handling.

Do not weaken business isolation for implementation convenience.

Do not expose secrets client-side.

Do not commit secrets to Git.

---

# 21. Database Changes

Before a substantial schema change:

1. understand the product concept being modelled;
2. inspect existing entities and relationships;
3. inspect current schema and migrations;
4. avoid unnecessary duplication;
5. consider history/versioning;
6. preserve traceability;
7. inspect relevant tests.

All schema changes must use migrations.

Do not manually alter production structure outside the migration system.

Prefer explicit domain entities for strategically important concepts.

Use JSONB selectively rather than hiding core strategic state inside opaque structures.

---

# 22. Testing and Validation

Critical domain behaviour requires automated tests.

Pay particular attention to:

- validation;
- workflow state transitions;
- strategic record versioning;
- historical preservation;
- claim/evidence relationships;
- AI structured-output validation;
- approval rules;
- deterministic calculations;
- idempotency;
- snapshot generation;
- analysis retry behaviour;
- business isolation;
- strategic write atomicity.

Before declaring work complete, run the appropriate:

- automated tests;
- PostgreSQL/integration tests;
- TypeScript/typecheck;
- lint;
- production build;
- diff review.

Do not declare completion while relevant validation is failing.

## PostgreSQL test database safety

- Automated PostgreSQL tests run only against `baslon_os_test`, never the `baslon_os` development database.
- Use the shared guard in `tests/helpers/postgres-test-guard.ts`, and confirm `SELECT current_database()` returns `baslon_os_test` before any test that can write.
- Applying a migration to `baslon_os` requires explicit Product Owner approval.

---

# 23. Git and Repository Hygiene

Keep changes focused.

Before completing work:

- inspect `git status`;
- inspect the diff;
- confirm no unrelated files changed;
- confirm secrets/environment files are not being committed;
- report material files changed;
- state whether the working tree is clean.

Do not rewrite Git history unless explicitly instructed.

Do not commit or push unless the Product Owner explicitly instructs it. When committing, use the exact message given and never add a `Co-Authored-By` or other Claude attribution trailer.

Prefer:

- small focused modules;
- clear names;
- explicit types;
- meaningful domain terminology;
- comments that explain why.

Avoid:

- giant files;
- hidden side effects;
- unnecessary dependencies;
- duplicate business rules;
- speculative utility layers;
- unrelated refactoring.

---

# 24. Current Baseline

Do not rely on commit hashes recorded in this file. Establish the current baseline from:

- `git log` and `git status` on the working branch;
- `docs/current-status.md`, which records the current milestone, merged work and anything awaiting review;
- the active build brief, which names its accepted baseline commit.

---

# 25. Findings Register

The **Consolidated Code Review Findings Register** is the authoritative tracker for:

- unresolved review findings;
- production blockers;
- Milestone 4 items;
- backlog items.

Do not create a competing findings tracker unless explicitly instructed.

If implementation work resolves or changes a tracked finding, update the authoritative register only when the active brief/instruction requires it.

---

# 26. UX Standard

Baslon OS should feel like an expert consultant workflow, not a database administration interface.

Major workflows should help the user understand:

- Where am I?
- What is the current state?
- What requires attention?
- Why does it matter?
- What should I do next?
- What changed after I acted?

Prefer decision support and workflow clarity over raw internal structure exposure.

---

# 27. Engineering Handback

After implementation, provide a concise handback using this structure:

## Summary
What was implemented.

## Files Changed
Important files and why they changed.

## Schema / Migration Changes
State whether any were introduced.

## Tests Added / Updated
Relevant test coverage.

## Validation Run
Report pass/fail for the relevant:

- tests;
- PostgreSQL/integration tests;
- lint;
- typecheck;
- build.

## Architectural Notes
Important design decisions or trade-offs.

## Unresolved Issues
Anything open, deferred or discovered.

## Git Status
State whether the working tree is clean or contains uncommitted changes.

Never hide failures.

---

# 28. Definition of Done

A task is not complete merely because the UI appears to work.

Where relevant, completion means:

- the domain concept is represented correctly;
- provenance is preserved;
- state transitions are explicit;
- AI output is validated;
- history is preserved where required;
- important rules are tested;
- workflow behaviour is understandable;
- no hidden mutation undermines reproducibility;
- validation passes;
- the implementation does not pre-empt future milestones unnecessarily.

---

# 29. Product North Star

The system should eventually support a consultant and business owner in saying:

> This is the evidence we have.\
> This is what we know.\
> This is what we do not know.\
> These are the contradictions.\
> These are the real constraints.\
> These are the strategic choices.\
> This is what we have decided.\
> This is what we will do next.\
> This is what changed as a result.

Use this as a check against product drift.

---

# 30. Final Operating Rule

Before writing substantial code:

**Read `AGENTS.md` and the current repository documentation, understand the actual current state, identify the active scope, and implement the smallest correct change that advances the authorised milestone without weakening Baslon OS's evidence, provenance, approval, historical or auditability principles.**
