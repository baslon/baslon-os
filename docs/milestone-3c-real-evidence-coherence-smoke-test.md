# Milestone 3C Core Real Evidence Coherence Smoke Test

> [!WARNING]
> **Historical contaminated smoke-test record — non-authoritative**
>
> This document records an earlier Milestone 3C real-model smoke test that was
> run against a Baslon Digital Business later confirmed to contain fictional test
> data, including the £195/month website performance review service.
>
> The Business, snapshots, findings and questions documented here are historical
> test artefacts only. They must not be treated as authoritative evidence about
> the active Baslon Digital Business and must not be reused as current canonical
> or analytical input.
>
> The contaminated Business was subsequently archived and replaced with a clean
> Baslon Digital Business built only from approved genuine information.

## Result

**Milestone 3C core real Evidence Coherence smoke test PASSED.**

## Starting state

- Business: Baslon Digital
- Business ID: `68bb7e68-9f0f-4810-ac80-2a563b8451ab`
- Database positively verified: `baslon_os`
- Workflow: `EVIDENCE_READY`, version 9
- Snapshot ID: `1d3de3d9-8f8c-41b0-a2e0-37920cecfc45`
- Snapshot version: 3
- Snapshot JSON SHA-256: `70dbd14b8f1ad7efe2dbb5f879ad70f2d68cc3088e9436395fb28a365f3702d2`
- Claims: 17
- Evidence: 11
- Metrics: 6
- Relationships: 4
- Canonical snapshots: 3

## Analysis provenance

- Run ID: `94bc6f0d-2eed-4dc8-afc2-c064b2a98366`
- Status: `SUCCEEDED`
- Provider: `openai`
- Model: `gpt-5.6-luna`
- Prompt: `evidence_coherence_v1`
- Projection: `evidence_coherence_input_v1`
- Input hash: `8eab125e69948bb4125aede10e70ae0466431e0936823f64b644879fa396ced3`
- Input Snapshot: Snapshot 3
- Started: `2026-09-16T10:38:39.856Z`
- Completed: `2026-09-16T10:39:14.746Z`
- Model configuration, exact input payload, structured output, and raw output were persisted.
- Validation errors: none.

The run was observed in `RUNNING` state, with provenance already persisted, while the provider call was still in progress.

## Contradictions

No contradictions were generated.

This is reasonable: the model did not incorrectly classify compatible acquisition channels or differently worded evidence as contradictions.

## Evidence gaps

All referenced IDs were verified as members of Snapshot 3.

### 1. Financial reporting completeness

- Finding ID: `726c9138-a902-4275-a72c-4765515ea009`
- Area: `financial_performance`
- Materiality: high
- Priority: 1
- Gap: reporting periods for revenue mix plus cost, margin, and profit evidence
- Impact: limits revenue reconciliation and assessment of profitability
- References:
  - Claims: `ea0e56c8-9194-4669-a8e8-996ee4de6a8a`, `32f8e260-04f0-4997-ab98-da3f46f77905`
  - Evidence: `c09cba8f-eecb-4ac3-8af4-de4aff599d64`, `3816067c-cca9-4bca-9f0d-d0bbbdc63a17`, `ac0b8dc1-cdbb-4baf-af2e-dc29eb07788d`
- Assessment: materially useful. Minor quality concern: “no explicit reporting dates” somewhat overstates the omission because the £80,000 figure says “over the last 12 months,” although it lacks fixed dates. The founder-hours Evidence reference is irrelevant context. These do not invalidate the central cost/profit gap.

### 2. Acquisition-channel performance

- Finding ID: `81817ac5-f0c5-4d57-8297-3eb40dd7231f`
- Area: `marketing_and_acquisition`
- Materiality: high
- Priority: 2
- Gap: channel-level volumes, conversions, acquisition costs, and repeatability
- Impact: prevents acquisition-source comparison and validation of predictability
- References:
  - Claims: `3bbf3edd-24c4-408d-97fc-3ed0ec34649c`, `6f48539c-40dc-4997-a151-2a2aecd5b6a9`, `924bb0b1-03d2-4183-ad9f-c4efa76b5555`
  - Evidence: `59b6b5c9-2683-46c7-acba-072936eb2886`, `1b2d3400-37f9-4db2-8124-046e35712ad3`
  - Metric: `2c98f8ba-3b17-44fe-bd81-64655b616377`
- Assessment: highly material and directly supported. The snapshot explicitly records these figures as unavailable.

### 3. Monthly review-service validation

- Finding ID: `8d1d07fb-06bb-41b7-8b78-e9728e621994`
- Area: `business_and_offer`
- Materiality: high
- Priority: 3
- Gap: uptake, retention, cancellations, delivery time, and recurring-revenue contribution
- Impact: prevents distinguishing an evidenced recurring offer from a defined proposition
- References:
  - Claims: `0432767a-6eed-4006-af25-279d05ba82dc`, `e96c3a90-c354-4fda-9cdf-cb78638d9bfa`, `4fc32f7f-7005-486a-b11a-a52d43e57e99`
  - Evidence: `9dd1f322-50e9-4c9f-b015-ed30980200b3`, `5e7bb442-4e61-4738-8978-84e4ac556e19`
  - Metric: `41e5470f-af49-4500-8afd-008c704aab26`
- Assessment: specific, materially useful, and well grounded.

### 4. Tree-services client outcome quality

- Finding ID: `080c5b24-505b-48da-814e-cda9d6779e94`
- Area: `customers_and_market`
- Materiality: high
- Priority: 4
- Gap: baseline, enquiry quality, attribution, resulting sales, and revenue
- Impact: limits interpretation of the 428-enquiry result and its relevance to positioning
- References:
  - Claims: `577d0e2e-596f-4403-8fe0-22b7c8bb18dd`, `a1e786b1-706b-449d-8de5-1c185158210e`, `3963c782-eac4-4adc-b243-b793db3094a3`
  - Evidence: `61dbd3cf-11f1-45d1-947f-4f8b6147063f`
- Assessment: useful proof-quality gap. High materiality is directionally reasonable because this is prominent outcome evidence.

### 5. Target-customer definition

- Finding ID: `09b204f9-17c6-4a04-9761-61d18564defe`
- Area: `customers_and_market`
- Materiality: medium
- Priority: 5
- Gap: priority subsegments, buyer characteristics, needs, and ICP boundaries
- Impact: limits evaluation of positioning and acquisition-channel fit
- References:
  - Claims: `48e23439-1b42-4cae-b515-cf2936374fa3`, `e7f1b452-a0c4-44ae-90d0-203de764c510`, `3963c782-eac4-4adc-b243-b793db3094a3`, `56451ff8-c43a-4082-a9b4-7f2899849068`
- Assessment: useful and appropriately medium. It approaches a future strategic-choice boundary but remains framed as missing information rather than advice.

### 6. Current founder workload and capacity

- Finding ID: `c26fa788-8d0b-4d28-bb57-eaeb406b4a1a`
- Area: `delivery_and_capacity`
- Materiality: medium
- Priority: 6
- Gap: current hours, workload, capacity, delegation, and production split
- Impact: prevents comparison of current operations with the founder’s desired working pattern
- References:
  - Claim: `8d0767d8-f5e5-49ef-be9a-6d268f5ee829`
  - Evidence: `ac0b8dc1-cdbb-4baf-af2e-dc29eb07788d`
  - Metric: `791297c6-e0db-44c2-a856-050f57964e7e`
- Assessment: specific and appropriately medium—not incorrectly elevated merely because it is a founder preference.

## Questions

Six questions were persisted:

1. “What exact period does the £80,000 revenue figure cover, and what were total costs and profit over that same period?”
2. “For each acquisition source, what were the numbers of enquiries, qualified opportunities, and won clients over a defined recent period?”
3. “How many clients currently pay for the £195 monthly review service, and what are its retention and average delivery-time figures?”
4. “Of the 428 enquiries, how many were qualified, attributable to the website or SEO work, and converted into sales or revenue?”
5. “Which specific service-business segments and buyer profiles are intended to be prioritised within the current positioning?”
6. “What are the founder's current weekly hours and the approximate split between routine production, strategy, and architecture work?”

The UI surfaced exactly three:

- Question 1 → financial gap `726c9138-a902-4275-a72c-4765515ea009`
- Question 2 → acquisition gap `81817ac5-f0c5-4d57-8297-3eb40dd7231f`
- Question 3 → recurring-offer gap `8d1d07fb-06bb-41b7-8b78-e9728e621994`

The surfaced questions correspond to the first three high-materiality findings. They are specific, answerable, selective, and likely to materially improve the evidence base. None contains recommendations, diagnosis, or assumed facts.

## Boundary assessment

The output:

- stayed within evidence readiness;
- did not produce a business diagnosis;
- contained no recommendations;
- contained no strategy or actions;
- invented no unsupported facts;
- did not resemble an exhaustive generic questionnaire.

The six gaps are selective and tied to actual Snapshot 3 content.

## UI assessment

The Evidence Quality page correctly displayed:

- Snapshot 3;
- completed analytical state;
- all six evidence gaps;
- materiality and evidence-quality areas;
- decision impacts;
- exactly three prominent questions;
- “Candidate findings for investigation, not canonical facts.”

It exposed no:

- canonical-admission controls;
- question-answer flow;
- Add Information handoff;
- diagnosis;
- recommendation;
- strategy;
- root-cause conclusion.

Materiality and prioritisation were understandable. The only wording concern is the slightly overstated “no explicit reporting dates” statement described above.

Browser console warnings/errors after the completed reload: none.

## State integrity

After analysis:

- Workflow: `GAP_RESOLUTION_REQUIRED`, version 11
- Claims: 17
- Evidence: 11
- Metrics: 6
- Relationships: 4
- Snapshots: 3
- Snapshot 3 SHA-256: unchanged at `70dbd14b8f1ad7efe2dbb5f879ad70f2d68cc3088e9436395fb28a365f3702d2`
- Claims updated during the analysis: none
- New canonical snapshot: none
- Question-source links: 0

Transition history confirms:

```text
EVIDENCE_READY
→ RUN_GAP_ANALYSIS
→ GAP_ANALYSIS
→ MARK_ANALYSIS_COMPLETE
→ GAP_RESOLUTION_REQUIRED
```

Canonical Evidence State remained unchanged.

## Equivalent-run reuse

Reuse was invoked through the existing development server’s normal native server-action form mechanism.

Results:

- Same run ID: `94bc6f0d-2eed-4dc8-afc2-c064b2a98366`
- Equivalent run count remained: 1
- Start and completion timestamps remained unchanged
- No second `RUNNING` or `SUCCEEDED` run was created
- The existing completed result remained displayed
- The service’s equivalent-success short-circuit meant no second provider invocation occurred

Two auxiliary reuse-harness attempts failed before the valid native-form invocation:

- the local `tsx` runner encountered the known environmental `uv_os_get_passwd returned ENOMEM` failure;
- malformed direct server-action requests returned 404/500.

Neither attempt changed database state or created another run. The correctly encoded native action then succeeded with HTTP 303.

## Repository integrity

Worktree fingerprint before and after:

`d7adac9b034d14d96be9d924bdfcc830b56c16ba70bc1ee4167dd17edbfba1c8`

It was unchanged during the smoke test. No source, migration, test, or documentation file changed during the test itself.

HEAD remained:

`cbdff69 Implement Milestone 3B repeatable Add Information`

No commit was created.
