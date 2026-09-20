# M4-11 Architectural Analysis — Qualifiers Committed on Accept Without Being Shown

**Prepared for:** Solution Architect / Product Owner\
**Prepared by:** Engineer (Claude Code)\
**Date:** 19 September 2026\
**Mode:** inspection only. No code changes, no writes to `baslon_os`, no S2 processing, no commit or push.\
**Repository:** `7997f50`, working tree clean\
**Rebuild Business inspected:** `9aec14e1-4eae-47cd-9ddd-d43d8d26d8de` (Baslon Digital — Rebuild 2026), S1 run `40eb29f2-714b-4559-bdfe-27470bf0f9f3`

---

## Summary

Accept persists the **entire** proposal payload to canonical state, but the review card shows only part of it.

**On a pending card, the reviewer currently sees:**

- the headline (statement, Metric label or relationship type);
- Claim type, confidence level and materiality;
- the source excerpt;
- the numeric value, range and precision;
- for relationships, the two endpoints and `strengthScore`.

**Everything else is persisted unseen.** Several unseen fields are:

- semantically material, AI-authored free text with no controlled vocabulary (B-09);
- consumed by Evidence Coherence;
- later displayed on the Evidence State page labelled "Human reviewed".

M4-11 is **broader than recorded**. The register lists four fields; the actual hidden set covers Claims, Evidence and Metrics, and includes AI-authored provenance text (see Finding N-1).

**All 33 S1 Claims, Evidence records and Metrics were accepted with hidden fields.** Only the 11 relationships were fully visible. None of the S1 hidden values is factually wrong against the source, but several are debatable judgements that a reviewer never saw.

**Recommended fix:**

1. Show every persisted field on the card before Accept.
2. Make the AI-authored semantic fields that can't currently be corrected correctable.
3. Stamp new review lineage with the review-card version.
4. Derive an honest "qualifiers not shown at review" label for older records, without rewriting them.

**Recommended S1 disposition:** rebuild S1 after the fix, subject to the Product Owner's decision in §8.

---

## 1. Fields Persisted From Proposals but Not Visible Before Accept

| Proposal type | Persisted canonical field | Visible on pending card? | Correctable? | Consumed by Evidence Coherence projection? |
|---|---|---|---|---|
| **Claim** | `statement`, `claimType`, `confidenceLevel` | yes | yes | statement, claimType |
| | `subjectArea` | **no** | yes (hidden behind "Correct proposal") | **yes** |
| | `confidenceScore` | **no** | yes | no |
| | `confidenceBasis.basis` (AI-written rationale) | **no** | yes | no |
| | `sourceType` | **no** | no | no |
| **Evidence** | `statement`, `valueNumeric`/precision/bounds, `materiality`, `sourceExcerpt` | yes | yes (excerpt: no) | yes |
| | `unit` | only inside the formatted numeric value; **no** for qualitative Evidence | yes | yes |
| | `evidenceType` | **no** | **no** | no |
| | `valueText` | **no** | yes | **yes** |
| | `periodStart` / `periodEnd` | **no** | yes | **yes** |
| | `reliabilityLevel` | **no** | yes | **yes** |
| | `reliabilityScore` | **no** | yes | no |
| | `directnessLevel` | **no** | yes | **yes** |
| | `recencyLevel` | **no** | yes | **yes** |
| | `sourceType`, `sourceReference` | **no** | **no** | **yes** |
| | `sourceMetadata.suppliedBy`, `sourceMetadata.notes` (AI-written) | **no** | **no** | no |
| | `rawPayload.excerpt` | **no** | no | no |
| **Metric** | `metricLabel`, value/precision/bounds, `unit` (in the formatted value) | yes | yes | yes |
| | `metricKey` | **no** | yes | **yes** |
| | `periodStart` / `periodEnd` | **no** | yes | **yes** |
| | `dimensionData` (dimension / value) | **no** | **no** | no |
| | `sourceEvidenceRef` → `source_evidence_id` (which Evidence it derives from) | **no** | no (by design) | **yes** |
| **Relationship** | Claim and Evidence (as statements), `relationshipType`, `strengthScore` | yes (R-13) | type and strength | yes |

Two further points:

- **Correction form only:** fields marked "yes (hidden behind…)" are visible only if the reviewer opens **Correct proposal**. Opening it doesn't commit anything, but nothing on the card signals that these values exist.
- **Deterministic additions:** at persistence, the service adds lineage (`evidenceReview`: session, run, proposal and reviewer IDs), `rawPayload.extractionRunId`/`proposalId`, and `sourceMetadata.sourceExcerpt`. These are application-derived and correct; they are not a review concern.

## 2. Proposal Types Affected

| Type | Affected | Hidden material fields |
|---|---|---|
| Claims | **yes** | subjectArea, confidenceScore, confidenceBasis, sourceType |
| Evidence | **yes** (most affected) | evidenceType, valueText, unit (qualitative), period, reliability level/score, directness, recency, sourceType/Reference, sourceMetadata |
| Metrics | **yes** | metricKey, period, dimensionData, source-Evidence link |
| Relationships | **no** | none (fully visible since R-13) |
| Others | no other proposal types exist; Business identity fields are entered by the human directly | — |

## 3. Classification of the Hidden Fields

| Field | Semantically material | Presentation only | Derived / deterministic | AI-proposed |
|---|---|---|---|---|
| Evidence `reliabilityLevel`/`Score`, `directnessLevel`, `recencyLevel` | **yes**: epistemic qualifiers, used by coherence, a diagnosis-weighting risk (M4-06) | — | — | **yes**, free text, no vocabulary (B-09) |
| Claim `confidenceScore` | **yes**: numeric weight a diagnosis may misuse (M4-06) | — | — | **yes** |
| Claim `confidenceBasis.basis` | moderately: the rationale shown later in the audit view | — | — | **yes** |
| Claim `subjectArea` | **yes**: groups Claims by domain, in the coherence input | — | — | **yes**, free text |
| Evidence/Metric `periodStart`/`End` | **yes**: time-bounds the fact | — | — | **yes** (validated only for order) |
| Evidence `valueText`, `unit`; Metric `metricKey`, `dimensionData` | **yes** (unit, dimension); **low** (valueText, key) | partly (key, valueText) | — | **yes** |
| Evidence `evidenceType` | low–moderate (classification, e.g. `data_gap`) | partly | — | **yes** |
| Metric source-Evidence link | **yes** (derivation and H1) | — | validated against accepted Evidence | **yes** (ref) |
| Evidence `sourceMetadata.notes` | moderately: AI-written context stored as source metadata | — | — | **yes** |
| `sourceType`, `sourceReference`, `sourceMetadata.suppliedBy` | **yes**: provenance | — | should be, but **are not** (see N-1) | **yes**, echoed by the model |
| `rawPayload.excerpt` | no | — | equals the validated `sourceExcerpt` | echoed |

**New finding N-1: provenance is model-authored.** Evidence `sourceType`, `sourceReference` and `sourceMetadata.suppliedBy`/`notes` are persisted from the **model's output**, not set by the application from the run.

- In S1 the model echoed the correct values, and `suppliedBy` is `human_ui` on every Evidence record.
- But the validator doesn't check them against the extraction run, so a model could write arbitrary provenance into canonical Evidence.
- This touches the "source provenance" principle directly. It should be fixed alongside M4-11: set provenance fields from the run, not the model.

## 4. S1 Proposals Accepted With Hidden Fields

- **All 19 Claims, all 10 Evidence records and all 4 Metrics:** 33 of 44 proposals.
- **The 11 relationships** were fully visible.
- **All 44** were accepted as proposed, with no corrections.

The canonical rows are byte-identical to the proposals on every hidden field checked: Evidence 10/10, Claims 19/19, Metrics 4/4.

## 5. S1 Hidden Values and Interpretive Impact

Impact scale:

- **None:** matches the source or is provenance echoed correctly.
- **Low:** presentational.
- **Moderate:** a judgement a reviewer could reasonably dispute, which could shift analysis emphasis.
- **High:** could change what the record means.

No S1 value is rated High.

### Evidence (canonical type: `evidence`)

| Proposal | Hidden values (type · reliability/score · directness · recency · period · notes) | Could alter interpretation? |
|---|---|---|
| `evidence_1` £80k revenue (`1eab728a…`) | revenue_measurement · medium/0.8 · **direct** · current · period ∅ · — | **Moderate.** A self-reported, unaudited approximation is labelled "direct". No period is set although the statement says "12 months prior to September 2026" (acceptable: the source gives no exact dates). |
| `evidence_2` £1,200/month (`e8b7820d…`) | recurring_revenue_measurement · medium/0.8 · **direct** · current · ∅ · — | **Moderate** (same directness question) |
| `evidence_3` 10% ad-hoc (`674d9ad1…`) | revenue_composition_measurement · medium/0.75 · **direct** · current · ∅ · — | **Moderate** (same) |
| `evidence_4` 428 enquiries (`2a057129…`) | client_outcome_measurement · medium/0.75 · **direct** · **relevant** · 2024-10-31 → 2026-08-30 · note "The figure excludes phone enquiries." | **Moderate.** Client analytics reported by the founder are arguably not "direct". "Relevant" is an undefined recency value. The period is correct. The AI-written note is accurate but unseen. |
| `evidence_5` to `evidence_8` data gaps (`a4d173e7…`, `8b9f4e93…`, `2296f7e7…`, `7a83d640…`) | data_gap · **high/0.9** · direct · current · ∅ · — | Low (a stated absence of data is reliably stated) |
| `evidence_9` acquisition sources (`34da7001…`) | acquisition_source_context · medium/0.75 · direct · current · ∅ · — | Low |
| `evidence_10` client stopped paid ads (`900fa4c2…`) | client_advertising_context · medium/0.7 · **direct** · relevant · ∅ · — | **Moderate.** A causal client outcome, reported second-hand and unverified, is labelled "direct". |

All 10 also carry `sourceType` business_intake, `sourceReference` "S1 — … (APPROVED)", `suppliedBy` human_ui, and a `valueText` that echoes the source. Impact: none; the values are correct.

### Claims (canonical type: `claim`)

| Proposals | Hidden values (subjectArea · confidenceScore · basis summary) | Could alter interpretation? |
|---|---|---|
| `claim_1` to `claim_9` | business description / financial performance / recurring revenue / revenue composition / customer acquisition / positioning / client outcomes · **0.75–0.8** · "stated directly in the intake" | Low–moderate (the scores are AI weights) |
| `claim_10` | client outcomes · 0.9 | Low |
| `claim_11` (`01c621c9…`) paid-advertising sequence | client outcomes · **0.7** · "no independent verification is supplied" | **Moderate.** The rationale itself says it's unverified, yet the Claim type is observation. |
| `claim_12`, `claim_13` hypotheses | growth constraints / revenue model · **0.45 / 0.4** | Low (consistent with hypothesis) |
| `claim_14` to `claim_18` unknowns | revenue model / measurement and analytics · 0.85–0.9 | Low |
| `claim_19` (`eb72a219…`) founder goal | founder goals and operating model · **0.9** | Low–moderate (a goal carrying a high numeric confidence) |

All 19 carry `sourceType` business_intake. Full Claim IDs are in the appendix.

### Metrics (canonical type: `metric`)

| Proposal | Hidden values (key · period · dimension · source Evidence) | Could alter interpretation? |
|---|---|---|
| `metric_1` (`632fa854…`) | total_revenue · ∅ · business = Baslon Digital · evidence_1 | Low |
| `metric_2` (`a4a1ce50…`) | recurring_monthly_revenue · ∅ · business = Baslon Digital · evidence_2 | Low |
| `metric_3` (`74289169…`) | ad_hoc_support_revenue_share · ∅ · revenue type = ad-hoc support work · evidence_3 | Low |
| `metric_4` (`8d90fdff…`) | swift_trees_contact_form_enquiries · 2024-10-31 → 2026-08-30 · client = Swift Trees Perth · evidence_4 | Low (all correct) |

**Conclusion for S1:** nothing is factually wrong against the source. Six Evidence records carry disputable, unseen AI judgements, mainly "direct" applied to self-reported or second-hand figures, plus undefined recency vocabulary. All 19 Claims carry unseen numeric confidence weights.

## 6. Smallest Safe M4-11 Fix

These are code changes, proposed for a future bounded brief.

1. **Show every persisted field before Accept.**
   - Add a read-only section to the pending review card, "Recorded if you accept (AI-proposed)", listing every field from §1 not already shown, in plain language.
   - **Evidence:** type, value text, unit, period, reliability (level and score), directness, recency, source notes.
   - **Claims:** subject area, confidence score, confidence basis.
   - **Metrics:** key, unit, period, dimension, and **the source Evidence statement**.
   - Put provenance fields (source type, reference, supplied by) in a collapsed "Provenance" group.
   - Add a unit test that fails if any field in the proposal schema is persisted but not rendered on the card, so M4-11 can't regress.
2. **Allow correction of AI-authored semantic fields that are currently locked:** Evidence `evidenceType`, Evidence `sourceMetadata.notes`, and Metric `dimensionData`. Everything else material is already correctable.
3. **Make provenance application-assigned (N-1):** set Evidence `sourceType`, `sourceReference` and `sourceMetadata.suppliedBy` from the extraction run, not the model; keep model notes as notes. Provenance is shown but never reviewer-editable. This is a service change with no schema change.
4. **Stamp the review contract:** add `reviewCard: "m4_11_v1"` (name to be confirmed) to the `evidenceReview` lineage written on *new* canonical records. This is a JSON addition with no schema change, and no existing record is touched.
5. **Honest labelling of older records:** where a canonical record's lineage lacks that stamp, the Evidence State page shows "qualifiers were AI-assigned and not displayed at review" next to them. This is derived at read time: no data change, no retrofit.

No prompt, validator-vocabulary or schema changes are required. A controlled vocabulary for directness and recency (B-09) is a sensible follow-up, but not needed to close M4-11.

## 7. Display, Correct, Confirm or Omit?

| Option | Recommendation |
|---|---|
| Display read-only | **Yes, for every persisted field.** This is the core of the fix. |
| Allow correction | **Yes, for all AI-authored semantic fields**, adding `evidenceType`, notes and `dimensionData` to the correction form. **No** for provenance and lineage. |
| Require explicit per-field confirmation | **No.** Once everything is visible, Accept is the explicit human authorisation of the whole card. Per-field confirmation adds friction without adding authority. |
| Omit from canonical persistence unless reviewed | **No.** It would change the canonical model, drop inputs coherence uses today, and require a schema and projection change. Visibility gives the same guarantee more simply. |

## 8. Disposition of the Already-Accepted S1 Records

**Constraints:** Evidence rows, proposals and proposal reviews are immutable (database triggers). Review decisions can't be changed. Evidence supersession is out of scope. So no in-place correction or re-review of S1 is possible.

| Option | Assessment |
|---|---|
| No action | **Not acceptable.** The records would enter the operational baseline labelled "Human reviewed" with unseen AI judgements, which is exactly the M4-11 conflict. |
| Explicit Product Owner confirmation | **Possible.** The Product Owner reviews the §5 values now and confirms them in the rebuild record. Cheap, but the confirmation lives in documentation, not in canonical lineage. It can't correct any value the Product Owner disagrees with. The records stay permanently "accepted without visible qualifiers" (flagged by fix item 5). |
| Controlled re-review | **Not possible** without new mechanisms: decisions are immutable, and Evidence has no supersession. |
| Rebuild S1 after the fix | **Recommended.** Implement M4-11, then run S1 again in a fresh rebuild Business. The cost is one extraction and 44 decisions. The rebuilt baseline is then fully human-authorised with the stamp from fix item 4, and the reviewer can correct the disputable directness values. `9aec14e1…` stays as non-operational history; archiving it needs explicit Product Owner approval, and it is never deleted. |

**Decision rule for the Product Owner:**

- If you would change **any** §5 value (for example, directness on `evidence_1`–`4` and `evidence_10`), only **rebuild after the fix** can achieve it.
- If you would accept every value exactly as listed, **Product Owner confirmation** is defensible. The rebuild's purpose, a clean human-authorised baseline, still favours rebuilding.

## 9. Resolving M4-11 Without Weakening the Principles

| Principle | How the fix preserves it |
|---|---|
| **AI proposes / humans admit** (AD-01) | A human can only admit what they have seen. Showing every persisted field makes Accept a genuine authorisation, and correction covers every AI-authored semantic field. M4-06 still applies: qualifiers remain non-truth-weights for diagnosis. |
| **Historical immutability** (AD-03) | No existing proposal, review, canonical row or snapshot is modified. Older records (the old Business and S1 of `9aec14e1…`) are only *labelled*, at read time, from lineage the application already stores. |
| **Source provenance** | Provenance becomes application-assigned from the extraction run (N-1), visible, and never editable by the reviewer or the model. |
| **No silent canonical mutation** | Nothing is backfilled. New records carry the review-card stamp from creation, and the difference between pre-fix and post-fix records is explicit rather than inferred. |

**Findings register actions** (to apply when the fix lands, not now):

- M4-11 → RESOLVED, recording the broadened scope from §1;
- add N-1 (model-authored provenance), resolved by the same change;
- note B-09 (qualifier vocabulary) as a follow-up;
- update the Milestone 4 entry-checklist item.

**Domain invariant to add:** every field that human Accept persists to canonical state must be displayed on the review card before the decision; provenance is assigned by the application, not by the model.

---

## Safety Confirmation

- Inspection only: read-only SQL and source reads.
- No writes to `baslon_os`. Old Business fingerprints are unchanged (15 tables). The rebuild Business is unchanged.
- No S2, no archive, no deletion, no prompt or validator change, no M4-02B or diagnosis work.
- No code changes; working tree clean at `7997f50`; no commit or push.

## Appendix — S1 Claim Proposal IDs

| Ref | ID | Ref | ID |
|---|---|---|---|
| claim_1 | `1ec1378f-794a-4006-8029-b0f290651a80` | claim_11 | `01c621c9-9ecb-4ad2-9f95-1afcf00b1247` |
| claim_2 | `550fe6ac-e06c-4799-a322-897bea7a8153` | claim_12 | `588f9187-61b2-4b88-8a8f-005fcb5e6c9a` |
| claim_3 | `7d74a313-ed1f-44c5-9c8c-ab16474687b6` | claim_13 | `2641a4c0-42c9-4d28-b572-4b9f9592b82e` |
| claim_4 | `270c7a63-6d2c-43bb-90ee-9ba94b22a782` | claim_14 | `fad02a38-5baf-4dcb-a884-5fd35d984456` |
| claim_5 | `77f3a2c2-d97e-40d3-89de-8026edda41ce` | claim_15 | `a41a968f-cb41-4708-a80f-a8234e731d5b` |
| claim_6 | `1e5ee2d4-dd76-4856-94d8-00ea8964d2ff` | claim_16 | `3ea68f22-4ce7-473f-b457-7cadf53ab0e8` |
| claim_7 | `6e864351-86c9-4afe-89d4-a504f17f3648` | claim_17 | `e371e8d6-5835-4eb3-9108-8853967b42d3` |
| claim_8 | `9643af17-bb55-40cf-97e1-9fe036144357` | claim_18 | `a5948870-52b0-4225-90fc-b85ecf5f60d2` |
| claim_9 | `cd0ed169-dacf-4090-8547-277e8655c0b0` | claim_19 | `eb72a219-cbab-4908-af15-79bef573c27f` |
| claim_10 | `6300d8e4-a630-4bd5-9eeb-42ada022a6c5` | | |

Proposal IDs are listed; the canonical record for each carries the same proposal ID in its lineage.
