# Baslon OS — Codex Build Brief v1.0

## 1. Project Objective

Build the first working vertical slice of **Baslon OS**, a strategic decision-support system for established service businesses.

The core intelligence component is the **Baslon Strategy Engine**.

The Strategy Engine must take imperfect business information and progressively turn it into:

1. structured evidence;
2. strategically relevant gaps and contradictions;
3. a Phase 1 Strategic Diagnosis;
4. an auditable human-approved diagnosis.

Baslon OS is **not** a generic AI business adviser, chatbot, CRM, task-management tool or report generator.

The defining principle is:

> **AI proposes. Software validates and calculates. Humans make material strategic decisions.**

The initial MVP implements **Phase 1 only**.

Do not implement Phase 2 or Phase 3 functionality until Phase 1 has been tested and approved.

---

# 2. The Baslon Methodology

The complete future methodology has three phases:

### Phase 1 — Strategic Diagnosis

Question:

> What is really happening in this business, and what is most likely holding back growth?

Outputs include:

- current business situation;
- diagnostic findings;
- material contradictions;
- evidence gaps;
- root causes;
- strategic opportunities;
- critical unknowns;
- confidence levels.

### Phase 2 — Strategy & Business Model Design

Future scope only.

Question:

> Given the diagnosis, what should the business choose to do and deliberately not do?

### Phase 3 — Growth & Implementation Plan

Future scope only.

Question:

> What should the business do next, in what order, how should it be measured, and what decisions follow?

Only Phase 1 belongs in the current MVP.

---

# 3. First Vertical Slice

The first working product must support this complete flow:
```text
Create Business
↓
Enter Minimum Business Intake
↓
Convert Intake into Claims / Evidence / Metrics
↓
Create Business State Snapshot
↓
Detect Material Contradictions
↓
Identify High-Value Evidence Gaps
↓
Ask Adaptive Follow-Up Questions
↓
Accept Answers or "I Don't Know"
↓
Regenerate Evidence State
↓
Generate Structured Phase 1 Evaluations
↓
Identify Root Causes
↓
Identify Strategic Opportunities
↓
Produce Phase 1 Strategic Diagnosis
↓
Human Review
↓
Approve / Revise / Add Evidence
↓
Approved Phase 1 Diagnosis
```

This is the MVP.

Anything not necessary for this flow should normally be excluded.

---

# 4. Non-Negotiable Product Principles

## 4.1 Structured state before prose

The Strategy Engine must produce structured objects first.

Reports and narrative are rendered from structured state.

Do not store a long generated strategy report as the primary business truth.

---

## 4.2 Claims are not automatically facts

Every strategically relevant statement must retain its epistemic status.

Supported types:
```text
fact
observation
management_belief
hypothesis
ai_inference
unknown
decision
```

Example:

> "The business receives most clients through referrals."

may initially be:
```text
management_belief
```

If CRM evidence later verifies it, confidence may increase and the statement may be represented as a supported fact.

The AI must never silently convert owner opinion into established fact.

---

## 4.3 Evidence must retain provenance

Evidence must record:

- what it says;
- where it came from;
- reliability;
- directness;
- relevant period where applicable;
- which claims it supports or contradicts.

---

## 4.4 Unknown is valid

The system must support:

> "I don't know."

Do not force completion by guessing missing values.

An explicit unknown is useful strategic information.

---

## 4.5 Recommendations must be auditable

Every significant finding must be traceable to supporting evidence.

The system should be able to answer:

> Why does Baslon OS believe this?

using concise rationale and evidence references.

Do not expose or depend upon hidden AI chain-of-thought.

---

## 4.6 AI cannot approve strategy

AI may:

- classify;
- extract;
- infer;
- propose;
- diagnose;
- recommend.

AI may not:

- approve Phase 1;
- silently change business state;
- mark a hypothesis proven;
- alter strategic decisions autonomously.

---

## 4.7 Do not over-question the user

The Gap Engine must prioritise missing information according to:

> **How materially could this answer change the diagnosis?**

Do not generate exhaustive consulting questionnaires.

---

## 4.8 Preserve history

Do not overwrite approved strategic history.

Use:

- versions;
- snapshots;
- superseded records;
- audit history.

---

# 5. Initial Technical Stack

Use:

### Application

Next.js + TypeScript

### Database

PostgreSQL

### Database access

Drizzle ORM

Prefer explicit, understandable SQL/database behaviour over hiding the schema behind heavy abstraction.

### Validation

Zod

### AI integration

Create a provider abstraction suitable for calling OpenAI models with strict structured outputs.

Do not tightly couple application business logic to one specific model name.

### Testing

Use appropriate TypeScript unit and integration testing.

Tests are mandatory for:

- workflow transitions;
- deterministic business rules;
- schema validation;
- evidence references;
- materiality rules;
- state versioning.

---

# 6. Architecture

Use this separation:
```text
UI
↓
Application Services
↓
Strategy Orchestrator
↓
Deterministic Rules / AI Modules
↓
Schema Validation
↓
Repositories
↓
PostgreSQL
```

Do not use:
```text
UI
↓
AI
↓
Database
```

AI must never write directly to the database.

Correct flow:
```text
AI response
↓
Schema validation
↓
Business-rule validation
↓
Application service
↓
Database transaction
```

---

# 7. Core Database Objects for Phase 1

Implement only objects required for the Phase 1 vertical slice.

Required tables:
```text
businesses
business_profiles

claims
evidence
claim_evidence

metrics

business_state_snapshots

analysis_runs

contradictions
evidence_gaps

phase1_diagnoses
phase1_evaluations
phase1_evaluation_evidence

root_causes
root_cause_evaluations

opportunities
opportunity_root_causes

reviews

strategy_workflows
workflow_transitions
```

Do not implement Phase 2/3 tables yet.

---

# 8. Business Table

The `businesses` table represents business identity, not the complete strategy model.

Suggested fields:
```text
id UUID
name
legal_name
website_url
sector
status
primary_geography
created_at
updated_at
archived_at
```

Do not add dozens of speculative business attributes.

---

# 9. Business Profile

Use JSONB initially for evolving intake information.

Example:
```json
{
  "services": [],
  "markets_served": [],
  "team_size": null,
  "growth_goal": null,
  "founder_hours_target": null,
  "current_acquisition_channels": []
}
```

This structure may evolve as the methodology is tested.

Do not prematurely normalise every intake field.

---

# 10. Claims

Claims require relational structure.

Minimum fields:
```text
id
business_id
statement
claim_type
subject_area
status
confidence_level
confidence_score
confidence_basis JSONB
source_type
created_at
updated_at
superseded_by_claim_id
```

Allowed claim types:
```text
fact
observation
management_belief
hypothesis
ai_inference
unknown
decision
```

---

# 11. Evidence

Minimum structure:
```text
id
business_id
evidence_type
statement

value_numeric
value_text
unit

period_start
period_end

source_type
source_reference
source_metadata JSONB

reliability_level
reliability_score
directness_level
recency_level

raw_payload JSONB

materiality

created_at
```

Evidence should normally be treated as immutable historical input.

Corrections should preserve prior state where strategically relevant.

---

# 12. Claim/Evidence Relationships

Claims and evidence are many-to-many.

Relationship types:
```text
supports
contradicts
context
```

Every relationship may optionally contain a strength score.

---

# 13. Metrics

Metrics must not be buried only in prose.

Examples:
```text
annual_revenue
monthly_recurring_revenue
average_project_value
serious_opportunities
discovery_calls
new_clients
founder_hours_target
```

Minimum fields:
```text
id
business_id
metric_key
metric_label
numeric_value
unit
period_start
period_end
dimension_data JSONB
source_evidence_id
created_at
```

Calculations involving metrics should be deterministic application code, not AI arithmetic.

---

# 14. Business State Snapshots

Snapshots are immutable compilations of what the system knew at a particular time.

Required fields:
```text
id
business_id
version
snapshot_data JSONB
created_from_analysis_run_id
created_at
```

Every Phase 1 diagnosis must reference the exact snapshot it analysed.

---

# 15. Analysis Runs

Every material AI analysis must be recorded.

Suggested fields:
```text
id
business_id
module
run_type
prompt_version
model_identifier
input_snapshot_id
input_hash
status
structured_output JSONB
validation_errors JSONB
started_at
completed_at
created_at
```

This is essential for debugging and reproducibility.

---

# 16. Contradictions

Contradictions must become first-class objects.

Example:
```text
Claim:
Target core project price = £7,500+

Evidence:
Historical average meaningful project ≈ £3,200

Contradiction:
Desired price materially exceeds historically validated pricing.
```

Minimum fields:
```text
id
business_id
area
severity
primary_claim_id
conflicting_claim_id
conflicting_evidence_id
explanation
status
resolution_note
created_by_run_id
created_at
resolved_at
```

---

# 17. Evidence Gaps

Evidence gaps represent strategically important missing information.

Required concepts:
```text
area
missing_information
decision_impact
priority_score
recommended_question
blocking
status
resolution_evidence_id
```

Do not ask the user every missing question.

Prioritise gaps by decision impact.

---

# 18. Phase 1 Diagnostic Areas

The MVP should support these diagnostic evaluators:
```text
market
icp
problem
offer
acquisition
conversion
proof
economics
capacity
founder_fit
```

Each evaluator returns:
```text
area
status
finding
severity
confidence
supporting evidence
contradicting evidence
concise rationale
implications
```

---

# 19. Root Causes

Phase 1 must distinguish:

> symptom

from:

> probable root cause.

Root causes must reference one or more diagnostic evaluations.

Example:
```text
Finding:
Pipeline is inconsistent.

Root Cause:
No repeatable mechanism exists for generating suitable opportunities.
```

Do not allow unsupported root causes.

---

# 20. Opportunities

Phase 1 may identify strategic opportunities.

An opportunity is not yet an implementation task.

Example:

> Develop a predictable source of higher-value opportunities.

Store:
```text
statement
linked_root_causes
potential_impact
confidence
estimated_effort
time_to_value
rank
```

---

# 21. Strategy Orchestrator

The Phase 1 workflow must be implemented as a deterministic state machine.

Required strategic states:
```text
NEW

INTAKE_IN_PROGRESS

INTAKE_READY

EVIDENCE_PROCESSING

EVIDENCE_READY

GAP_ANALYSIS

GAP_RESOLUTION_REQUIRED

PHASE1_READY

PHASE1_ANALYSING

PHASE1_AWAITING_REVIEW

REVISION_REQUIRED

PHASE1_APPROVED
```

State changes must go through a central transition service.

Do not directly assign workflow state from arbitrary application code.

---

# 22. Workflow Authority Rules

### Human events include:
```text
START_INTAKE
SUBMIT_INTAKE
ADD_EVIDENCE
MARK_UNKNOWN
CONTINUE_WITH_GAPS
GENERATE_PHASE1
APPROVE_PHASE1
REQUEST_REVISION
REJECT_PHASE1
```

### System events may include:
```text
PROCESS_EVIDENCE
RUN_GAP_ANALYSIS
MARK_ANALYSIS_COMPLETE
```

### AI modules may not trigger:
```text
SUBMIT_INTAKE
CONTINUE_WITH_GAPS
APPROVE_PHASE1
```

An AI actor can submit analysis output but cannot change strategic authority state.

---

# 23. Processing State Is Separate

Do not model technical failures as strategic workflow states.

Analysis jobs use:
```text
QUEUED
RUNNING
SUCCEEDED
FAILED_RETRYABLE
FAILED_PERMANENT
CANCELLED
```

Example:
```text
workflow_state = PHASE1_ANALYSING
processing_status = FAILED
```

rather than creating a workflow state called:
```text
OPENAI_FAILED
```

---

# 24. Versioning and Staleness

If a Phase 1 diagnosis analyses:
```text
Business State Snapshot v4
```

and new material evidence produces:
```text
Business State Snapshot v5
```

the existing diagnosis should become:
```text
stale
```

or:
```text
materially_stale
```

depending on evidence materiality.

High-materiality new evidence should block approval until regeneration.

---

# 25. Phase 1 Human Review

The user must be able to:

### Approve

The diagnosis adequately represents the business.

### Request Revision

Interpretation is wrong but new evidence is not necessarily required.

### Add Evidence

Important information is missing.

### Reject Diagnosis

Reasoning is materially wrong.

Approved diagnoses become immutable historical versions.

Do not overwrite them.

---

# 26. Initial UI Scope

Build only enough UI to exercise the Strategy Engine.

Required screens:

## 1. Businesses

Create and select a business.

## 2. Business Intake

Capture minimum strategic information.

## 3. Evidence State

Show:

- Claims;
- Evidence;
- Metrics;
- Fact vs Belief vs Hypothesis vs Unknown.

## 4. Strategic Questions

Show only high-value gaps requiring resolution.

Support:

> I don't know.

## 5. Phase 1 Diagnosis

Show:

- executive diagnosis;
- evaluator findings;
- root causes;
- opportunities;
- confidence;
- remaining unknowns;
- evidence trace.

## 6. Review

Support:

- Approve;
- Revise;
- Add Evidence;
- Reject.

Do not invest heavily in visual design during the first vertical slice.

Correctness and inspectability matter more than polish.

---

# 27. Explicitly Out of Scope

Do NOT build any of the following in the Phase 1 MVP:
```text
Phase 2 Strategy Option Generator
Phase 2 Strategy Evaluator
Phase 2 Decision Engine

Phase 3 Planning Engine
Experiment tracking
Growth execution dashboards

CRM
Lead database
LinkedIn outreach
Email automation

Accounting integrations
Google Analytics integrations
Search Console integrations

Automated website crawling
Automated competitor analysis
Autonomous web research

Agent swarms
Multi-agent debates

Billing
Subscriptions
Stripe

Complex user permissions
Enterprise multi-tenancy

Mobile apps

Background strategy monitoring

Notifications

Complex dashboards

General AI chatbot

Vector database unless a concrete Phase 1 need is proven
```

Do not create placeholders for all of these merely because they may exist later.

---

# 28. Baslon Business #001 Test Fixture

Create a reusable fixture representing Baslon Digital.

It should include enough structured data to reproduce a realistic Phase 1 test.

Relevant known inputs include approximately:
```text
Annual revenue:
~£80k

Current recurring monthly revenue:
~£1.8k

Recent meaningful project values:
typically approximately £1k–£6k

Recent average meaningful project:
approximately £3.2k

Desired future core engagement:
£7.5k+

Serious opportunities:
approximately 12

Discovery calls:
approximately 6

New projects:
approximately 3

Founder target:
approximately 30 hours/week

Business objective:
fewer, larger, more strategic clients with stronger recurring revenue

Acquisition historically:
referrals
returning clients
Baslon website
Wix Marketplace

Evidence:
demonstrated enquiry-generation results for service businesses

Current issue:
no sufficiently predictable source of higher-value opportunities
```

The fixture should deliberately include both:

- facts/evidence;
- management aspirations/hypotheses.

Example:
```text
"£7.5k should become the core minimum engagement"
```

must NOT enter the system as established fact.

---

# 29. Baslon #001 Expected Diagnostic Direction

Do not hard-code this conclusion.

It is an acceptance benchmark only.

Given the supplied evidence, a competent Phase 1 Strategy Engine should arrive at reasoning broadly consistent with:

> Baslon appears capable of producing measurable commercial value and converting suitable opportunities at a reasonable rate, but lacks a predictable flow of higher-value opportunities. The desired £7.5k+ transformation model remains commercially unvalidated and requires changes in customer economics, offer/value architecture and acquisition. Founder-dependent delivery and the weak integration of recurring growth are secondary structural constraints.

Exact wording is irrelevant.

The reasoning quality matters.

---

# 30. Acceptance Criteria for Phase 1 MVP

The vertical slice is successful when it can:

1. create a Business;
2. accept minimum intake;
3. persist business state correctly;
4. classify input into Claims, Evidence and Metrics;
5. distinguish facts from beliefs and hypotheses;
6. preserve source/provenance;
7. identify obvious contradictions;
8. identify strategically material evidence gaps;
9. avoid asking low-value questions unnecessarily;
10. accept "I don't know";
11. create immutable business-state snapshots;
12. generate structured diagnostic evaluations;
13. reference valid supporting evidence;
14. synthesise plausible root causes;
15. distinguish root causes from symptoms;
16. identify strategic opportunities without prematurely prescribing tactics;
17. generate an executive Phase 1 diagnosis;
18. assign confidence appropriately;
19. allow human review and revision;
20. version diagnoses rather than overwrite;
21. require explicit human approval;
22. preserve audit history;
23. detect stale diagnoses when material evidence changes;
24. prevent AI output from directly becoming approved strategic state.

---

# 31. Testing Requirements

Do not treat tests as optional.

At minimum implement tests covering:

### Workflow

- invalid transitions rejected;
- approval requires human action;
- AI actor cannot approve;
- gap loop works;
- revision loop works.

### Evidence

- claim/evidence relationship validity;
- cross-business evidence references rejected;
- unknown values preserved;
- hypotheses not converted into facts without evidence.

### Snapshots

- immutable;
- diagnosis linked to correct snapshot;
- material new evidence marks diagnosis stale.

### AI outputs

- schema validated;
- invalid categories rejected;
- invalid evidence IDs rejected;
- malformed response cannot update strategy state.

### Versioning

- approved diagnosis cannot be overwritten;
- new diagnosis increments version;
- previous versions remain available.

---

# 32. Error Handling

AI/provider failures must not corrupt workflow state.

Use bounded retry policies.

Example:
```text
attempt 1
attempt 2
attempt 3
failure surfaced
```

Do not retry indefinitely.

Malformed AI output should receive at most a controlled repair/retry sequence.

If still invalid:

> fail the analysis run.

Do not save approximate or partially malformed strategic state merely to keep the workflow moving.

---

# 33. Coding Principles

Prefer:

- explicit code;
- small modules;
- clear naming;
- strong types;
- strict schemas;
- domain tests;
- predictable state transitions.

Avoid:

- giant services;
- giant prompts;
- clever abstractions without demonstrated need;
- premature generic frameworks;
- speculative infrastructure;
- hidden state;
- untyped AI outputs.

The system should be straightforward enough that another experienced developer can understand why a strategic result was produced.

---

# 34. Prompt Versioning

Every AI module must have an explicit prompt version.

For example:
```text
evidence_extractor_v1
gap_analyser_v1
acquisition_evaluator_v1
diagnostic_synthesis_v1
```

Do not embed large unversioned prompts randomly inside UI components or route handlers.

Prompts belong in an explicit module layer.

---

# 35. AI Module Boundary

Each AI module should have:
```text
Input schema
Output schema
Prompt version
Model configuration
Validation
Business-rule checks
Tests/fixtures
```

Never implement:
```text
const answer = await ai("analyse this business");
```

and pass the result directly onwards.

---

# 36. First Coding Milestone

Do NOT attempt the complete Phase 1 engine in the first coding task.

The first milestone is:

## Milestone 1 — Foundation

Build:
```text
application scaffold

PostgreSQL setup

Drizzle schema

migrations

core repositories

Business creation

Business Profile

Claims

Evidence

Metrics

Business State Snapshots

Strategy Workflow

Workflow Transition History

Orchestrator transition service

Zod schemas

unit/integration tests
```

Do not implement sophisticated AI reasoning yet.

At the end of Milestone 1 we should be able to:

1. create Baslon Business #001;
2. add structured claims/evidence/metrics manually;
3. create a state snapshot;
4. advance through valid early workflow states;
5. reject invalid transitions;
6. inspect persisted data;
7. run the test suite successfully.

Stop at that milestone for review.

---

# 37. Second Coding Milestone

Only after Milestone 1 is reviewed:

## Milestone 2 — Evidence Engine

Implement:
```text
messy intake input
↓
AI structured extraction
↓
Claim / Evidence / Metric proposals
↓
validation
↓
human-visible evidence state
```

Test primarily against Baslon Business #001.

Do not implement Gap Analysis until the Evidence Engine is demonstrably reliable.

---

# 38. Third Coding Milestone

## Milestone 3 — Contradiction & Gap Engine

Implement:
```text
evidence state
↓
contradiction detection
↓
materiality assessment
↓
high-value missing-information questions
↓
gap-resolution loop
```

Test whether the system asks useful questions rather than simply more questions.

---

# 39. Fourth Coding Milestone

## Milestone 4 — Phase 1 Diagnostic Engine

Implement the diagnostic evaluators followed by root-cause synthesis.

Do not combine all diagnostic reasoning into one giant prompt.

---

# 40. Fifth Coding Milestone

## Milestone 5 — Phase 1 Human Review

Implement:
```text
diagnosis rendering
evidence trace
approve
revise
add evidence
reject
versioning
staleness
audit trail
```

At that point the first Baslon Strategy Engine vertical slice is complete.

---

# 41. Stop Conditions

Codex must stop and flag the issue rather than silently redesign the architecture if:

- a requirement conflicts with the state-machine rules;
- a requested change allows AI to approve strategic state;
- the schema cannot preserve evidence provenance;
- implementing a feature requires Phase 2 assumptions;
- a new dependency materially changes the architecture;
- a supposedly simple feature requires significant scope expansion;
- the current specification is genuinely contradictory.

Do not solve architectural uncertainty by quietly inventing product behaviour.

---

# 42. Repository Documentation

Keep concise project documentation within the repository covering:
```text
Product Purpose
Architecture
Domain Model
Phase 1 State Machine
Database Schema
AI Module Contracts
Testing Strategy
Current Milestone
Explicit Out-of-Scope
Architecture Decisions
```

Update documentation when architectural decisions materially change.

Do not create documentation merely for volume.

---

# 43. Initial Codex Instruction

Begin with **Milestone 1 only**.

Before writing feature code:

1. inspect the repository;
2. propose the minimal folder structure;
3. identify required dependencies;
4. identify any ambiguity or conflict in this specification;
5. do not broaden the scope.

Then implement Milestone 1.

At completion provide:
```text
Files created/changed

Database schema implemented

Migrations created

Tests added

Tests passing/failing

Any architectural decisions made

Any deviations from this specification

Known issues

Recommended next engineering task
```

Do not begin Milestone 2 without explicit instruction.

---

# 44. Governing Principle

The Baslon Strategy Engine should not attempt to appear intelligent by producing large volumes of persuasive prose.

Its value comes from disciplined reasoning:

> **What do we know?**

> **How do we know it?**

> **What is merely believed?**

> **What is missing?**

> **What contradicts what?**

> **What is probably causing the observed situation?**

> **How confident should we be?**

> **What requires a human decision?**

If the software can answer those questions reliably, Phase 1 has succeeded.
