# Baslon OS — M4-05 / M4-06 / M4-07 Phase 1 Diagnosis Contract Architecture Decision

**Status:** Approved for implementation  
**Milestone:** 4  
**Findings:** M4-05, M4-06, M4-07  
**Decision owner:** Solution Architect / Product Owner  
**Date:** 21 September 2026  
**Controlled rebuild:** Baslon Digital v2  
**Business:** `a658df7e-a161-4487-a6c7-3b9f8b01b1fd`  
**Current workflow:** `PHASE1_READY`  
**Current Snapshot:** Snapshot 4 — `da6e9a8e-1ae0-4436-ab67-429a7d33197b`  
**Snapshot fingerprint:** `bd0e75c5c0c8662dba0edb60b35d5e3b`  
**Canonical counts:** 39 Claims / 59 Evidence / 18 Metrics / 54 relationships  
**Execution hold:** **No Phase 1 Diagnosis run is permitted until this contract is implemented, tested, reviewed and merged. After merge, diagnosis still requires separate Product Owner approval.**

---

## 1. Decision Summary

Phase 1 Diagnosis is a **snapshot-bound analytical process**, not a canonical truth-writing process.

The diagnosis engine may:

- interpret the exact immutable evidence snapshot;
- identify patterns, constraints, risks, strengths and opportunities;
- propose evidence-grounded diagnostic observations;
- express uncertainty and limitations;
- carry forward known evidence gaps;
- produce a structured analytical artifact for human review.

The diagnosis engine may **not**:

- mutate canonical Claims, Evidence, Metrics or relationships;
- invent missing facts;
- silently fill evidence gaps;
- turn evidence qualifiers into truth probabilities;
- upgrade approximate or uncertain inputs into exact conclusions;
- use live canonical state in place of the selected snapshot;
- approve its own diagnosis;
- advance strategic workflow state without explicit human approval.

The governing rule is:

> **AI analyses the evidence snapshot. Software enforces the contract. Humans approve material strategic interpretation.**

---

## 2. Baslon OS Responsibility Boundary

The existing architecture remains:

```text
UI
→ Application Services
→ Strategy Orchestrator
→ deterministic rules / AI
→ validation
→ repositories
→ PostgreSQL
```

For Phase 1 Diagnosis:

```text
Immutable Snapshot
    ↓
Deterministic Diagnosis Projection
    ↓
Deterministic Calculations
    ↓
AI Diagnosis Proposal
    ↓
Deterministic Contract Validation
    ↓
Analytical Diagnosis Record
    ↓
Human Review
    ↓
Explicit Human Approval
    ↓
Next Strategic Workflow State
```

No diagnosis step may bypass the human checkpoint.

---

## 3. M4-05 — Phase 1 Diagnosis Contract

### 3.1 Exact snapshot binding

Every diagnosis run must bind to one exact immutable snapshot.

For the current controlled rebuild:

```text
Snapshot 4:
da6e9a8e-1ae0-4436-ab67-429a7d33197b

Fingerprint:
bd0e75c5c0c8662dba0edb60b35d5e3b
```

The diagnosis run must record at minimum:

- Business ID;
- Snapshot ID;
- Snapshot version;
- immutable snapshot fingerprint or equivalent verification;
- diagnosis input version;
- diagnosis prompt version;
- deterministic input hash;
- provider/model;
- timestamps;
- run status.

The run must not switch to live canonical state after analysis begins.

### 3.2 Diagnosis is analytical state

Diagnosis outputs are separate analytical state.

They must not be persisted into canonical:

- Claims;
- Evidence;
- Metrics;
- Claim/Evidence relationships.

Historical diagnosis runs and approved diagnosis artifacts are immutable.

A later diagnosis against a later snapshot is a new analytical artifact, not an in-place rewrite.

### 3.3 Required diagnostic distinction

The system must preserve the distinction:

```text
canonical evidence
≠ deterministic calculation
≠ analytical interpretation
≠ strategic decision
```

The diagnosis contract must support structured outputs sufficient to answer:

- What is the current business position?
- What observations are strongly supported?
- What are the most material constraints?
- What risks or vulnerabilities are visible?
- What evidence supports each material conclusion?
- Which evidence gaps limit the analysis?
- Which statements are calculated rather than source-supplied?
- Which conclusions are AI interpretation rather than fact?
- Which issues require a later strategic decision?

### 3.4 Grounding rule

Every material diagnostic conclusion must either:

1. reference one or more valid snapshot-local records; or
2. be explicitly marked as an interpretation/hypothesis with its limitation visible.

Unsupported inference must never be presented as source fact.

### 3.5 Carried-forward evidence gaps

The six validated gaps remain active context:

1. direct delivery costs, operating costs, founder compensation, profit/loss and cash;
2. opportunity history and lead-to-sale conversion;
3. channel attribution, acquisition cost and founder time by channel;
4. historical revenue-mix baseline and target recurring-revenue percentage;
5. customer-segment performance metrics;
6. current founder working-time allocation.

Absence of data is not evidence of poor performance.

Valid:

```text
Channel efficiency cannot currently be quantified because channel-level conversion and cost data are unavailable.
```

Invalid without further evidence:

```text
LinkedIn is an ineffective acquisition channel.
```

Valid:

```text
Profitability cannot be established from the current snapshot.
```

Invalid without evidence:

```text
The business is unprofitable.
```

---

## 4. M4-06 — Qualifier and Uncertainty Semantics

### 4.1 No automatic truth weighting

These fields must not be automatically converted into truth weights:

- reliability;
- directness;
- recency;
- confidence;
- confidence basis;
- `strengthScore`;
- numeric precision.

They are separate semantic dimensions.

### 4.2 `strengthScore`

`strengthScore` remains:

> **semantic-link confidence only**

It is not:

- probability a Claim is true;
- evidence credibility;
- proof weight;
- source reliability;
- diagnosis confidence;
- importance;
- materiality.

Do not sum, average or otherwise transform `strengthScore` into an evidence score.

### 4.3 Reliability, directness and recency

These may be used descriptively to explain analytical limitations or to guide human attention.

They must not become an implicit mathematical truth formula.

### 4.4 Numeric precision

Existing precision classes retain their meaning:

- exact;
- approximate;
- estimate;
- range;
- unspecified.

Rules:

- approximate values remain approximate;
- ranges remain ranges;
- no midpoint substitution by default;
- no precision upgrade;
- `unspecified` never becomes `exact` silently;
- software-derived values must be marked **derived/calculated**;
- derived values are not founder-supplied Evidence.

### 4.5 Diagnosis confidence

If a diagnosis item includes confidence, define it as:

> **confidence in the analytical interpretation**

It must not be computed as a hidden formula over Evidence qualifiers.

It is not a canonical truth probability.

### 4.6 B-09 remains open

Do not use this work to silently resolve the global qualifier-vocabulary finding B-09.

Any diagnosis-local labels such as `high`, `medium`, `low` must be scoped and locally defined.

---

## 5. Snapshot-Local References

Reuse the M4-12 principle:

> **AI selects bounded snapshot-local references; software owns canonical identity.**

The model must not reproduce canonical UUIDs.

Preferred namespaces:

```text
C###  Claim
E###  Evidence
M###  Metric
G###  validated gap, if diagnosis needs direct gap references
```

Application code owns the mapping.

Unknown, malformed, wrong-type, cross-snapshot or cross-Business handles fail closed.

---

## 6. Deterministic Calculations

Where a figure can be calculated deterministically from canonical Metrics, software should calculate it.

Examples may include:

- totals;
- percentages;
- ratios;
- changes;
- revenue mix;
- concentration measures.

Only calculate where the canonical inputs are sufficient.

Each derived result should preserve:

- formula/rule;
- source record references;
- precision semantics;
- output value;
- derived/calculated status.

The preferred boundary is:

```text
Software calculates.
AI interprets.
Human approves material strategy.
```

---

## 7. Materiality

Diagnosis may classify or rank issues by materiality if the schema defines what materiality means.

Materiality is not truth.

`high materiality` means the issue could materially affect the business or strategy; it does not mean high probability that the statement is true.

Any model-assigned materiality must be reviewable by the human.

---

## 8. M4-07 — Human Approval Contract

### 8.1 Mandatory review checkpoint

A successful diagnosis run does not automatically move the Business into a later strategic state.

Required semantics:

```text
PHASE1_READY
→ diagnosis run
→ DIAGNOSIS_REVIEW_REQUIRED (or repository-equivalent)
→ human review
→ explicit human approval
→ next allowed workflow state
```

If existing workflow names differ, preserve repository conventions while keeping the checkpoint.

### 8.2 Review completeness

The human review surface must expose every material persisted diagnosis field.

At minimum:

- conclusion/observation;
- type/category;
- supporting references;
- evidence-backed / calculated / interpretive status;
- materiality;
- uncertainty/limitations;
- relevant evidence gaps;
- diagnosis confidence if present;
- provenance/version information in an appropriate read-only area.

Do not repeat the M4-11 failure mode where material persisted fields were hidden from review.

### 8.3 Review decisions

Support at least:

```text
ACCEPT
CORRECT
REJECT
```

or existing repository-equivalent semantics.

The human must be able to correct a material interpretation before it enters the approved diagnosis artifact.

Rejected items do not enter the approved artifact.

### 8.4 Approval semantics

Approval means:

> The human accepts the diagnosis artifact as the current analytical basis for the next strategic phase.

Approval does not mean:

- all Claims are objectively true;
- gaps are resolved;
- AI interpretation has become canonical fact;
- recommendations are automatically approved.

### 8.5 Audit

Record:

- reviewer;
- decisions;
- corrections;
- timestamps;
- diagnosis run ID;
- Snapshot ID/version;
- input/prompt versions;
- approved diagnosis artifact ID/version.

Approved historical diagnosis artifacts remain immutable.

---

## 9. Failure Behaviour

Diagnosis validation is fail-closed.

If structured output is invalid:

- no approved diagnosis is created;
- no strategic workflow advancement occurs;
- no canonical state changes;
- raw failed-run data may remain for audit;
- invalid material conclusions are not partially admitted.

---

## 10. Historical Reproducibility

Each diagnosis must be reproducible from:

- exact immutable snapshot;
- deterministic input projection;
- deterministic calculations/versioned rules;
- prompt version;
- input version;
- provider/model metadata;
- deterministic input hash.

Later prompts or snapshots must not alter historical diagnosis artifacts.

---

## 11. Current Rebuild Hold

During implementation the Baslon Digital rebuild must remain:

```text
PHASE1_READY
```

Do not:

- run Phase 1 Diagnosis;
- submit more evidence;
- create a new snapshot;
- run Evidence Coherence;
- mutate canonical records;
- advance the workflow;
- archive/delete any Business;
- repair documented Snapshot 3/4 deviations.

After implementation is merged, diagnosis still requires separate Product Owner approval.

---

## 12. Relationship to Existing Findings

### M4-03
Question-context grounding remains open unless independently satisfied.

### B-09
Global qualifier vocabulary remains open.

### B-31
Compound-number behaviour remains open and non-blocking unless diagnosis exposes a direct failure.

### M4-12
Resolved. Reuse its bounded local-reference pattern.

---

## 13. Findings Register Intent

Keep M4-05 / M4-06 / M4-07 open until implementation, tests, merge and bounded validation are complete.

Suggested definitions:

### M4-05 — Phase 1 Diagnosis contract
Snapshot-bound, structured, evidence-grounded analytical diagnosis with deterministic validation and no canonical mutation.

### M4-06 — Qualifier semantics in diagnosis
Evidence qualifiers, precision and `strengthScore` must not become automatic truth weights; deterministic calculations remain separate from AI interpretation.

### M4-07 — Human approval of diagnosis
All material diagnosis output must be reviewed and explicitly accepted/corrected/rejected by a human before strategic workflow advancement.

---

## 14. Acceptance Criteria

This architecture is complete only when:

1. Diagnosis reads one exact immutable snapshot.
2. Diagnosis has explicit input and prompt versions.
3. Input projection and hash are deterministic.
4. Diagnosis is separate analytical state.
5. Canonical Claim/Evidence/Metric state is never mutated by diagnosis.
6. Material conclusions are grounded or explicitly interpretive/hypothetical.
7. Known gaps remain visible and cannot be silently filled.
8. `strengthScore` stays semantic-link confidence only.
9. Reliability/directness/recency are not automatic truth weights.
10. Numeric precision is preserved.
11. Derived calculations are software-owned and labelled derived.
12. Model references use local handles, not canonical UUIDs.
13. Unknown/out-of-snapshot references fail closed.
14. Valid diagnosis cannot auto-approve itself.
15. All material persisted diagnosis fields are visible in review.
16. ACCEPT/CORRECT/REJECT semantics exist.
17. Approval is auditable.
18. Historical diagnosis artifacts are immutable.
19. Failed diagnosis cannot advance workflow.
20. Baslon Digital remains `PHASE1_READY` throughout implementation.
21. No Baslon Digital diagnosis run occurs before separate Product Owner approval after merge.

---

## 15. Architecture Outcome

The required boundary is:

```text
Canonical evidence snapshot
        ↓
deterministic projection/calculation
        ↓
AI analytical proposal
        ↓
software validation
        ↓
human review
        ↓
approved analytical diagnosis
        ↓
later strategic workflow
```

Not:

```text
AI reads live state
→ invents/weights facts
→ writes strategy
→ advances workflow
```
