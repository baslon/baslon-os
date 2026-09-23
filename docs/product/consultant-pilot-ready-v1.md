# Baslon OS — Consultant Pilot Ready v1

**Status:** Definition for review. Not an implementation authorisation.
**Date:** 23 September 2026
**Product Owner decisions recorded:** 23 September 2026 — six decisions, **PO-1** to **PO-6**, in [§12](#12-product-owner-decisions).
**Question this answers:** what must Baslon OS be capable of before a real business consultant can meaningfully test the product end to end?

This document defines **two separate gates**. They must not be conflated.

```text
Gate A — Consultant Pilot Ready v1
A real consultant tests Baslon OS using Baslon Digital / controlled non-client data.

Gate B — Design Partner Data Ready
A genuine external business's confidential data may be introduced.
```

Gate A is a supervised product-validation milestone. Gate B is closer to production readiness. Everything in Gate B that protects other people's data is a **hard gate**, and nothing in this document defers it.

---

## 1. Where the product is today

Phase 1 is closed and proven once, end to end, on real business information. See [`current-status.md`](../current-status.md) and [`project-history/timeline.md`](../project-history/timeline.md).

| | |
|---|---|
| Workflow | `PHASE1_APPROVED` v21 |
| Approved diagnosis | `a4e4f0e0-3544-4650-95ee-f13d31b36517`, bound to Snapshot 4 `da6e9a8e-…` |
| Diagnosis | 14 items — 10 accepted, 4 corrected, 0 rejected |
| Evidence gaps | 6 unresolved — 4 High, 2 Medium |
| Deterministic calculations | 6 |
| Approved headline set | `b586678b-…` version 1 (reviewed presentation companion) |
| Diagnosis experience | Overview, Full Diagnosis, Evidence Gaps, Calculations, Audit & Provenance |
| Phase 2 | **NOT STARTED** |

The approved diagnosis is the analytical authority; the headline set is a reviewed presentation companion and never an analytical input.

The product's positioning, from [`product-commercial-context.md`](../product-commercial-context.md), is **consultant-led, software-assisted strategic diagnosis and planning**. That positioning is why this gate is defined around a consultant's workflow rather than a business owner's, and why Gate A can be validated with a supervised consultant before any authentication exists.

The intended client journey, from the same document, is:

```text
Discovery / Strategic Intent → Evidence Intake → Evidence Review → Evidence Quality / Gaps
→ Diagnosis → Diagnostic Review → Strategy Decisions → Strategic Growth Plan
→ 90-Day Execution Plan → Review / Recalibration
```

Baslon OS today covers that journey **up to and including Diagnostic Review**. Everything from *Strategy Decisions* onward does not exist. That is the gap Gate A must close.

The three client-facing outputs the product context names are **Strategic Diagnosis**, **Strategic Growth Plan** and **90-Day Execution Plan**. This document uses those names rather than inventing new ones.

---

## 2. Gate A — Consultant Pilot Ready v1

### Definition

> Baslon OS is **Consultant Pilot Ready v1** when a real business consultant, after a short orientation, can independently work through the Baslon Digital case: understand the evidence and the approved diagnosis, consider genuinely distinct strategic alternatives, make and record a human strategic decision, and finish with a Strategic Growth Plan and a 90-Day Execution Plan they could discuss with a business owner — **without a developer editing the database or manipulating workflow state at any point**.

The single hardest standard:

```text
No developer intervention is required to complete the intended consultant workflow.
```

Observation and note-taking by the Product Owner during the session is expected and allowed. Answering "what does this button do?" is allowed. Editing data, re-running a failed step by hand, or unsticking a workflow is **not** — each of those is a pilot failure to record, not a hiccup to smooth over.

### What Gate A deliberately is not

Consultant Pilot Ready v1 is **not** production launch, self-service SaaS readiness, real external client-data readiness, billing readiness, multi-consultant scale, final UI polish, proof of market demand, or proof that any AI recommendation is objectively correct.

It validates two things only: **can a consultant use it**, and **is it strategically useful**.

---

## 3. The minimum consultant journey

Ten steps. Steps 1–3 exist today; steps 4–10 do not.

### Step 1 — Enter and select the case

The consultant opens the Baslon Digital rebuild case (`a658df7e-…`, "Baslon Digital — Rebuild 2026 v2") and sees where it stands.

**Product Owner decision (PO-1):** the pilot runs against a **resettable copy of the approved Baslon Digital case, clearly labelled as a pilot/test Business**. It does **not** run against the live Baslon Digital rebuild Business. See §12.

The copy may be derived from Baslon's own approved data. It must be clearly labelled and must carry the same approved diagnosis structure, or the pilot tests something other than the real product. Cloning mechanics are not defined here.

**No genuine Design Partner data is introduced at Gate A.**

### Step 2 — Understand evidence quality and provenance

The consultant must be able to see what information supports the business picture, what is missing, and which parts are canonical evidence versus AI interpretation — **without reading database records, UUIDs or hashes**.

Mostly exists today: Evidence Quality surfaces, the Evidence Gaps view, and the Audit & Provenance view. The pilot tests whether it is *comprehensible*, not whether it exists.

### Step 3 — Understand the approved diagnosis

Using the five views, the consultant must be able to explain the current position, strengths, constraints, risks, opportunities, limitations and the strategic decisions required.

Exists today.

### Step 4 — Enter Phase 2

The consultant needs a system-supported way to move from an approved diagnosis into strategic consideration.

**Required product outcome** (not an architecture prescription):

- entry is only possible from an approved diagnosis that is still current;
- the strategy work is explicitly bound to that approved diagnosis, its run and its snapshot;
- entry is a deliberate human action, not an automatic consequence of approval;
- if the approved diagnosis were superseded, the system must not silently continue on stale analysis.

### Step 5 — Review strategic alternatives

The consultant considers a **small, bounded set of genuinely distinct strategic alternatives** derived from the approved diagnosis.

**Product Owner decision (PO-2):** the allowed range is **2–4 alternatives, with 3 as the normal target**. See §12.

The count follows the evidence, not the target. **No filler is generated merely to reach three.** Two is correct when only two materially distinct options are supportable; four is correct when the evidence genuinely supports four distinct strategic paths.

Each option needs enough structure for a consultant to judge it, not a paragraph of prose. Minimum per option:

- the strategic thesis, in one line a consultant could say aloud;
- which diagnosed constraint or opportunity it addresses, **linked to the approved diagnosis items**;
- the expected mechanism — why this would change the outcome;
- dependencies and prerequisites;
- supporting evidence, traceable to the approved diagnosis;
- assumptions it rests on;
- **which of the six unresolved evidence gaps materially affect it**;
- trade-offs, and what it forgoes;
- risks;
- resource and capacity implications, honest about the founder-capacity constraint recorded in the diagnosis;
- fit or conflict with stated founder and business goals.

**The system must not rank, score or pre-select options.** Ranking is the consultant's judgement; a score would quietly become the decision. This follows the existing rule that qualifiers are never truth weights.

### Step 6 — Human strategic decision

The consultant must be able to accept an option, reject an option, refine or combine options, record their rationale, name the assumptions they are accepting, and flag what must be validated before commitment.

This is the material strategic decision, and it is the human's. AI proposes; software validates; the consultant decides.

### Step 7 — Approved strategic direction

The decision produces an **approved strategic direction** — the strategy equivalent of the approved diagnosis.

Four things must remain distinguishable at all times, in the data and on screen:

```text
approved diagnosis        (already the analytical authority)
strategic option proposals (AI-proposed, unapproved)
human strategic decision   (what the consultant chose, and why)
approved strategic direction (the approved basis for planning)
```

**No strategy proposal may become an approved direction without an explicit human approval step.** This mirrors Phase 1: a successful generation stops at a review checkpoint, and only a human act creates the approved artifact.

### Step 8 — Strategic Growth Plan

Minimum consultant-usable content, drawn from the product context's own deliverable language:

- strategic direction (from the approved direction, not restated by a model);
- target customer focus;
- offer and value proposition direction;
- acquisition and growth approach;
- recurring-revenue direction, where relevant — it is a live issue in this diagnosis;
- capacity and operating implications;
- key assumptions;
- material gaps and risks, carried forward rather than resolved;
- success measures.

The plan must remain **coherent with, and traceable to, the approved diagnosis and the approved strategic direction**. The six evidence gaps travel with it as limitations, not as resolved questions.

### Step 9 — 90-Day Execution Plan

Minimum:

- objectives and outcomes for the period;
- initiatives and actions;
- owners (free text is acceptable at Gate A — there is no authentication yet);
- sequence;
- target dates or periods;
- measurable indicators;
- dependencies;
- evidence and assumptions requiring validation;
- review checkpoints.

**The AI must not silently commit the business to actions.** A generated plan is a proposal until a human approves it, exactly as with diagnosis and strategy.

### Step 10 — Consultant handoff

The consultant finishes with a reviewable output they could take into a conversation with a business owner.

**Minimum for Pilot v1: an on-screen artifact that reads coherently top to bottom**, plus the browser's own print view. **Formal PDF/export is DEFERRED** — the pilot's validation questions ("is this useful? would you use it with a client?") can be answered from a screen-shared or printed view, and building an export pipeline before knowing what the artifact should contain would be premature. Deferred explicitly, not forgotten: it becomes a Gate B / post-pilot item.

---

## 4. Capability matrix

Classification: **READY** · **BUILD BEFORE PILOT** · **HARD GATE BEFORE REAL CLIENT DATA** · **DEFER AFTER PILOT**

| Capability | Current status | Required for Pilot v1? | Required before real Design Partner data? | Reason | Blocking Pilot v1? |
|---|---|---|---|---|---|
| Business creation / case selection | Implemented | READY | Yes | Exists and is exercised | No |
| Information intake | Implemented | READY (not exercised in pilot v1) | Yes | Works; pilot v1 starts post-diagnosis | No |
| Evidence extraction | Implemented | READY | Yes | Proven across four sources | No |
| Human Evidence Review | Implemented (M4-11 complete) | READY | Yes | Reviewer sees everything Accept will persist | No |
| Snapshot creation | Implemented, immutable | READY | Yes | Four snapshots proven | No |
| Evidence Coherence | Implemented (`v4` / handles) | READY | Yes | Succeeded on Snapshot 4 | No |
| Gap handling | Implemented | READY | Yes | Six gaps carried, never silently resolved | No |
| Phase 1 Diagnosis | Implemented, run live once | READY | Yes | 14 items, contract enforced | No |
| Diagnosis human review | Implemented (M4-13) | READY | Yes | Reviewer sees effective items | No |
| Diagnosis approval | Implemented | READY | Yes | Immutable artifact, server-built | No |
| Consultant-readable Diagnosis UX | Implemented (five views) | READY — pilot tests comprehension | Yes | The thing the pilot most directly tests | No |
| Reviewed headlines | Implemented, set v1 approved | READY | No (nice to have) | Improves scanability | No |
| **Phase 2 entry** | **Does not exist** | **BUILD BEFORE PILOT** | Yes | No route from approved diagnosis to strategy | **Yes** |
| **Strategic option generation** | **Does not exist** | **BUILD BEFORE PILOT** | Yes | Step 5 is the core of the pilot | **Yes** |
| **Strategic-option provenance** | **Does not exist** | **BUILD BEFORE PILOT** | Yes | Options must trace to diagnosis items and gaps, or trust fails | **Yes** |
| **Option comparison** | **Does not exist** | **BUILD BEFORE PILOT** | Yes | A consultant must compare, not read serially | **Yes** |
| **Human strategic decision** | **Does not exist** | **BUILD BEFORE PILOT** | Yes | The material decision must be recorded and auditable | **Yes** |
| **Approved strategic direction** | **Does not exist** | **BUILD BEFORE PILOT** | Yes | Prevents a proposal becoming strategy silently | **Yes** |
| **Strategic Growth Plan** | **Does not exist** | **BUILD BEFORE PILOT** | Yes | A named client deliverable | **Yes** |
| **90-Day Execution Plan** | **Does not exist** | **BUILD BEFORE PILOT** | Yes | A named client deliverable | **Yes** |
| Consultant / client output | Partially (on-screen diagnosis views) | BUILD BEFORE PILOT (on-screen only) | Yes | Pilot needs a readable end artifact; export deferred | Yes (minimal form) |
| **Pilot fixture / resettable case** | **Does not exist** | **BUILD BEFORE PILOT** | No | A pilot must be repeatable and must not consume the live Phase 1 record | **Yes** |
| Onboarding / help text | Minimal | BUILD BEFORE PILOT (light) | Yes | "What do I do next?" is a measured pilot metric | Yes (light) |
| Error recovery / retry | Partial (analysis-run recovery exists) | BUILD BEFORE PILOT (Phase 2 paths) | Yes | A failed model call must not dead-end the consultant | Yes (for new paths) |
| User authentication | **None** (P-01) | DEFER AFTER PILOT — supervised, single operator, Baslon's own data | **HARD GATE** | Cannot hold another business's confidential data without it | No, at Gate A only |
| Reviewer / approver identity | Free text (P-03) | DEFER AFTER PILOT | **HARD GATE** | Approvals must be attributable to an authenticated actor | No, at Gate A only |
| Role permissions | None | DEFER AFTER PILOT | **HARD GATE** | Minimum roles needed once more than one party uses it | No, at Gate A only |
| Business / tenant data isolation | Structural only (P-02) | DEFER AFTER PILOT | **HARD GATE** | One client must not reach another's data | No, at Gate A only |
| Audit log | Partial (workflow transitions, analysis runs, approvals) | READY for Gate A | **HARD GATE** (needs authenticated actor) | Trail exists; the actor is not yet provable | No |
| Backup / restore | Minimum baseline (P-13 resolved) | READY | **HARD GATE** (needs more) | Verified restore point exists | No |
| Deployment rollback / forward-fix | **Not defined** | DEFER AFTER PILOT | **HARD GATE** | A bad migration against client data must be recoverable | No |
| Scheduled / offsite / encrypted backups | **Not defined** | DEFER AFTER PILOT | **HARD GATE** | A single local dump is not sufficient for client data | No |
| Incident handling | **Not defined** | DEFER AFTER PILOT | **HARD GATE** | Needed before holding external data | No |
| Deletion / retention policy | **Not defined** (P-14) | DEFER AFTER PILOT | **HARD GATE** | Obligations attach the moment real client data arrives | No |
| M4-03 evidence grounding | Open, non-blocking for Snapshot 4 | DEFER AFTER PILOT (pilot runs no new intake) | **HARD GATE — must be RESOLVED** | Restricted-intake workaround rejected by PO-3; see §6 | No |

**Counts across 35 capabilities:** READY **14** · BUILD BEFORE PILOT **12** · HARD GATE BEFORE REAL CLIENT DATA **11** · DEFER AFTER PILOT **9**. These exceed 35 because several capabilities appear in two columns — deferred for Gate A, hard gate for Gate B — which is precisely the point of separating the gates.

### How much must be built before Gate A can pass

To leave no ambiguity:

> **12 capabilities contain work that must be completed before Gate A can pass.**
> **Of those, 9 are primary blocking product outcomes and 3 are supporting requirements.**

The distinction is visible in the matrix's final column: a primary blocker reads **Yes**, a supporting requirement reads *Yes* with its qualifier.

| | Capabilities |
|---|---|
| **9 primary blocking product outcomes** | Phase 2 entry · strategic option generation · strategic-option provenance · option comparison · human strategic decision · approved strategic direction · Strategic Growth Plan · 90-Day Execution Plan · pilot fixture / resettable case |
| **3 supporting requirements** | consultant / client output (on-screen form only) · onboarding and help text (light) · error recovery and retry (new Phase 2 paths only) |

A supporting requirement is smaller in scope but **not optional**: Gate A cannot pass without it. The difference is that each is a bounded addition to work already being done, rather than a distinct product outcome in its own right.

**Eight of the nine primary blockers are Phase 2 strategy and planning work.** The ninth is the resettable pilot case. The entire evidence-to-diagnosis pipeline is READY.

---

## 5. What can remain deferred for Gate A

Keep the first pilot small. Each item below is deferred **because the pilot's validation questions can still be answered without it**.

| Deferred | Why the pilot still works |
|---|---|
| Polished multi-tenant account management | One consultant, one case, one supervised session |
| Billing / subscriptions | The pilot tests usefulness, not willingness to pay through the product |
| Self-service client portal | The business owner is not in the session; the consultant is |
| Fully automated onboarding | A short human orientation is part of the design |
| Scheduled emails / notifications | Nothing in the journey waits on an asynchronous prompt |
| Integrations / CRM | No external data source is needed to test strategy reasoning |
| Sophisticated reporting / PDF export | An on-screen artifact answers "would you use this with a client?" |
| Branding / theming | Aesthetics are not the validation question |
| Mobile optimisation | A consultant working a strategy session is at a desk |
| Complex team permissions | One operator; roles become a Gate B requirement |
| Phase 2 advanced scenario modelling | 2–4 structured alternatives is enough to test the decision experience |
| Portfolio-level consultant dashboards | Meaningless with one case |
| Automated KPI tracking after the 90-day plan | The pilot ends at plan creation; tracking is a later loop |

If the pilot fails, it must fail on *strategy comprehension and usefulness* — not on missing polish that was never the point.

---

## 6. Gate B — Design Partner Data Ready: hard gates

The moment a genuine external business's confidential information enters Baslon OS, a different standard applies. These are hard gates.

### Authentication and durable identity — HARD GATE

Today there is **no authentication** (P-01) and human authority is structural rather than identity-based (**P-03**): reviewer and approver identity is free text, so "David Demetrius" on an approval is a string, not a proven actor.

That is acceptable at Gate A — a supervised session, one operator, Baslon's own data — and **not acceptable** for another company's confidential information. Authentication and durable user identity are required before any genuine Design Partner data is introduced. There is no repository evidence supporting a safe alternative boundary.

### Authorisation and roles — HARD GATE, minimally

Minimum viable roles for first external use:

- **consultant** — runs the engagement: intake, review, diagnosis, strategy, planning;
- **admin** — Baslon-side operator: Business lifecycle, permanent delete, migrations.

**Product Owner decision (PO-4):** for the first Design Partner stage the minimum role model is **Admin + Consultant**. A **client-participant** login is **not required** unless the client themselves must sign in, and stays deferred until the product genuinely needs direct client interaction. See §12.

This decision reduces the number of roles. It does **not** reduce the requirement for authenticated identity, role enforcement, Business isolation or auditable approvals — all four remain hard gates.

Pilot v1 needs **no roles at all**, because there is one operator and the data is Baslon's.

### Business data isolation — HARD GATE

P-02 records no Business-level authorization. Isolation must be proven at the level of **routes, repository queries, server actions and any identifier supplied in a request** — not by UI navigation, and not by the fact that nobody has tried. The existing composite same-Business foreign keys are a strong structural foundation, but they constrain *writes*; read paths must be proven too.

### Audit identity — HARD GATE

Material approvals — diagnosis approval, strategic direction approval, plan approval, permanent delete (P-04) — must be attributable to an authenticated actor. The audit trail already exists; what it lacks is a provable person.

### Data handling — HARD GATE (product/operational decisions, not legal advice)

P-14 is undefined. Before external data: what is collected and why; how long it is retained; how a Design Partner's data is deleted on request and what that does to immutable artifacts and snapshots; who may access it; how an incident is handled and who is told. These are Product Owner decisions, and they need recording before, not after, the first client file arrives.

### Operational recovery — which P-13 leftovers become hard gates

| Still-open item | Gate B status | Reason |
|---|---|---|
| Scheduled backups | **HARD GATE** | A manual pre-change dump does not protect a live client engagement |
| Offsite / encrypted storage | **HARD GATE** | A single local dump shares the fate of the machine holding it, and client data should be encrypted at rest |
| Incident procedure | **HARD GATE** | Needed before someone else's data can be affected |
| Migration rollback / forward-fix | **HARD GATE** | A bad migration against client data must have a rehearsed path back |

### M4-03 — HARD GATE before genuine Design Partner intake

**Product Owner decision (PO-3): M4-03 must be RESOLVED before the first genuine Design Partner intake cycle.** The restricted-intake workaround is **not** to be relied on for the first genuine Design Partner. See §12.

M4-03 remains **unresolved today**, and this document does not resolve it. It is now a Gate B hard gate rather than a choice between two routes.

The reasoning is in the finding's own disposition. Snapshot 4 was exempt because the controlled rebuild **never admitted canonical data through the question-context path**: all seven extraction runs used `evidence_extractor_v6`, with **0** `v7` runs and **0** `analysis_question_sources` links. Every source arrived through initial intake or standalone Add Information, with human review.

A Design Partner engagement is different by design. The product's own journey routes through Evidence Quality and gap resolution, where the system surfaces questions and the client answers them — which is exactly the path M4-03 concerns. Claims and descriptive fields still lack deterministic grounding against question contamination, so on a real client engagement the exemption that protected Snapshot 4 does not hold.

**Why resolution, and not the restricted path:**

- a real Design Partner engagement should validate the **intended** Evidence Quality and gap-resolution journey;
- a restricted intake route would bypass part of the very workflow the first real engagement exists to test;
- Snapshot 4's exception was **bounded to the controlled Baslon cycle** and does not become the default policy for external data.

Resolution means deterministic grounding for Claims and descriptive fields, per the finding's own required work. The restricted-intake path is recorded here only as the rejected alternative, so that nobody later mistakes it for an approved fallback.

Drifting into the restricted path informally — using the question path while assuming the Snapshot 4 exemption still applies — is the outcome to avoid.

---

## 7. The first consultant pilot

### Participant

**Product Owner decision (PO-5):** **one experienced external business consultant, under NDA.** See §12.

Selection characteristics:

- experienced enough to challenge strategic conclusions;
- not involved in designing Baslon OS;
- comfortable reviewing a real SME case;
- able to explain where the system helps or hinders professional judgement.

**The NDA is a Pilot v1 operating requirement**, because the Baslon Digital case contains genuine business and financial information. It is not drafted here.

Note the distinction this creates: the consultant is **external**, but the data is **Baslon's own**. That is why an NDA is required and production authentication is not — see the operational boundary below.

### Consultant access — operational boundary, not production authentication

The consultant is external, so they need a way to work with the application. Gate A meets that with an **operational boundary**, not by building authentication:

- the session is **supervised** — the Product Owner is present throughout;
- it runs against the **clearly labelled resettable pilot Business** (PO-1), never the live rebuild Business;
- the environment contains **no genuine Design Partner data**;
- access ends when the session ends.

This is sufficient **only** because the data is Baslon's own and the session is supervised. It is not a model for external client data, where authentication becomes a Gate B hard gate.

### Preparation

A short orientation only: what Baslon OS is for, what the case is, what the five diagnosis views are, and what they are being asked to do. **They must not be told the "right" strategic conclusion**, or the session measures agreement rather than usefulness.

### Starting point — from the approved diagnosis

The pilot starts from the **approved Baslon Digital diagnosis state**, on the resettable pilot copy (PO-1). The untested part of the product is Phase 2 strategy and planning; the evidence pipeline has already been proven end to end on this exact case, and re-running it would consume most of a session re-proving closed work.

This leaves the earlier journey — intake, Evidence Review, evidence quality, gap handling — untested by a consultant's eyes. **Product Owner decision (PO-6) addresses that: Pilot v2 is planned**, and starts earlier in the journey.

### Required tasks

Given without coaching, in the consultant's own words:

1. Orient yourself to this business. What does it do, and how is it performing?
2. What are the most important issues facing it?
3. What important information is missing, and what does that prevent you concluding?
4. Pick a finding you doubt. Show me what it rests on.
5. Move into strategic options.
6. Compare the alternatives. What are the real trade-offs?
7. Decide a strategic direction, refining or combining options if you want. Record why.
8. Review and adjust the Strategic Growth Plan.
9. Review and adjust the 90-Day Execution Plan.
10. Present the plan back, as if presenting to this business's owner.

### Expected output

An approved strategic direction, a Strategic Growth Plan and a 90-Day Execution Plan, all traceable to the approved diagnosis, with the consultant's decisions and rationale recorded and the six evidence gaps still visible as limitations.

### Pilot v1 and Pilot v2 (PO-6)

Two distinct validation stages, both using Baslon-controlled data. **Only Pilot v1 is gated by this document.**

| | **Pilot v1** | **Pilot v2** |
|---|---|---|
| **Purpose** | Validate consultant understanding of the approved diagnosis, **and** validate Phase 2 strategy/planning usefulness and usability | Validate the earlier consultant journey: intake → Evidence Review → evidence quality → gap handling → diagnosis |
| **Starting point** | Resettable copy of the approved Baslon Digital diagnosis state | Earlier in the journey, at intake |
| **Data** | Baslon-controlled | Baslon-controlled |
| **Gated by this document?** | **Yes** — Gate A | **No** |

**Pilot v2 is not required to pass Consultant Pilot Ready v1.** It is a planned follow-on validation stage, to run after Pilot v1 findings are incorporated and, where practical, **before genuine Design Partner intake**. It is not an implementation milestone, and this document does not scope it.

---

## 8. Pilot success criteria

### Usability

- The consultant completes the journey with **zero developer interventions**.
- At each stage they know what to do next without being told.
- No dead-end: every state offers a next action or an explicit, understandable stop.
- No database or manual workflow manipulation at any point.
- Irreversible actions (approve a direction, approve a plan) are recognisable as irreversible *before* they are taken.

### Comprehension

Unprompted, the consultant can correctly distinguish: **evidence · AI interpretation · known gap · derived calculation · human-approved diagnosis · proposed strategy · human-approved strategy**. Confusing an AI proposal with an approved decision is a **critical** failure, not a usability nit.

### Trust

They can answer: *Why is the system telling me this? What evidence supports it? What is uncertain? What here is an AI proposal versus a human decision?*

### Strategic usefulness

The consultant's own judgement on whether the diagnosis is credible and useful; whether the alternatives are **meaningfully distinct** rather than three phrasings of one idea; whether trade-offs are visible; whether the system improved their structured thinking; whether it **supported rather than replaced** their judgement; and whether the resulting plan would be useful in a client conversation.

### Output quality

The Growth Plan and 90-Day Plan are coherent with the approved diagnosis, traceable to human decisions, explicit about assumptions and gaps, specific enough to act on, and editable before approval.

### Reliability

No data corruption; no workflow dead end; **no silent AI-to-authority transition**; no accidental live-data mutation outside intended actions; and a model or application failure leaves a recoverable, understandable state.

---

## 9. Observation sheet

Manual observation is sufficient for a supervised first test. Do not build analytics instrumentation for this.

| Metric | How recorded |
|---|---|
| Task completion (per task, 1–10) | Completed / completed with help / not completed |
| Time per major stage | Diagnosis comprehension · options · decision · growth plan · 90-day plan |
| "What do I do next?" moments | Count, with where it happened |
| **Developer interventions** | Count — **target zero**; any occurrence is a Gate A failure |
| Misunderstood labels or concepts | Count and the exact wording that confused |
| Evidence / provenance consulted | Count and which view |
| Strategy proposals materially changed by the consultant | Count — **zero is a warning sign**: it may mean the consultant is deferring to the machine |
| Critical usability defects | List |
| Non-critical friction | List |
| Confidence / usefulness rating | 1–5, with reasoning |
| "Would you use this with a client?" | Yes / no, and **why** |

---

## 10. Exit criteria

### Gate A — Consultant Pilot Ready v1 (binary)

```text
[ ] Phase 2 architecture approved by the Solution Architect and Product Owner
[ ] Phase 2 entry exists from an approved, current diagnosis, bound to its run and snapshot
[ ] 2-4 strategic alternatives generated (normal target 3), each traceable to approved
    diagnosis items and affected gaps, with no filler generated to reach the target
[ ] Options are comparable side by side, and are not ranked, scored or pre-selected by the system
[ ] Human strategic decision (accept / reject / refine / combine) is persisted with rationale and assumptions
[ ] An approved strategic direction exists, distinct from proposals, created only by explicit human approval
[ ] A Strategic Growth Plan exists, coherent with and traceable to the approved direction
[ ] A 90-Day Execution Plan exists, editable and human-approved before it is final
[ ] The end artifact is readable on screen, coherent top to bottom
[ ] The consultant can complete the whole journey with no developer state manipulation
[ ] A stable, resettable Baslon Digital pilot case exists, separate from the live Phase 1 record
[ ] Failure of a Phase 2 model call leaves a recoverable state with a clear next action
[ ] All existing Phase 1 integrity tests still pass (unit, integration, PostgreSQL against baslon_os_test)
[ ] The approved Phase 1 diagnosis and its artifact remain unmutated by any Phase 2 work
[ ] No critical or blocking UX defect
[ ] No critical authority-confusion defect: an AI proposal is never mistakable for an
    approved human decision
[ ] No silent authority escalation by AI anywhere in the new flow
[ ] Light in-product guidance exists at each new stage
[ ] Pilot script and observation sheet exist and have been dry-run once internally
[ ] One experienced external business consultant identified, not involved in designing
    Baslon OS (PO-5)
[ ] NDA in place covering the Baslon Digital case, which contains genuine business and
    financial information (PO-5)
[ ] Consultant access operational boundary agreed: supervised session, resettable pilot
    Business, no genuine Design Partner data present
```

**Consultant Pilot Ready v1 = YES only if every box is ticked.**

**Authentication is deliberately not a Gate A blocker**, even though the consultant is external. The pilot is supervised, runs on a clearly labelled pilot Business, and contains only Baslon-controlled data; the operational boundary in §7 covers it. Authentication is a Gate B hard gate, and inventing production authentication for Pilot v1 would be building Gate B work under a Gate A label.

### Gate B — Design Partner Data Ready (binary, stricter)

```text
[ ] Authentication implemented
[ ] Durable user identity, replacing free-text reviewer/approver strings (P-03, P-01)
[ ] Role/permission enforcement — minimum: Admin + Consultant (PO-4)
[ ] Client-participant role: deferred unless the client themselves must sign in (PO-4)
[ ] Business/tenant data isolation proven at routes, queries, actions and supplied identifiers (P-02)
[ ] Material approvals attributable to an authenticated actor (P-03, P-04)
[ ] Privacy and data-handling decisions documented (P-14)
[ ] Deletion and retention path defined, including its effect on immutable artifacts and snapshots
[ ] Production backup policy sufficient for external data — scheduled, not manual
[ ] Offsite and encrypted backup storage
[ ] Incident procedure defined and rehearsed
[ ] Migration rollback / forward-fix procedure defined and rehearsed
[ ] M4-03 RESOLVED before the first genuine Design Partner intake cycle (PO-3).
    The restricted intake path is NOT an approved fallback
[ ] Full regression, including PostgreSQL integrity and business-isolation tests
[ ] No known critical production blocker outstanding
[ ] Design Partner agreement covering data handling in place
```

**Gate B is not reached by passing Gate A.** They are independent, and Gate B is the stricter of the two.

---

## 11. What this gate means for Phase 2

This section is the input to the next Phase 2 Architecture and Entry Design task. It states **product requirements**, not schema.

### Phase 2 MUST HAVE before Pilot v1

1. **Phase 2 entry** from an approved, current diagnosis, with a staleness guard — bound to `approvedDiagnosisId`, the diagnosis run and the snapshot, per the recorded entry boundary.
2. **Strategic option generation** — **2–4 bounded, genuinely distinct alternatives, normal target 3** (PO-2), derived from the approved diagnosis, validated deterministically before persistence, failing closed like every other AI contract in the product. No filler to reach the target.
3. **Option provenance** — each option traceable to the approved diagnosis items it addresses and the evidence gaps that limit it. Without this, the consultant cannot answer "why is the system telling me this?"
4. **Option comparison** — a surface where alternatives can be judged against each other, with trade-offs visible and **no system ranking or scoring**.
5. **Human strategic decision** — accept, reject, refine, combine; rationale, assumptions and validation flags persisted and auditable.
6. **Approved strategic direction** — an immutable approved artifact, created only by explicit human approval, structurally distinct from proposals, in the same pattern as the approved diagnosis.
7. **Strategic Growth Plan** — generated as a proposal, human-reviewed and approved, traceable to the approved direction, carrying assumptions and gaps forward.
8. **90-Day Execution Plan** — objectives, initiatives, owners, sequence, dates, indicators, dependencies, validation needs and checkpoints; editable and human-approved; **never auto-committing the business to actions**.
9. **A readable end artifact**, on screen.
10. **A resettable pilot case** — a clearly labelled copy of the approved Baslon Digital case (PO-1), so the pilot can be run more than once without accumulating test strategy records on the live Phase 1 Business.
11. **Recoverable failure** in every new model-calling path.

### Phase 2 SHOULD HAVE if low-cost

- Light in-product guidance at each new stage (also listed in Gate A exit criteria — cheap, and it directly affects the "what do I do next?" metric).
- Reusing the existing disclosure and review-card patterns rather than inventing new interaction models.
- A visible thread from any plan item back to the diagnosis item that motivated it.

### Phase 2 DEFER

- Scenario modelling, sensitivity analysis and quantified forecasting.
- Multi-option portfolio views across several businesses.
- Automated KPI tracking and the review/recalibration loop after the 90-day plan.
- Formal export/PDF generation.
- Client-facing self-service views.

### Constraints Phase 2 inherits and must not weaken

The approved diagnosis remains the analytical authority; a headline is never an analytical input. Gaps stay gaps. Calculations stay derived. Qualifiers never become truth weights. AI never approves its own output. Snapshots and approved artifacts stay immutable. Every material write locks and rechecks the active Business. Nothing is written back to canonical evidence.

---

## 12. Product Owner decisions

These six decisions were taken by the Product Owner on 23 September 2026. They are **decisions, not recommendations**, and they govern the gates defined above.

### PO-1 — Pilot case handling

**The consultant pilot runs against a resettable copy of the approved Baslon Digital case, clearly labelled as a pilot/test Business. It does not run against the live Baslon Digital rebuild Business.**

Because Phase 2 strategy artifacts may be intentionally immutable or approval-bound; the consultant must be free to make real strategic decisions during the pilot; the pilot must be repeatable; and the live approved Phase 1 Business should not accumulate test strategy records.

The copied case may be derived from Baslon's own approved data. Cloning mechanics are **not** defined by this document. *Applied in §3 Step 1, the capability matrix, and the Gate A checklist.*

### PO-2 — Number of strategic alternatives

**Allowed range 2–4 strategic alternatives; normal target 3.**

No filler is generated merely to reach three. Two is acceptable when only two materially distinct options are supportable; four is acceptable where the evidence genuinely supports four distinct strategic paths. **The system must not rank, score or automatically select a winner.**

This shapes the later Phase 2 generation contract. **No contract implementation is authorised now.** *Applied in §3 Step 5, §11 and the Gate A checklist.*

### PO-3 — M4-03 before genuine Design Partner intake

**M4-03 must be RESOLVED before the first genuine Design Partner intake cycle.** The restricted-intake workaround is not to be relied on for the first genuine Design Partner.

Because a real Design Partner engagement should validate the intended Evidence Quality and gap-resolution journey; a restricted intake route would bypass part of the workflow the first real engagement should test; and Snapshot 4's exception was bounded to the controlled Baslon cycle and does not become the default external-data policy.

M4-03 is **not resolved by this document** and remains open today. *Applied in §6, the capability matrix, and the Gate B checklist.*

### PO-4 — Gate B role model

**Minimum role model for the first Design Partner stage: Admin + Consultant.** A client-participant login is not required unless the client themselves must sign in, and stays deferred until the product genuinely needs direct client interaction.

This does **not** reduce the requirement for authenticated identity, role enforcement, Business isolation or auditable approvals. *Applied in §6 and the Gate B checklist.*

### PO-5 — First pilot consultant and NDA

**One experienced external business consultant, under NDA.**

Selection: experienced enough to challenge strategic conclusions; not involved in designing Baslon OS; comfortable reviewing a real SME case; able to explain where the system helps or hinders professional judgement.

The NDA is a **Pilot v1 operating requirement**, because the Baslon Digital case contains genuine business and financial information. The NDA is **not** drafted by this document. *Applied in §7 and the Gate A checklist.*

### PO-6 — Pilot v2

**Pilot v2 is planned.** Pilot v1 starts from the approved Baslon Digital diagnosis and primarily validates diagnosis comprehension plus Phase 2 strategy and planning. Pilot v2 begins earlier in the journey — intake and Evidence Review — using Baslon-controlled data, before any genuine Design Partner data is introduced.

**Pilot v2 is not required to pass Consultant Pilot Ready v1.** It is a planned follow-on validation stage, not an implementation milestone. *Applied in §7.*

---

## 13. Non-goals

Consultant Pilot Ready v1 is **not**: production launch · self-service SaaS readiness · real external client-data readiness · billing readiness · multi-consultant scale readiness · final UI polish · proof of market demand · proof that AI recommendations are objectively correct.

It validates consultant usability and strategic usefulness. Nothing more, and nothing less.
