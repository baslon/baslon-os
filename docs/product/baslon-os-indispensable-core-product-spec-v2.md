# Baslon OS — Indispensable Core Product Specification v2

## Product objective

Baslon OS should become the business owner's **weekly management cockpit**.

The indispensable-core test is:

> **If Baslon OS disappeared tomorrow, would the owner immediately feel that they had lost visibility and control over the business?**

The product should be understood as three connected layers:

```text
PHASE 1 — UNDERSTAND
Evidence → Diagnosis

PHASE 2 — DECIDE
Diagnosis → Strategic Direction → Growth Plan → 90-Day Plan

POST-PHASE-2 MANAGEMENT LOOP — MANAGE
Adopted Operating Strategy → Execution → Measurement → Weekly Review → Decisions → Reassessment
```

The product must help the owner answer, every week:

> **Where are we? What matters most? What needs my attention? What should happen next?**

---

# 1. Product layers

## Phase 1 — UNDERSTAND

Purpose:

> Establish a trusted analytical view of the business.

Phase 1 provides:

- Canonical Evidence;
- immutable analytical Snapshots;
- evidence quality and evidence gaps;
- deterministic calculations;
- approved Diagnosis;
- diagnosed constraints;
- provenance and audit.

Phase 1 answers:

> **What is happening in the business, what evidence supports that view, and where are the important constraints or uncertainties?**

Phase 1 does not decide strategy.

---

## Phase 2 — DECIDE

Purpose:

> Turn an approved Diagnosis into a deliberate, human-approved strategic course of action.

Phase 2 provides:

- controlled entry from an approved Diagnosis;
- strategic alternatives;
- human option review and comparison;
- human Strategic Decision;
- Approved Strategic Direction;
- Strategic Growth Plan;
- approved 90-Day Execution Plan;
- versioned strategic artifacts;
- successor strategy / plan handling;
- history, provenance and audit;
- coherent Final Output for one selected Phase 2 workspace.

Phase 2 answers:

> **Given what we understand about the business, what are we choosing to do?**

The closed Phase 2 architecture remains authoritative and unchanged.

Phase 2 does **not** define a Business-wide “current strategy”. Strategy remains scoped to a selected Phase 2 workspace / exploration.

---

## Post-Phase-2 Management Loop — MANAGE

Purpose:

> Turn an approved strategic plan into an ongoing management system.

This layer begins only after a human explicitly adopts a complete approved Phase 2 strategy for execution.

It provides:

- Adopted Operating Strategy;
- live execution tracking;
- KPI/outcome monitoring;
- weekly management review;
- attention and decision signals;
- management decision history;
- evidence-based reassessment.

It answers:

> **Are we executing the strategy, is it working, and what requires management attention now?**

---

# 2. Adopted Operating Strategy

The Management Loop must not infer a Business-wide current strategy from Phase 2.

Instead, introduce a separate explicit concept:

> **Adopted Operating Strategy**

An Adopted Operating Strategy is a human-authorised operating reference to one complete approved Phase 2 workspace / lineage.

Conceptually:

```text
Approved Phase 2 Workspace
        ↓
Human decision: ADOPT FOR EXECUTION
        ↓
Adopted Operating Strategy
        ↓
Weekly Management Loop
```

The adoption action should bind to the exact approved strategic lineage, including at minimum:

- Phase 2 workspace ID;
- approved Strategic Direction ID/version;
- approved Strategic Growth Plan ID/version;
- approved 90-Day Execution Plan ID/version;
- underlying approved Diagnosis ID/version;
- Snapshot ID/version/content hash;
- adoption timestamp;
- adopting human identity where available.

The adoption record should not mutate the approved Phase 2 artifacts.

It creates a new operating context around them.

A Business may have historical adopted strategies over time, but only one should normally be active for execution at once unless a future architecture explicitly allows otherwise.

---

# 3. Weekly owner experience

The owner opens Baslon OS and lands on a single **Weekly Management View**.

It should show only the information needed to manage the business this week.

## A. Adopted strategic position

Show:

- Adopted Operating Strategy;
- adopted Strategic Direction;
- current 90-Day objective;
- primary diagnosed constraint;
- 3–5 current strategic priorities;
- major assumptions the adopted plan depends on;
- date the strategy was adopted.

The purpose is orientation, not reporting.

The owner should understand the operating context in under 60 seconds.

## B. What changed

Show meaningful changes since the previous weekly review:

- KPI movement;
- new evidence;
- missed or completed milestones;
- material changes in sales, pipeline, delivery, cash, capacity or other active strategic measures;
- changed assumptions;
- newly surfaced risks or opportunities.

Do not surface noise.

Baslon OS should distinguish:

```text
Changed
Meaningfully Changed
Requires Attention
Requires Decision
```

## C. What is on track / off track

For each active 90-Day priority show:

- target outcome;
- owner;
- current status;
- expected progress;
- actual progress;
- next milestone;
- due date;
- blocker, if any.

The owner should be able to see immediately which priorities are progressing and which are drifting.

## D. Management attention

Baslon OS should identify a small set of items requiring management attention.

Target:

```text
0–3 Attention Items
```

Examples:

- an important KPI moved materially;
- a strategic priority has stalled;
- a dependency is unresolved;
- a critical assumption is no longer well supported;
- new evidence challenges the adopted strategy;
- execution activity is happening but the expected outcome is not appearing.

These are signals, not autonomous decisions.

## E. Decision required

If a material management decision is required, Baslon OS presents:

- decision to be made;
- why it has surfaced;
- evidence;
- relevant strategic context;
- viable alternatives where appropriate;
- likely implications;
- what happens if no decision is made.

AI may propose or structure options.

The human owner makes the material decision.

## F. This week's focus

End the weekly review with:

```text
The most important management focus this week
```

plus:

- up to three actions;
- responsible owner;
- expected result;
- review date.

This is the bridge between strategy and execution.

---

# 4. Weekly operating cadence

## Monday / start of management week

Baslon OS prepares the Weekly Management View from:

- active Adopted Operating Strategy;
- active 90-Day plan;
- latest execution status;
- latest KPI/evidence updates;
- unresolved prior-week decisions and blockers.

The owner reviews and confirms:

- priorities still valid;
- blockers;
- decisions required;
- this week's management focus.

## During the week

Users update only what materially changed:

- priority progress;
- KPI values;
- milestones;
- blockers;
- evidence;
- decisions.

Baslon OS must not require constant administrative maintenance.

## End of week

Baslon OS records:

- what was completed;
- what slipped;
- significant outcome changes;
- unresolved items;
- new evidence;
- decisions made.

This becomes input to the next Weekly Management View.

---

# 5. Reassessment trigger

Baslon OS must not rerun strategy merely because a number changes.

It should flag reassessment when evidence materially challenges the basis of the Adopted Operating Strategy.

Examples:

- the diagnosed primary constraint appears to have changed;
- a strategic assumption becomes unsupported;
- a priority repeatedly fails despite execution;
- a key market/customer signal changes materially;
- a major risk becomes real;
- performance diverges substantially from the expected strategic outcome.

The system should say, in effect:

> **The evidence supporting the Adopted Operating Strategy may have changed. Review recommended.**

It must not silently replace the adopted strategy.

Conceptually:

```text
Execution
   ↓
New Evidence / KPI Outcomes
   ↓
Material Change
   ↓
Reassessment Recommended
   ↓
Human Decision to Reassess
   ↓
New Snapshot / Diagnosis cycle
   ↓
New or Confirmed Phase 2 Strategy
   ↓
Explicit adoption for execution
```

The reassessment loop requires future architecture after Phase 2.

---

# 6. Minimum data required

The Indispensable Core does **not** require a full ERP, CRM or data warehouse.

It requires only the minimum data necessary to support the weekly management loop.

## Business context

- Business ID
- business name
- reporting period
- strategic objectives

## Adopted operating context

- Adopted Operating Strategy ID
- adoption date
- source Phase 2 workspace ID
- approved Diagnosis ID/version
- approved Strategic Direction ID/version
- approved Growth Plan ID/version
- approved 90-Day Execution Plan ID/version
- Snapshot ID/version/content hash

## Priority execution data

For each active priority:

- priority ID
- source 90-Day Plan action/initiative
- title
- owner
- target outcome
- start date
- due date
- status
- expected progress
- actual progress
- current milestone
- blocker
- latest update
- last updated date

## KPI / outcome data

Only KPIs linked to an active strategic objective or priority:

- KPI name
- current value
- previous value
- target
- period
- source
- direction of improvement
- materiality threshold

## Evidence updates

- evidence item
- source
- date
- related diagnosis/assumption/priority
- significance
- human validation status

## Management decisions

- decision required
- alternatives considered
- evidence/context
- decision made
- decision owner
- decision date
- rationale
- affected strategy/priority

## Weekly review record

- review date
- material changes
- attention items
- decisions required
- weekly focus
- agreed actions
- unresolved items
- human approval / confirmation

---

# 7. Product boundary

Baslon OS owns:

```text
Strategic truth
Management context
Priority alignment
Strategic monitoring
Management attention
Decision support
Reassessment
```

Specialist systems own operational transactions.

Examples:

```text
CRM             → individual opportunities
Accounting      → transactions and ledgers
Project system  → detailed task execution
HR              → employee records
Baslon OS       → what those signals mean for the adopted business strategy
```

The Indispensable Core should **not initially become**:

- a CRM;
- accounting software;
- a project-management suite;
- an HR system;
- a marketing automation platform;
- a task manager for every operational activity;
- an ERP;
- a replacement for specialist systems.

Those systems may later provide data to Baslon OS.

---

# 8. Human / AI boundary

The governing Baslon OS principle remains:

> **AI proposes. Software validates/calculates. Humans make material strategic decisions.**

## AI may

- summarise changes;
- identify anomalies;
- connect evidence to existing assumptions;
- propose attention items;
- propose strategic alternatives;
- draft recommended actions;
- explain why reassessment may be needed.

## Software must

- calculate deterministic metrics;
- enforce workflow and state rules;
- preserve lineage and provenance;
- validate required fields;
- prevent silent mutation of approved artifacts;
- preserve the distinction between approved strategy and mutable execution state.

## Humans must

- validate material evidence where required;
- adopt a Phase 2 strategy for execution;
- approve strategic changes;
- make material strategic decisions;
- approve revised strategy and plans;
- decide whether reassessment should proceed where material.

---

# 9. Minimum screens

The smallest useful product requires:

1. **Weekly Management View**
2. **Adopted Strategic Position**
3. **90-Day Priorities**
4. **Decision Review**
5. **Evidence / KPI Update**
6. **History & Reassessment**

Detailed specialist dashboards should not be added unless the pilot proves they are necessary.

---

# 10. Architecture ownership by product layer

## Already covered by Phase 1

- Evidence
- Canonical Evidence
- Snapshots
- evidence gaps
- deterministic calculations
- Diagnosis
- diagnosed constraints
- provenance / audit foundations

## Covered by closed Phase 2 architecture

- controlled entry from approved Diagnosis
- Phase 2 workspace and analytical binding
- strategic option generation
- option review and comparison
- human Strategic Decision
- Approved Strategic Direction
- Strategic Growth Plan
- approved 90-Day Execution Plan
- successor Direction / Growth Plan
- historical lineage
- Final Output
- Phase 2 provenance and audit

## Requires post-Phase-2 architecture

- Adopted Operating Strategy
- execution-state model
- live priority progress
- milestone tracking
- KPI time series / outcome monitoring
- materiality thresholds
- Weekly Management Review lifecycle
- management-attention signal model
- operational management decisions
- strategy adoption / replacement rules
- reassessment trigger rules
- re-entry from operating evidence into a new diagnosis cycle
- integration boundary for external operational systems

---

# 11. Indispensability success criteria

The core succeeds when, after sustained use, the owner can truthfully say:

- “I start the week here.”
- “This tells me what needs my attention.”
- “I can see when execution is drifting.”
- “Important decisions are not disappearing into meetings and notes.”
- “I can see why we made the decisions we made.”
- “I know when the evidence supporting our strategy has changed.”
- “I would feel less in control of the business without it.”

The strongest behavioural signal is:

> **The owner is uncomfortable making an important business decision without first checking Baslon OS.**

---

# 12. Smallest commercially meaningful loop

The smallest commercially meaningful Baslon OS is:

```text
PHASE 1 — UNDERSTAND

Trusted Evidence
      ↓
Approved Diagnosis

PHASE 2 — DECIDE

Approved Diagnosis
      ↓
Strategic Alternatives
      ↓
Human Strategic Decision
      ↓
Approved Strategic Direction
      ↓
Strategic Growth Plan
      ↓
Approved 90-Day Execution Plan

MANAGEMENT LOOP — MANAGE

Human adopts approved strategy for execution
      ↓
Adopted Operating Strategy
      ↓
Weekly Progress + KPI Updates
      ↓
Management Attention + Decisions
      ↓
Evidence-Based Reassessment
      ↺
```

If that loop becomes part of the owner's weekly operating rhythm, Baslon OS has moved from a strategy tool to a business management system.

Everything beyond this should earn its place by making that loop more useful, more reliable or easier to operate.
