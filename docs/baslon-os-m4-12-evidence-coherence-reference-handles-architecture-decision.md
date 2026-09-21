# Baslon OS — M4-12 Evidence Coherence Snapshot-Local Reference Handles Architecture Decision

**Status:** Approved for implementation  
**Milestone:** 4  
**Finding:** M4-12  
**Decision owner:** Solution Architect / Product Owner  
**Date:** 21 September 2026  
**Affected module:** Evidence Coherence  
**Current rebuild:** Baslon Digital controlled rebuild v2  
**Business:** `a658df7e-a161-4487-a6c7-3b9f8b01b1fd`  
**Current Snapshot:** Snapshot 4 — `da6e9a8e-1ae0-4436-ab67-429a7d33197b`  
**Current workflow state:** `GAP_ANALYSIS`  
**Execution hold:** **No further Evidence Coherence retries until M4-12 is implemented, tested, reviewed, merged, and the Product Owner explicitly approves the retry.**

---

## 1. Decision Summary

Evidence Coherence must stop asking the AI model to reproduce canonical UUIDs.

From M4-12 onward, the Evidence Coherence input projection will assign **deterministic, snapshot-local reference handles** to canonical Claims, Evidence and Metrics. The model will use only those short handles when citing supporting records.

Application code will validate and resolve those local handles back to canonical UUIDs before any finding references can be persisted.

The governing rule is:

> **AI may select bounded snapshot-local references. Software owns canonical identity.**

This preserves the existing Baslon OS architecture:

> **AI proposes. Software validates/calculates. Humans make material strategic decisions.**

---

## 2. Why This Decision Is Required

Evidence Coherence currently includes canonical record UUIDs in the model input and requires the model to reproduce them exactly in its structured output.

That has failed repeatedly in live execution.

The same canonical profitability-gap Evidence record has now caused two deterministic validation failures across three attempts:

| Run | Snapshot | Result |
|---|---|---|
| `8c3f1af5-1efd-4e72-9e74-8cbaccef4b19` | Snapshot 3 | Failed: model emitted a corrupted/spliced UUID |
| `90cd5ec9-2c8a-4ca7-a7ab-407afd26131b` | Snapshot 3 | Succeeded on retry |
| `9883e5cb-f2d8-4798-b4ac-16647c203d53` | Snapshot 4 | Failed: model emitted a scrambled UUID for the same underlying Evidence |

The affected canonical Evidence UUID is:

```text
4142656f-8877-447b-86c9-5c0c3e35a58d
```

The Snapshot 4 model output instead emitted:

```text
414b2656-8877-447b-86c9-5c0c3e35a58d
```

The deterministic validator correctly rejected the run because the emitted identifier was not in the analysed snapshot.

No invalid finding references were persisted.

The validator is therefore functioning correctly. The failure is in the contract that asks the model to reproduce canonical infrastructure identifiers.

This is now a recurring architectural reliability issue, not a one-off model error.

---

## 3. Scope of M4-12

M4-12 changes only how Evidence Coherence identifies canonical records in AI input/output.

It does **not** change:

- canonical Claim, Evidence, Metric or relationship records;
- Snapshot 4;
- Snapshot versions 1–4;
- the meaning of `strengthScore`;
- Evidence credibility or proof weighting;
- numeric precision semantics;
- Findings Register authority;
- the human review model;
- workflow policy;
- the definition of contradictions, gaps or targeted questions;
- historical analysis runs;
- the Baslon Digital source material;
- any earlier Baslon Digital Business.

This is a reference-identity reliability fix.

---

## 4. Versioning Decision

Do not silently change existing production contracts.

Create new Evidence Coherence versions:

```text
evidence_coherence_input_v3
evidence_coherence_v4
```

Historical runs must continue to identify their original versions:

```text
evidence_coherence_input_v2
evidence_coherence_v3
```

No historical run is rewritten, revalidated or reinterpreted.

The new version boundary is intentional because the model-facing reference contract changes materially.

---

## 5. Snapshot-Local Handle Contract

Each projected canonical record receives a short local handle.

Use type-specific namespaces:

```text
C001, C002, C003 ...   Claim
E001, E002, E003 ...   Evidence
M001, M002, M003 ...   Metric
```

Requirements:

1. Handles are unique within the exact projected snapshot.
2. Handles are deterministic for the same snapshot and projection version.
3. Handles are not canonical identifiers.
4. Handles carry no semantic meaning beyond record identity within that projection.
5. Handles are never persisted as a replacement for canonical UUIDs.
6. Model output must use handles, not UUIDs, for finding references.
7. The application resolves handles back to canonical UUIDs before persistence.

---

## 6. Deterministic Handle Assignment

The same immutable snapshot projected twice through `evidence_coherence_input_v3` must produce the same handle map.

Do not depend on incidental database-return order.

For each entity type, use a stable ordering.

Preferred implementation:

1. use the projection's existing explicitly deterministic ordering if one already exists;
2. otherwise define a deterministic domain ordering;
3. use canonical UUID as the final tie-breaker.

The exact ordering rule must be documented in code and covered by tests.

---

## 7. Input Projection Contract

`evidence_coherence_input_v3` should expose only the information the model needs to reason.

Example:

```json
{
  "handle": "E013",
  "statement": "Reliable figures for founder compensation, resulting profit or loss, and cash generated are unavailable.",
  "evidenceType": "profitability_data_gap",
  "precision": "unspecified"
}
```

The model should not need the canonical UUID.

### UUID exposure

Preferred architecture: **do not include canonical UUIDs in the model payload at all**.

If implementation inspection reveals a genuinely necessary internal reason to retain them before the model boundary, they may exist in application memory, but they must not be required in model output.

---

## 8. Model Output Contract

`evidence_coherence_v4` must require local handles in finding references.

Conceptual example:

```json
{
  "gaps": [
    {
      "id": "gap_1",
      "area": "financial_performance",
      "materiality": "high",
      "references": [
        {
          "entityType": "evidence",
          "ref": "E013",
          "role": "context"
        }
      ]
    }
  ]
}
```

The exact schema may differ from the conceptual example, but these rules are mandatory:

- reference values are local handles;
- canonical UUIDs are not model-authored;
- entity type is explicit or inferable from the handle namespace and validated;
- malformed handles are rejected;
- unknown handles are rejected;
- cross-type references are rejected;
- no fuzzy repair is allowed.

---

## 9. Application-Side Resolution

After structured model output is parsed:

1. validate handle syntax;
2. verify each handle exists in the exact handle map generated for that analysis input;
3. verify the handle namespace matches the expected canonical entity type;
4. resolve the handle to the canonical UUID;
5. verify the resolved record belongs to the exact analysed snapshot;
6. only then create canonical finding-reference persistence data.

No best-effort matching is permitted.

The application must not:

- guess a near match;
- repair a mistyped handle;
- search by statement text;
- resolve against live canonical state;
- resolve against a different snapshot;
- accept a canonical UUID supplied by the model as a substitute.

---

## 10. Snapshot and Business Integrity

The handle map must be constructed exclusively from records present in the immutable snapshot being analysed.

This preserves:

- exact snapshot membership;
- same-Business integrity;
- entity-type integrity;
- historical reproducibility;
- no cross-Business references;
- no live-state drift.

A handle is valid only in the context of the exact analysis input that created it.

---

## 11. Input Hash and Reproducibility

The projected payload, including local handles, participates in the normal analysis input hash.

For the same immutable snapshot, projection version, prompt version and deterministic ordering logic, the generated projection and handle assignments must be stable.

Tests must confirm repeat projection produces identical local-reference ordering and identical input serialization/hash, subject to the repository's existing hashing contract.

---

## 12. Persistence Rule

The database continues to store canonical UUID references.

Snapshot-local handles are transient projection artefacts only.

The canonical persistence path remains conceptually:

```text
model handle
    ↓
deterministic validation
    ↓
snapshot-local handle map
    ↓
canonical UUID
    ↓
analysis_finding_references
```

No schema migration should be introduced unless implementation inspection proves it is unavoidable.

The default expectation is **no database migration**.

---

## 13. Failure Behaviour

The deterministic validator remains fail-closed.

The complete Evidence Coherence output must fail validation if any finding reference:

- uses an unknown handle;
- uses malformed syntax;
- uses the wrong entity namespace;
- resolves outside the analysed snapshot;
- cannot be deterministically mapped.

On failure:

- no contradictions are persisted;
- no gaps are persisted;
- no targeted questions are persisted;
- no finding references are persisted;
- the raw failed run remains immutable for audit;
- the workflow behaves according to the existing retry/failure path.

Do not weaken the current all-or-nothing validation guarantee.

---

## 14. Findings Register

Create a formal Findings Register entry:

### M4-12 — Evidence Coherence relies on model reproduction of canonical UUIDs

**Problem:** Evidence Coherence requires the model to reproduce full canonical UUIDs in analytical finding references. Repeated live-model runs have corrupted the same valid Snapshot record identifier, causing deterministic validation failure.

**Risk:** As snapshots grow, model-authored UUID reproduction creates avoidable reliability failures and can prevent workflow progression even when the analytical content is otherwise valid.

**Decision:** Replace model-authored canonical identifiers with deterministic snapshot-local reference handles. Application code resolves validated handles to canonical UUIDs.

**Status:** Open until implementation, automated tests, live regression validation and merge are complete.

**Classification:** Milestone 4 blocker.

---

## 15. Current Baslon Digital Rebuild State

The controlled Baslon Digital rebuild is paused.

```text
Business:
a658df7e-a161-4487-a6c7-3b9f8b01b1fd

Snapshot 4:
da6e9a8e-1ae0-4436-ab67-429a7d33197b

Snapshot 4 fingerprint:
bd0e75c5c0c8662dba0edb60b35d5e3b

Canonical counts:
39 Claims
59 Evidence
18 Metrics
54 relationships

Workflow:
GAP_ANALYSIS
```

The failed Snapshot 4 Evidence Coherence run is:

```text
9883e5cb-f2d8-4798-b4ac-16647c203d53
```

It must remain immutable.

### Hard execution hold

Until M4-12 is implemented and merged:

- **do not retry Evidence Coherence;**
- do not use `CONTINUE_WITH_GAPS`;
- do not add more Baslon Digital evidence;
- do not rebuild Snapshot 4;
- do not start diagnosis;
- do not archive/delete any Baslon Digital Business;
- do not start unrelated Milestone 4 work that changes this workflow state.

---

## 16. Relationship to Snapshot 4 Deviations

The three documented Snapshot 4 deviations are not the cause of M4-12:

1. garbled `claim_1`;
2. clean duplicate `claim_2`;
3. non-standard `metric_1` dimension shape.

The failed Snapshot 4 model output did not rely on those records in the invalid reference.

M4-12 therefore does **not** authorize rebuilding or modifying Snapshot 4.

---

## 17. Acceptance Criteria

M4-12 is architecturally complete only when all of the following are true:

1. `evidence_coherence_input_v3` exists.
2. `evidence_coherence_v4` exists.
3. model-facing finding references use snapshot-local handles.
4. canonical UUID reproduction is no longer required from the model.
5. handle assignment is deterministic.
6. handle resolution is application-owned.
7. unknown handles fail validation.
8. wrong-type handles fail validation.
9. no cross-snapshot/cross-Business resolution is possible.
10. canonical UUIDs are persisted after successful deterministic resolution.
11. existing all-or-nothing validation remains intact.
12. historical v2/v3 analysis runs remain unchanged.
13. automated tests cover the reference-map contract.
14. Findings Register contains M4-12.
15. repository tests pass.
16. a clean implementation report is reviewed by the Solution Architect.
17. implementation is merged before any Baslon Digital Evidence Coherence retry.

---

## 18. Post-Merge Operational Decision

After M4-12 is merged, do **not** automatically retry the Baslon Digital analysis.

First verify:

- repository is on the merged M4-12 baseline;
- target database is correct;
- Snapshot 4 is unchanged;
- canonical counts are unchanged;
- workflow remains `GAP_ANALYSIS`;
- failed run history is unchanged;
- new prompt/projection versions are active for retry.

Then the Product Owner must explicitly approve one Evidence Coherence retry against the same immutable Snapshot 4.

---

## 19. Architecture Outcome

M4-12 changes the responsibility boundary from:

```text
AI reasons + reproduces canonical identity
```

to:

```text
AI reasons + selects local bounded references
Software validates + resolves canonical identity
```

That is the correct Baslon OS boundary and should be reused anywhere else the system currently asks a model to reproduce opaque canonical identifiers.
