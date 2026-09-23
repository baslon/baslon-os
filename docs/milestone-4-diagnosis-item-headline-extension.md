# Milestone 4 — Diagnosis Item Headline Extension

**Status:** **COMPLETE AND LIVE (23 September 2026).** Code merged (PR #24, `32f5529`), migration `0008_diagnosis_headlines` applied to live `baslon_os`, and companion headline set version 1 approved for the Baslon Digital approved diagnosis.
**Build brief:** `baslon-os-diagnosis-item-headline-extension-build-brief.md` (22 September 2026).

A headline is a short, human-reviewed presentation label for one approved
diagnosis statement. The approved statement remains the analytical authority. A
headline is not a finding, a recommendation, a score, a priority or a canonical
fact, and it never replaces the statement.

---

## 1. Version dispatch (the blocking requirement)

Parsing, validation, effective-item resolution, the review manifest and the
artifact builder all select their contract from **persisted provenance**, never
from a global constant:

| Source | Selects |
|---|---|
| `analysis_runs.prompt_version` | `diagnosisContractForPrompt` |
| `approved_diagnoses.artifact_version` | `diagnosisContractForArtifact` |

| Contract | Prompt | Artifact | Item fields | Headline |
|---|---|---|---|---|
| v1 | `phase1_diagnosis_v1` | `phase1_diagnosis_artifact_v1` | 8 | none |
| v2 | `phase1_diagnosis_v2` | `phase1_diagnosis_artifact_v2` | 9 | required |

The input projection is unchanged, so both versions keep
`phase1_diagnosis_input_v1`. An unknown version fails closed
(`UnsupportedDiagnosisVersionError`).

**v1 is byte-identical in behaviour.** Its strict item schema still has no
`headline`, so the four stored Baslon corrections (I001, I002, I006, I014) keep
parsing exactly as before, a v1 artifact still carries no headline key, and a v1
correction that carries one is rejected. New runs use v2; the prompt version is
taken from the model configuration, so a run records the contract it was
actually called with.

## 2. Headline rules (deterministic only)

Structural: trimmed, non-blank, at most 120 characters, one line, not
punctuation only. Number-subset: every number in a headline must also appear in
its statement. Duplicates: exact repeats within one diagnosis or one headline
set, after trim, case-fold and whitespace collapse. Semantic faithfulness stays
a human judgement; nothing here rewrites text.

## 3. Migration `0008_diagnosis_headlines` (additive only)

- `diagnosis_items.headline` — nullable, never backfilled. A CHECK enforces the
  structural rules; the Phase 1 output guard requires a headline for
  `phase1_diagnosis_v2` items, refuses one on v1 items, and refuses an unknown
  prompt version at write time.
- `approved_diagnoses` gains two composite unique keys so headline tables can
  bind to the exact approved diagnosis, run and version.
- The approved-diagnosis guard now also requires the artifact contract to match
  the run's prompt version.
- New tables: `diagnosis_headline_proposals`, `diagnosis_headline_review_sessions`,
  `diagnosis_headline_reviews`, `approved_diagnosis_headline_sets`,
  `approved_diagnosis_headlines`.

Every new table is Business-owned, bound by composite foreign keys to the same
Business and the same diagnosis run, and immutable once written. Triggers also
enforce: headlines only for ACCEPTED or CORRECTED items; proposals only while
their own `diagnosis_headlines` run is RUNNING and only for the snapshot of
their approved diagnosis; a review that covers every effective item exactly
once; one open review per approved diagnosis; append-only set versions; a set
that completes its review in the same transaction and holds exactly one headline
per effective item; and each approved headline being exactly its reviewed value.

## 4. Companion flow for the approved v1 diagnosis

`diagnosis_headlines` is a separate analysis module with its own prompt version,
input contract (`diagnosis_headlines_input_v1`), input hash, provider, model,
raw output and failure state. Phase 1 Diagnosis lookups are module-scoped and
cannot select it.

Its model input is minimal: item handle, item type and the effective approved
statement. No canonical Claim, Evidence, Metric or UUID is sent. The task is to
label an approved statement, not to re-diagnose the business.

Flow: propose → validate (fail closed, no partial set) → human review (ACCEPT or
CORRECT only; there is no headline REJECT) → approve an immutable set. Approval
locks and rechecks the active Business, refuses archived Businesses, requires
the exact current approved diagnosis, and **creates no workflow transition**. A
failed proposal run is never silently replaced: one retry needs explicit Product
Owner approval, and only one.

Changing a headline later means version N+1: review again and approve again.
Earlier versions are preserved; the current set is the latest approved version.

## 5. Rendering

Resolution order, computed read-only: native v2 headline → the companion set
approved for that exact diagnosis (id, version, run and Business) → no headline,
statement first. Nothing is generated at render time, and a set bound to
anything else is ignored. On the Overview a headline leads and the approved
statement sits directly beneath it, with only importance repeated as a badge;
Full Diagnosis and Audit keep type and review status, and Audit records the
headline set's provenance. Before a companion set exists, the five approved
views render statement-first, exactly as they did before this extension.

The headline review surface is a separate route:
`/businesses/{businessId}/diagnosis/headlines`. The approved five-view
information architecture is unchanged and does not link to it.

## 6. Live rollout (complete)

| Step | Result |
|---|---|
| Code | PR #24 merged as `32f5529781b6b68a19bfdff8ab3a4c204d42cde4` |
| Migration | `0008_diagnosis_headlines` applied to live `baslon_os` on 22 September 2026; migration count 9. Additive only, no backfill: every pre-existing v1 diagnosis item still has `headline IS NULL` |
| Backup | A verified restore point was taken before the next live write (P-13, `docs/operations/postgres-backup-restore-runbook.md`) |
| Proposal run | `d97b01b7-d41c-4312-a9b9-2b9186ad4da6` — module `diagnosis_headlines`, `diagnosis_headlines_v1` / `diagnosis_headlines_input_v1`, SUCCEEDED, 14 proposals |
| Headline review | Session `33622bdf-e530-45c4-ab8b-eb902abc23f9`, reviewer David Demetrius: **10 ACCEPTED, 4 CORRECTED** (I001, I002, I005, I009) |
| Approved set | `b586678b-3871-4939-9446-de84fceddba5`, version 1, approved by David Demetrius at 2026-09-23T07:33:13.531Z |
| Workflow | unchanged — `PHASE1_APPROVED` v21, 20 transitions. Headline approval creates no workflow transition |
| Approved diagnosis | unchanged — `a4e4f0e0-3544-4650-95ee-f13d31b36517`, `phase1_diagnosis_artifact_v1`, content hash `0f9fe3b044a49bc626891edea44f08fe`, with no `headline` key |

The model input for the proposal run carried only each item's handle, type and effective approved statement: no canonical
Claim, Evidence, Metric, gap or calculation, and no UUID. The task was to label approved statements, not to re-diagnose.

## 7. The approved headlines (version 1)

These are reviewed presentation labels for the approved statements. They do **not** replace the statements, and they are
not canonical facts.

| Item | Provenance | Approved headline |
|---|---|---|
| I001 | Corrected | Digital consultancy for established service businesses |
| I002 | Corrected | 428 contact-form enquiries documented for Swift Trees |
| I003 | Accepted | Website and SEO work associated with reduced reliance on paid advertising |
| I004 | Accepted | Two active recurring clients with approximately £600 monthly each |
| I005 | Corrected | Customer acquisition is currently assessed as lacking predictability |
| I006 | Accepted | Recurring revenue exposure is concentrated in a small current client base |
| I007 | Accepted | Potential value in combined website, SEO, conversion and enquiry-management capability |
| I008 | Accepted | Profitability and cash-generation implications cannot yet be established |
| I009 | Corrected | Primary growth constraint cannot yet be established |
| I010 | Accepted | Acquisition channel contributions and economics cannot currently be quantified |
| I011 | Accepted | Most valuable customer segments and positioning fit cannot yet be established |
| I012 | Accepted | Fit with the founder’s roughly 30-hour working-week goal cannot be assessed |
| I013 | Accepted | Recurring revenue’s role and level remain strategic decisions |
| I014 | Accepted | Acquisition channel and ideal-customer proposition remain strategic choices |

## 8. Presentation after approval

Headline resolution for the Baslon approved diagnosis is **companion set, version 1** (the artifact is v1, so there is no
native headline). On Overview, nine headline-led items appear and the five Limitations stay summarised rather than
individually listed, which is the established five-view information architecture; each approved statement stays visible
beneath its headline, importance stays visible, and redundant type and review-status badges are reduced. Full Diagnosis
renders all 14 headlines above their statements and keeps the 10 Accepted / 4 Corrected Phase 1 decision badges. Audit &
Provenance records the headline set's id, version, approver, timestamp, companion-label semantics and exact binding.

## 9. Boundary

There is no headline set version 2, and no further proposal run. A change to an approved headline means a new version:
review again, approve again; approved versions are preserved and the latest approved version is current.

**Phase 2 remains NOT STARTED.** The approved diagnosis is the analytical authority for any later phase; a headline is a
label and never the basis of analysis. The six evidence gaps remain unresolved, the six calculations remain derived values,
provenance must be retained, and material strategic choices still require explicit human checkpoints.