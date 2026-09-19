# Baslon OS — Product & Commercial Context

**Purpose:** Provide Claude Code with concise product and commercial context that is not fully inferable from the repository implementation.

This document is **context, not an engineering specification**.

Do not treat pricing, ICP ranges, sector examples, commercial assumptions or validation targets in this file as hard-coded product rules unless an approved build brief explicitly requires that behaviour.

For engineering and domain rules, follow:

- `AGENTS.md`
- `docs/domain-invariants.md`
- `docs/ai-boundaries.md`
- the active build brief
- the current architectural handoff
- the Consolidated Code Review Findings Register

---

# 1. Product Positioning

Baslon OS is an **evidence-led business diagnosis and strategy system**.

Near-term delivery is:

> **Consultant-led, software-assisted strategic diagnosis and planning.**

The client is buying:

- strategic clarity;
- a structured diagnosis;
- prioritised strategic decisions;
- a practical execution plan.

The software exists to make that process:

- more rigorous;
- more repeatable;
- more evidence-based;
- more traceable;
- more auditable;
- more scalable over time.

Baslon OS should not initially be positioned as self-service SaaS.

---

# 2. Client-Facing Outcome

The intended client engagement can produce three main outputs:

1. **Strategic Diagnosis**
2. **Strategic Growth Plan**
3. **90-Day Execution Plan**

The broader client journey is:

**Discovery / Strategic Intent**\
→ Evidence Intake\
→ Evidence Review\
→ Evidence Quality / Gaps\
→ Diagnosis\
→ Diagnostic Review\
→ Strategy Decisions\
→ Strategic Growth Plan\
→ 90-Day Execution Plan\
→ Review / Recalibration

The objective is not merely to produce a report.

The system should help the client understand:

- what is actually known;
- what remains uncertain;
- where evidence is weak;
- which problems are symptoms;
- which constraints matter most;
- what should be prioritised;
- what should happen next.

---

# 3. Initial Ideal Customer Profile

The initial ICP is deliberately narrower than “all SMEs”.

## Primary ICP

**Established, owner-led UK service businesses**

Typical characteristics:

- approximately **3–50 employees**;
- approximately **£250k–£5m turnover**;
- established trading history;
- enough activity to generate meaningful business evidence;
- beyond basic startup survival;
- owner or leadership team still materially involved;
- growth is inconsistent, stalled or becoming harder to manage;
- priorities are unclear, competing or fragmented;
- leadership needs clarity on what to fix first.

Likely early sectors include:

- facilities management;
- cleaning / property services;
- trades;
- professional services;
- consultancies;
- agencies;
- other established service businesses.

Strong early prospects are businesses where:

- customer value is meaningful;
- decisions have material financial consequences;
- enough complexity exists to justify diagnosis;
- evidence exists but is fragmented;
- management has multiple possible priorities;
- the owner wants stronger strategic clarity;
- leadership is willing to share real business information.

---

# 4. Why the Initial ICP Is Narrow

The long-term platform may support many more SME types.

The initial market should remain narrower because targeting every SME too early would weaken:

- messaging;
- qualification;
- diagnostic assumptions;
- product learning;
- sales efficiency;
- case-study relevance.

The working commercial principle is:

> **Validate deeply with a narrower market first, then expand based on evidence.**

Do not encode the current ICP ranges or sectors as permanent architectural constraints unless explicitly required.

---

# 5. Design Partner Strategy

Baslon OS should be validated with **real paying Design Partners**, not only internal users or free beta testers.

A Design Partner is a client who:

- has a genuine business problem;
- pays for the engagement;
- works closely through the evolving process;
- provides genuine commercial and operational evidence;
- gives structured feedback;
- accepts that parts of the workflow are still being refined.

A Design Partner is not simply a discounted customer.

The relationship should help validate:

- the workflow;
- the value proposition;
- the diagnosis;
- the client deliverables;
- the amount of consultant involvement required;
- which evidence matters most;
- which parts can later be standardised;
- which parts can safely be automated;
- willingness to pay;
- whether ongoing recalibration has recurring value.

---

# 6. Initial Design Partner Offer

Current commercial assumptions are:

## Design Partners 1–3

**£2,500 + VAT**

Proposed payment structure:

- 50% to start;
- 50% on delivery.

Indicative engagement:

- approximately **4–6 weeks**;
- approximately **5–7 leadership hours** from the client.

Possible deliverables:

- review of business evidence;
- evidence-quality assessment;
- identification of weak or missing evidence;
- review of gaps, contradictions and assumptions;
- structured business diagnosis;
- leadership workshop/review;
- strategic direction;
- 90-day plan;
- 30-day follow-up review.

## Design Partners 4–5

Proposed pricing test:

**£3,500 + VAT**

## Potential Ongoing Offer

Possible quarterly strategic recalibration:

**£750 + VAT**

These figures are validation assumptions.

They are **not engineering constants** and must not be embedded into core domain logic unless a future approved requirement explicitly calls for it.

---

# 7. Design Partner Qualification

A strong Design Partner should ideally:

- fit the initial ICP;
- have been trading long enough to provide meaningful evidence;
- have enough complexity that strategy is non-trivial;
- have an owner or MD willing to engage personally;
- be willing to provide financial, sales, marketing and operational information;
- have genuine strategic uncertainty;
- have multiple competing priorities;
- be prepared to act after diagnosis;
- give candid feedback;
- understand that the product/process is evolving.

Avoid prioritising businesses that are:

- too early-stage to have meaningful evidence;
- seeking only a website build;
- unwilling to share information;
- looking mainly for free consultancy;
- unable to involve the real decision maker;
- too large or complex for the current product to model realistically.

---

# 8. Design Partner Validation Goals

Early validation should measure more than whether the software functions.

Important questions include:

- Will businesses pay for the process?
- Does the evidence workflow surface useful information the owner had not properly structured?
- Does Evidence Quality identify genuinely important uncertainties?
- Does the diagnosis feel accurate and useful?
- Does it expose root causes rather than obvious symptoms?
- Does the client leave with clearer priorities?
- Does the process result in real decisions?
- Does the 90-day roadmap feel actionable?
- Which parts require consultant judgement?
- Which parts can be standardised?
- Which parts can be automated safely?
- Will the client return for recalibration?
- Will the client recommend the process?

An early commercial validation target discussed was broadly:

- test the proposition with around **5 prospects**;
- secure around **3 paid engagements**;
- see whether at least **2 continue into review/recalibration**.

These are validation targets, not permanent KPIs.

---

# 9. Baslon Digital as Business #001

Baslon Digital is the first real business going through the system.

It serves as:

- the internal proving ground;
- a realistic workflow benchmark;
- the first diagnosis case;
- the first strategy case.

Baslon should go through the same underlying workflow as future clients.

It must not receive hidden special-case product behaviour.

Known strategic context for Baslon includes:

- established UK digital agency / consultancy;
- founder-led;
- website, SEO, CRO, automation and custom-development capability;
- desire to move toward more strategic/architecture work;
- desire for fewer, higher-value client relationships;
- interest in stronger recurring revenue;
- desire to reduce fragmented ad-hoc delivery;
- need to improve positioning, offer structure, capacity and owner dependency.

---

# 10. Founder / Business-Model Constraint

The Product Owner does not want Baslon OS to create another business that depends on large amounts of low-value founder delivery.

The desired operating model should move toward:

- high-leverage strategic work;
- repeatable methodology;
- software-supported analysis;
- selective delegation;
- fewer higher-value client relationships;
- recurring strategic review;
- a working model compatible with approximately a **3-day / 30-hour week**.

This should inform commercial/product thinking.

It should **not** be translated into arbitrary software rules unless explicitly required.

---

# 11. Standard Offer Direction

A later standard commercial offer discussed for a more mature Baslon OS engagement was:

**£3,950 + VAT**

Indicative deliverables may include:

- evidence gathering;
- structured diagnosis;
- strategic priorities;
- recommended direction;
- 12-month objectives;
- 90-day roadmap;
- presentation/review session.

This price is not fixed product logic.

It is part of ongoing commercial validation.

---

# 12. Long-Term Market Direction

The long-term ambition may extend beyond the initial service-business ICP.

A mature Baslon OS could potentially serve a broad range of UK SMEs.

However, the architecture should not assume every SME has identical needs.

The preferred product approach is:

- build an opinionated, strong initial workflow;
- validate it with real clients;
- learn where the model generalises;
- introduce configurability only where evidence justifies it;
- avoid premature generic abstraction.

The launch ICP is intentionally narrower than the possible long-term market.

---

# 13. Funding Context

Seed funding has been discussed.

The present strategic priority is **validation before fundraising**.

Important proof points include:

- a useful product;
- real Design Partners;
- willingness to pay;
- repeatable delivery;
- demonstrated client value;
- clearer evidence of scalability.

Funding should not substitute for proving the product and commercial model.

---

# 14. Commercial Principle for Engineering

When working on product features, remember:

> The client buys better strategic decisions and clearer execution priorities.\
> They do not primarily buy access to software.

Software should therefore strengthen:

- evidence quality;
- reasoning quality;
- consultant leverage;
- repeatability;
- trust;
- auditability;
- decision clarity.

Avoid adding features merely because they make Baslon OS resemble conventional SaaS.

---

# 15. Future Product Direction

A related future concept is a Baslon AI Website Designer using Baslon OS strategic information.

Possible future flow:

**Baslon OS business understanding**\
→ ICP / pains / value proposition / goals / evidence\
→ conversion architecture\
→ page architecture\
→ copy direction\
→ visual direction\
→ structured website specification\
→ controlled build\
→ human QA

This is **not part of the current Baslon OS core milestone**.

Do not let it expand current scope unless an approved brief explicitly introduces it.

---

# 16. How Claude Code Should Use This Document

Read this file when a task touches:

- ICP;
- Design Partners;
- onboarding;
- client workflow;
- client-facing deliverables;
- pricing;
- product positioning;
- commercial validation;
- market expansion;
- consultant involvement;
- strategic outputs.

Do not use this document to override:

- `AGENTS.md`;
- domain invariants;
- AI boundaries;
- the active build brief;
- the current architecture;
- the Consolidated Code Review Findings Register.

Commercial context explains **why** the product is being built.

The repository's engineering and domain documentation determines **how** it must be built.
