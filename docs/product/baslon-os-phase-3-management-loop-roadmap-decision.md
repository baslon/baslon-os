# Baslon OS — Product Roadmap Decision: Phase 3 = Management Loop

## Decision

The post-Phase-2 Management Loop should become **formal Phase 3 of Baslon OS**.

Recommended phase model:

```text
Phase 1 — UNDERSTAND
Evidence → Snapshot → Diagnosis

Phase 2 — DECIDE
Diagnosis → Strategic Alternatives → Strategic Direction → Growth Plan → 90-Day Plan

Phase 3 — MANAGE
Adopted Operating Strategy → Execution → Measurement → Weekly Review → Decisions → Reassessment
```

This decision does **not** change the closed Phase 2 architecture.

---

## Why Phase 3 should be a separate formal phase

The Management Loop is not a small extension to Phase 2.

It introduces a distinct product purpose, lifecycle and domain model.

Phase 2 answers:

> **Given what we understand about the business, what are we choosing to do?**

Phase 3 answers:

> **Are we executing that strategy, is it working, and what requires management attention now?**

That difference is large enough to warrant a separate architecture gate.

Phase 3 introduces new persistent concepts not owned by Phase 2, including:

- Adopted Operating Strategy;
- mutable execution state linked to immutable approved plans;
- live priority progress;
- milestones and blockers;
- KPI/outcome time series;
- materiality thresholds;
- Weekly Management Reviews;
- management-attention signals;
- operational management decisions;
- reassessment recommendations;
- controlled re-entry into a new diagnosis cycle.

These are not simply additional Phase 2 screens. They change Baslon OS from a strategy-production system into an ongoing management system.

---

## Phase 3 product objective

> **Make Baslon OS the business owner's weekly management cockpit.**

The Phase 3 experience should answer four questions:

1. **Where are we?**
2. **What changed?**
3. **What needs my attention or decision?**
4. **What should happen next?**

The commercial test is:

> **If Baslon OS disappeared tomorrow, would the owner immediately feel they had lost visibility and control over the business?**

---

## Phase 3 entry boundary

Phase 3 begins only from a **complete approved Phase 2 strategic lineage**.

Conceptually:

```text
Approved Phase 2 Workspace
        ↓
Human decision: ADOPT FOR EXECUTION
        ↓
Adopted Operating Strategy
        ↓
Phase 3 Management Loop
```

Phase 3 must not infer a Business-wide strategy from Phase 2.

The adoption event is a new explicit human decision.

The adopted operating context should reference the exact approved Phase 2 lineage without mutating it.

At minimum the future architecture should bind:

- Phase 2 workspace ID;
- approved Strategic Direction ID/version;
- approved Strategic Growth Plan ID/version;
- approved 90-Day Execution Plan ID/version;
- underlying approved Diagnosis ID/version;
- Snapshot ID/version/content hash;
- adoption timestamp;
- adopting human identity where available.

---

## Phase 3 core capabilities

### 1. Adopted Operating Strategy

Establish which complete approved Phase 2 strategy the Business has explicitly chosen to execute.

Requirements to architect:

- adoption command / transition;
- eligibility rules;
- one-active-adoption rule or explicit alternative;
- historical adopted strategies;
- replacement/supersession;
- relationship with later Phase 2 workspaces;
- no mutation of approved Phase 2 artifacts.

### 2. Execution state

Separate immutable approved plan from mutable execution reality.

Track at minimum:

- priority/action;
- owner;
- target outcome;
- status;
- expected progress;
- actual progress;
- milestone;
- dependency;
- blocker;
- due date;
- latest update.

Execution state should reference the approved plan rather than modifying it.

### 3. KPI and outcome monitoring

Track only measures relevant to active strategy.

Minimum model:

```text
Strategic objective / priority
        ↓
KPI / measure
        ↓
Target
        ↓
Periodic actual
        ↓
Variance
        ↓
Materiality assessment
```

Initial Phase 3 should permit manual data entry.

External integrations are not required to prove the management loop.

### 4. Weekly Management Review

Create a persistent weekly operating record containing:

- meaningful changes;
- priority status;
- KPI movement;
- blockers;
- management-attention items;
- decisions required;
- weekly focus;
- agreed actions;
- unresolved items;
- human confirmation.

The Weekly Management View should be the default operational experience of Phase 3.

### 5. Management-attention signal model

Distinguish:

```text
Changed
Meaningfully Changed
Requires Attention
Requires Decision
```

The future architecture must define:

- deterministic calculations;
- thresholds/materiality rules;
- AI-supported interpretation;
- human review where required;
- how signals are created, resolved and retained.

The target should remain **0–3 high-value attention items**, not a stream of alerts.

### 6. Management decisions

Record decisions made during operation, including:

- issue / decision required;
- evidence and context;
- alternatives considered;
- human decision;
- rationale;
- owner;
- date;
- affected strategic priority / assumption.

This creates strategic memory beyond meeting notes.

### 7. Reassessment

Phase 3 should detect when operating evidence materially challenges the adopted strategy.

Conceptually:

```text
Execution / outcomes
        ↓
Material change
        ↓
Reassessment recommended
        ↓
Human decision to reassess
        ↓
New evidence / Snapshot / Diagnosis cycle
        ↓
Phase 2 strategic reconsideration
        ↓
New or confirmed strategy
        ↓
Explicit adoption
```

Phase 3 must not silently replace strategy.

---

## Phase 3 minimum user experience

The smallest Phase 3 should require no more than these six primary surfaces:

1. **Weekly Management View**
2. **Adopted Strategic Position**
3. **90-Day Priorities**
4. **Decision Review**
5. **Evidence / KPI Update**
6. **History & Reassessment**

Additional dashboards should not be added unless pilot evidence shows they are necessary.

---

## Phase 3 exclusions

Phase 3 should not initially become:

- CRM;
- ERP;
- accounting software;
- full project-management software;
- HR system;
- marketing automation platform;
- detailed task-management system;
- data warehouse.

These systems may later supply signals into Baslon OS.

Baslon OS should own the **management interpretation layer**, not every operational transaction.

---

## What Phase 3 may reuse from Phase 2

Phase 3 should build on, not duplicate:

- approved Diagnosis;
- diagnosed constraints;
- immutable Snapshot lineage;
- approved Strategic Direction;
- Strategic Growth Plan;
- approved 90-Day Execution Plan;
- provenance;
- audit;
- successor/historical strategy concepts;
- human approval discipline;
- AI structured-output discipline;
- the governing principle:

> **AI proposes. Software validates/calculates. Humans make material strategic decisions.**

---

## Phase 3 architecture questions that remain open

Before implementation, Phase 3 architecture must decide at minimum:

1. What exactly is an Adopted Operating Strategy?
2. Can more than one be active for a Business?
3. What happens when a newer Phase 2 strategy is approved but not yet adopted?
4. How are immutable plan actions linked to mutable execution records?
5. What defines expected vs actual progress?
6. How are KPI values stored and versioned over time?
7. Who defines materiality thresholds?
8. Which attention signals are deterministic vs AI-proposed?
9. What is the lifecycle of a Weekly Management Review?
10. How are management decisions linked to evidence, assumptions and priorities?
11. What threshold or rule causes reassessment to be recommended?
12. How does reassessment return to Phase 1 without corrupting historical strategy/execution context?
13. How is a replacement operating strategy adopted while preserving the old operating history?
14. Which external systems, if any, are required for the first pilot?

---

## Recommended roadmap sequence

The product roadmap should now be treated as:

```text
Phase 1 — UNDERSTAND
Status: built / approved baseline

Phase 2 — DECIDE
Status: architecture closed; implementation still required

Phase 3 — MANAGE
Status: product direction defined; architecture not started
```

Phase 3 architecture should **not** begin before the current Phase 2 implementation path is sufficiently stable to validate its real outputs and domain boundaries.

However, Phase 3 should now be treated as the intended destination of the product rather than an optional future feature set.

---

## Commercial significance

Phase 1 and Phase 2 can make Baslon OS valuable.

Phase 3 is the layer most likely to make Baslon OS **habitual and difficult to replace**.

Without Phase 3:

```text
Baslon OS helps the business understand and plan.
```

With Phase 3:

```text
Baslon OS becomes part of how the business is managed every week.
```

That is the point at which the product has the strongest chance of creating recurring operational dependence and therefore a stronger recurring SaaS proposition.

---

## Roadmap decision

> **APPROVED PRODUCT DIRECTION: The post-Phase-2 Management Loop should be treated as formal Phase 3 — MANAGE.**

This is a product-roadmap decision only.

It does not authorise Phase 3 architecture or implementation.

The closed Phase 2 architecture remains unchanged.
