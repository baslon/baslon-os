# Baslon OS — M4-02 Numeric Precision Architecture Decision
## Approximate, Estimated and Range-Based Numeric Evidence

**Status:** Approved architectural decision\
**Milestone:** 4 — Phase 1 Diagnosis\
**Finding:** M4-02 — Approximate and range values may become exact canonical numbers\
**Implementation:** Not authorised by this document

---

## 1. Decision Summary

Baslon OS must distinguish between:

- a number's **stored numeric representation**; and
- the **precision actually justified by the source**.

A numeric value stored in PostgreSQL must never be assumed to be exact merely because it is represented as a numeric type.

For Phase 1 Diagnosis:

> **Unsupported precision is prohibited.**

If the underlying source says:

- "about 30 clients";
- "roughly £4k";
- "approximately £80,000";
- "10–15 projects";

the diagnosis must preserve that uncertainty.

It must not silently turn those statements into:

- exactly 30 clients;
- exactly £4,000;
- exactly £80,000;
- one exact project count.

This applies to:

- AI interpretation;
- deterministic calculations;
- diagnosis findings;
- root-cause synthesis;
- opportunity reasoning;
- executive summaries.

---

## 2. Why This Decision Is Required

The current findings register identifies M4-02 as a Milestone 4 issue because approximate or range-based source statements can currently be normalized into numeric canonical values.

That was acceptable while the system was primarily storing and reviewing evidence.

It becomes materially more important once diagnosis starts:

- comparing numbers;
- calculating ratios;
- identifying financial patterns;
- drawing operational conclusions;
- synthesizing causal explanations.

A diagnosis engine that treats an approximate number as exact would create **false precision**.

That would undermine the epistemic integrity Baslon OS is designed to preserve.

---

## 3. Product Principle

The governing principle is:

> **Numeric storage does not upgrade epistemic certainty.**

The numeric field answers:

> "What value was captured?"

It does not necessarily answer:

> "How precisely was that value known?"

Those are separate concepts.

Examples:

```text
Source:
"Revenue was roughly £80k last year."

Numeric representation:
80000

Precision:
approximate
```

```text
Source:
"We completed 10–15 projects."

Numeric representation:
must not imply one exact observed count

Precision:
range
```

```text
Source:
"Revenue was £79,842.17 according to the year-end accounts."

Numeric representation:
79842.17

Precision:
exact, subject to the reliability/provenance of the source
```

Precision is also distinct from reliability.

An exact number from an unreliable source is still an exact claim made by that source.

An approximate number from a highly reliable source remains approximate.

---

## 4. Approved Precision Vocabulary

For Phase 1, numeric precision should use a small explicit vocabulary:

- `exact`
- `approximate`
- `estimate`
- `range`
- `unspecified`

### `exact`

The source expresses a specific value without approximation/range semantics.

Example:

> "There were 37 qualified enquiries."

### `approximate`

The source gives a single approximate value.

Indicators may include language such as:

- about;
- approximately;
- roughly;
- around;
- circa.

Example:

> "We did about £80k in revenue."

### `estimate`

The source explicitly presents the value as an estimate, projection-like recollection, or calculated estimate rather than an observed exact amount.

Example:

> "I estimate around 20% of enquiries come from referrals."

`estimate` must not be confused with a future forecast. This category is about the epistemic status of a current/historical number.

### `range`

The source supplies lower and upper bounds.

Example:

> "We normally complete 10–15 projects per month."

A range must preserve both bounds.

### `unspecified`

The system cannot safely determine the source precision.

This is the correct conservative classification for historical numeric records that predate explicit precision metadata unless the precision can be established through an approved human-review process.

`unspecified` must **not** be treated as `exact`.

---

## 5. Architectural Decision: Add Explicit Precision Semantics

The preferred architecture is to add explicit numeric precision semantics to the canonical evidence model before Phase 1 Diagnosis begins using numeric values materially.

This should be implemented through:

- a forward database migration;
- versioned extraction/proposal contracts;
- human-visible review;
- deterministic validation;
- snapshot inclusion;
- diagnosis-input inclusion.

Do not edit historical migrations.

Do not reinterpret existing historical snapshot bytes.

Historical snapshots remain immutable.

---

## 6. Canonical Data Model Semantics

The implementation should support the following concepts.

### Single numeric values

For a canonical numeric Evidence/Metric value, preserve:

- numeric value;
- unit/currency where applicable;
- precision classification.

For example:

```text
value = 80000
precision = approximate
```

### Ranges

A range must preserve:

- lower bound;
- upper bound;
- unit/currency;
- precision = range.

Do not collapse:

```text
10–15
```

into:

```text
10
```

or:

```text
12.5
```

as canonical truth.

A midpoint may later be calculated for a specific deterministic purpose, but it must remain explicitly derived and must not replace the source range.

### Existing scalar field

If the current schema contains a scalar numeric field used throughout the application, do not casually remove or reinterpret it.

The M4-02 implementation brief should inspect the schema and choose the smallest compatible forward design.

Compatibility may require retaining the current scalar while adding explicit precision/range fields.

The architecture decision is about semantics, not prescribing an unreviewed column layout.

---

## 7. Historical Numeric Records

Historical canonical records and snapshots must not be rewritten merely to retrofit precision.

For existing records that lack explicit precision metadata:

> **Treat precision as `unspecified` unless a new human-authorised evidence/review cycle establishes otherwise.**

Do not:

- infer `exact` simply because a numeric scalar exists;
- silently backfill `approximate` from text using an AI model;
- mutate old snapshots;
- rewrite historical analytical runs.

The active Business may contain source text that clearly uses approximate language, but durable canonical correction should still respect the existing human-authorised evidence path.

If the Product Owner later wants historical precision upgraded, it should occur through an explicit migration/review strategy, not through silent mutation.

### Decision: historical precision

Existing numeric records without precision metadata remain `unspecified`; M4-02A adds no retrofit mechanism. The active Baslon Digital Business will be rebuilt from its approved genuine sources after M4-02A, with precision confirmed in human review, and the current Business archived. Evidence supersession for changing or corrected figures is deferred to a separate brief.

---

## 8. Extraction Rules

A future extractor revision must propose numeric precision alongside the value.

The extractor may identify:

- exact;
- approximate;
- estimate;
- range.

But AI output remains a proposal.

The human reviewer must see the proposed precision before accepting it into canonical state.

For range values, the extractor must preserve both source bounds.

### Deterministic grounding

Where practical, deterministic validation should verify that:

- the numeric value/bounds are supported by the human source text;
- approximation/range language is present where claimed;
- question context does not supply the number;
- written-number normalization follows the approved versioned rules.

The extractor must not create false precision during normalization.

---

## 9. Human Review Requirements

The Evidence Review UI must show numeric precision clearly.

Examples:

```text
£80,000
Precision: Approximate
```

```text
10–15 projects
Precision: Range
```

```text
37 enquiries
Precision: Exact
```

The human should not be able to accept a numeric proposal without seeing its precision classification.

Corrections must permit the human to correct:

- value;
- precision;
- range bounds where applicable.

Canonical admission remains human-authorised.

---

## 10. Snapshot Requirements

Future snapshots created after M4-02 implementation must carry the precision semantics needed to reproduce diagnosis correctly.

Historical snapshots remain unchanged.

A diagnosis must read the precision information from the exact snapshot it analyses.

It must never reconstruct the historical precision from today's live canonical state.

---

## 11. Diagnosis Input Rules

The Phase 1 Diagnosis input contract must make precision explicit.

Diagnosis must never receive a bare numeric value without enough context to know whether it is:

- exact;
- approximate;
- estimated;
- a range;
- unspecified.

At minimum, the diagnosis projection must carry:

- the source numeric value or range;
- unit/currency;
- precision;
- the supporting human-readable canonical statement;
- canonical record ID/provenance needed for citation.

For historical records with no precision metadata:

```text
precision = unspecified
```

---

## 12. Deterministic Calculation Rules

Baslon OS may still perform deterministic arithmetic on non-exact values where useful, but the result inherits uncertainty.

Examples:

### Approximate inputs

If:

```text
revenue ≈ £80,000
projects ≈ 20
```

then:

```text
average project value ≈ £4,000
```

not:

```text
average project value = £4,000 exactly
```

### Range inputs

If a calculation uses a range, deterministic code should preserve bounds where practicable.

Example:

```text
10–15 projects
£50k revenue
```

could support a derived range rather than one falsely exact average.

### Mixed precision

A derived calculation must not have stronger precision than its least-precise material input.

This rule should live in deterministic application code, not in an AI prompt.

---

## 13. Diagnosis Language Rules

AI diagnosis must reflect input precision in its wording.

Acceptable:

- "Revenue appears to be around £80k."
- "The available evidence suggests roughly 10–15 projects per month."
- "Based on the current estimate..."
- "The figure is approximate, so this comparison should be treated directionally."

Not acceptable:

- "Revenue is exactly £80,000" when the source said roughly £80k.
- "The company completes 12.5 projects per month" when the source gave 10–15.
- decimal-heavy ratios derived from approximate inputs without qualification.

The model must not create a veneer of accuracy from normalized data.

---

## 14. Precision Is Not Reliability

Do not merge precision with existing evidence-quality concepts.

These remain separate dimensions:

```text
Precision:
How specifically is the numeric value stated?

Reliability:
How trustworthy is the evidence/source?

Directness:
How directly does the evidence establish the proposition?

Recency:
How current is it?

Materiality:
How important is it to the present analysis?
```

Examples:

```text
Audited accounts:
£79,842.17
Precision = exact
Reliability = high
```

```text
Owner recollection:
"About £80k"
Precision = approximate
Reliability = separately assessed
```

Do not convert any of these dimensions into Claim-truth probability.

---

## 15. Relationship Strength Remains Unrelated

`strengthScore` remains:

> confidence that the selected semantic relationship type is appropriate.

It must not be used to infer:

- numeric precision;
- Evidence credibility;
- proof weight;
- Claim truth;
- diagnostic confidence.

M4-02 must not change this semantic contract.

---

## 16. Migration Strategy

If implementation is approved, use a forward migration only.

The implementation brief must inspect the current schema before selecting exact columns or constraints.

The migration should:

- preserve existing records;
- avoid destructive rewrites;
- default existing precision to `unspecified` or equivalent safe absence;
- add database constraints for stable precision vocabulary;
- preserve Same-Business integrity;
- preserve Permanent Delete behaviour;
- add PostgreSQL tests.

Historical snapshots are not migrated into a new interpretation.

---

## 17. Versioning Requirements

M4-02 implementation will require versioning wherever semantics change.

At minimum inspect whether to version/bump:

- extraction contract;
- extractor prompt;
- proposal contract;
- snapshot projection contract;
- diagnosis input contract.

If written-number behavior is touched, also close or explicitly address M4-10:

> Written-number prompt and deterministic validator disagree.

Do not make an extractor contract change without aligning that rule.

---

## 18. What Phase 1 Diagnosis May Do Before Historical Data Is Re-reviewed

Once the precision contract exists, Phase 1 Diagnosis may analyse a mixed snapshot containing:

- new records with explicit precision;
- historical records with `unspecified` precision.

For `unspecified` historical values:

- use them cautiously;
- do not call them exact;
- avoid conclusions that depend on fine-grained precision;
- label material uncertainty where relevant.

This allows diagnosis to proceed without rewriting historical evidence.

---

## 19. What Must Not Happen

Do not:

- treat every numeric database field as exact;
- silently infer precision from storage type;
- use AI to backfill historical precision without human review;
- rewrite existing snapshots;
- convert ranges into midpoints as canonical truth;
- hide approximate semantics from human reviewers;
- produce exact-looking derived metrics from approximate inputs;
- use `strengthScore` as a precision or truth signal;
- introduce diagnosis implementation as part of the M4-02 remediation task unless separately authorised.

---

## 20. Recommended M4-02 Implementation Scope

If this architecture decision is approved, the next bounded engineering task should be:

### M4-02A — Numeric Precision Foundation

Implement only:

1. forward schema support for numeric precision/ranges;
2. versioned extraction/proposal contracts;
3. deterministic grounding/validation;
4. human review display/correction;
5. canonical persistence;
6. snapshot inclusion;
7. tests;
8. documentation/findings-register update.

Do **not** implement the Phase 1 diagnosis engine in M4-02A.

After M4-02A is complete and reviewed:

### M4-02B / Milestone 4B — Diagnosis Input Contract

Define the exact snapshot-bound diagnosis projection using the newly explicit precision semantics.

---

## 21. Approved Product Owner Decision

**Status: APPROVED**

The Product Owner has approved the following decision:

> **Baslon OS will model numeric precision explicitly. Existing numeric records without precision metadata will be treated as `unspecified`, not exact. New numeric extraction will distinguish exact, approximate, estimated and range-based values and expose that classification to human review. Ranges will preserve their bounds. Phase 1 Diagnosis and deterministic calculations must preserve input uncertainty and may never imply greater precision than the evidence supports. Historical snapshots will not be rewritten.**

The following additional Product Owner decisions are also approved and govern M4-02A:

- existing numeric records without precision metadata remain `unspecified`;
- M4-02A adds no retrofit mechanism;
- the active Baslon Digital Business will be rebuilt from approved genuine sources after M4-02A, with precision confirmed through the normal human review flow;
- the current Baslon Digital Business will be archived only after that rebuild;
- Evidence supersession for changing or corrected figures is deferred to a separate architecture/build brief.

These decisions are settled for M4-02A and are not implementation options for the Engineer to reopen.

---

## 22. Architectural Verdict

M4-02 should be fixed **before material Phase 1 diagnosis calculations are implemented**.

A prompt-only warning is not strong enough as the long-term architecture because:

- numeric precision affects deterministic calculations as well as AI language;
- most of the currently observed numeric Evidence is approximate;
- precision is an epistemic property worth preserving explicitly;
- later retrofitting would be harder once diagnosis logic starts depending on the existing scalar representation.

The safest path is therefore:

```text
Milestone 4A complete
        ↓
M4-02 architecture decision
        ↓
M4-02A numeric precision foundation
        ↓
snapshot contains explicit precision
        ↓
Milestone 4B diagnosis input contract
        ↓
Phase 1 Diagnosis
```

This preserves Baslon OS's governing principle:

> **Software must not manufacture certainty that the underlying evidence does not contain.**
