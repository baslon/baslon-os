# Milestone 4 — Diagnosis Item Headline Extension

**Status:** Stage A (code) implemented. **Migration `0008` is not applied to live `baslon_os`, and no Baslon headline has been proposed, reviewed or approved.**
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
views render exactly as they do now.

The headline review surface is a separate route:
`/businesses/{businessId}/diagnosis/headlines`. The approved five-view
information architecture is unchanged and does not link to it.

## 6. Not done here

Migration `0008` is not applied to live `baslon_os`. No live headline run,
review or set exists. The approved Baslon diagnosis
(`a4e4f0e0-3544-4650-95ee-f13d31b36517`, `PHASE1_APPROVED` v21) is untouched,
and Phase 2 has not started. Both remaining stages need separate Product Owner
approval.
