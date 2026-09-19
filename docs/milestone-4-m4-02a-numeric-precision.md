# Milestone 4 — M4-02A Numeric Precision Foundation

M4-02A makes numeric precision explicit for new canonical Evidence and Metrics so
Baslon OS never turns uncertainty into false precision. It resolves findings
register M4-02 and M4-10. It does not implement diagnosis, Evidence supersession,
a historical retrofit or a rebuild of the active Baslon Digital Business.

Governing decision: `docs/baslon-os-m4-02-numeric-precision-architecture-decision.md`.

## Vocabulary

```text
exact | approximate | estimate | range | unspecified
```

- `exact` — the source states one specific value with no qualifying language.
- `approximate` — approximation language is attached to the number ("about 30").
- `estimate` — the source presents the number as an estimate or belief.
- `range` — the source states lower and upper bounds in one expression.
- `unspecified` — precision was never established. Used for records that predate
  M4-02A and for qualitative Evidence. It must never be read as `exact`.

Precision is separate from reliability, directness, recency, materiality and
`strengthScore`. Numeric storage never upgrades epistemic certainty.

`src/domain/numeric-precision.ts` holds the vocabulary, the shared shape rule and
the calculation rule for future diagnosis code: a derived result cannot be more
precise than its least-precise material input.

## Schema (migration `0006_numeric_precision`)

- New PostgreSQL enum `numeric_precision`.
- `evidence`: `value_precision` (NOT NULL, default `unspecified`), `value_lower`,
  `value_upper` (`numeric(20,4)`), and CHECK `evidence_value_precision_check`.
- `metrics`: `numeric_value` becomes nullable (ranges only); `numeric_precision`
  (NOT NULL, default `unspecified`), `numeric_lower`, `numeric_upper`, and CHECK
  `metrics_numeric_precision_check`.

The CHECKs require that:

- a range has both bounds, lower ≤ upper, and no single value;
- `exact`, `approximate` and `estimate` have a single value and no bounds;
- `unspecified` has no bounds;
- a Metric always has either a single value or a range.

The migration is additive. It edits no earlier migration and updates no rows.
Adding a column with a constant default fires no row triggers, so immutable
Evidence rows are not touched. Same-Business foreign keys and Permanent Delete are
unchanged.

## Historical compatibility (no retrofit)

- Existing Evidence and Metric rows read as `unspecified` through the column
  default. Nothing is inferred from their wording.
- Stored extraction proposals are immutable. `readStoredEvidenceProposal` and
  `readStoredMetricProposal` read pre-precision payloads as `unspecified`, with
  null bounds (qualitative Evidence stays without precision).
- Historical snapshot JSON is never rewritten. The Evidence Coherence projection
  reads a missing precision as `unspecified`.

## Extraction

- Prompts `evidence_extractor_v6` (standard) and `evidence_extractor_v7`
  (question context) replace v4/v5 for new runs. v4/v5 text is retained unchanged
  for historical identity.
- Proposals carry Evidence `valuePrecision`, `valueLower`, `valueUpper` and Metric
  `numericPrecision`, `numericLower`, `numericUpper`. The extractor may propose
  only `exact`, `approximate`, `estimate` or `range`. Qualitative Evidence has null
  precision and null numbers.
- A number stated only as a limit ("more than 30") is not emitted as a value.
- **M4-10 written-number rule, identical in prompt and validator:** a number may be
  written in digits (optionally with £, $, € or %, a k suffix, or an m suffix after
  a currency symbol), or as a whole-number word from zero to ninety-nine. A number
  word inside a compound description ("three-day"), after approximation language
  ("about ten"), or larger than ninety-nine ("a hundred") is not converted.

## Deterministic validation

`numericPrecisionIssue` (`src/ai/evidence-extractor/validation.ts`) checks each
proposed number against the words next to it in the cited excerpt:

- `exact` needs a plain occurrence and no estimate language;
- `approximate` needs approximation language next to the number ("about",
  "roughly", "around", "circa", "nearly", "-ish", "or so", …);
- `estimate` needs estimate language ("estimate", "I think", "probably", …) and
  a plain or approximate occurrence;
- `range` needs both bounds in one range expression ("10–15", "10 to 15",
  "between 10 and 15").

A number that is only a limit, or only a range bound, cannot be `exact`. A Metric
must carry the same precision as the numeric Evidence it is taken from. All
excerpts must come from the human-supplied source text. Question context stays
interpretive only, and precision wording from the question does not count.
Validation rejects anything it cannot ground. It never upgrades or downgrades
precision silently.

## Human review

The review card shows the proposed value or range with "Precision: …" before any
decision is made, including for legacy proposals, which show "Unspecified". A
correction can set any of the five precisions (D4, with no wording check) and
change range bounds. Corrected values and bounds must still appear in the
original excerpt, and the resulting shape must be valid. A cleared Metric value is
parsed as missing, not zero.

A Metric taken from numeric Evidence must end review with the same precision as
that Evidence, whether the Evidence was accepted or corrected. The reviewer can
still change precision, but must change both. Their values and bounds may differ.
Unlinked Metrics, and Metrics linked to qualitative Evidence, are not constrained.

## Canonical persistence and snapshots

Accepted and corrected Evidence and Metrics persist their precision and bounds.
Qualitative Evidence persists as `unspecified`. The Foundation write path
(`FoundationRepository.addEvidence`/`addMetric`) also persists supplied precision
and range bounds, validates their shape, and defaults to `unspecified` only when
no precision is supplied. New snapshots include the new
columns automatically. Evidence Coherence input `evidence_coherence_input_v2` and
prompt `evidence_coherence_v3` include precision and instruct the model never to
treat `unspecified` as exact. Earlier runs keep their own identity (input v1,
prompt v1/v2).

## Presentation

`formatWorkspaceMetric` never shows an approximate, estimated or range value as a
bare exact number. It shows "about £80,000", "20 leads (estimate)",
"£10,000–£15,000", and "Value not recorded" when there is no value. Evidence
State shows each value's precision.

## Tests

- `tests/unit/numeric-precision.test.tsx`: vocabulary, shape rules, extraction
  grounding, the M4-10 rule, question isolation, legacy reading, review display and
  correction fields, formatting and snapshot projection.
- `tests/integration/evidence-review.test.ts`: precision and range correction,
  canonical persistence and snapshot inclusion; a legacy proposal accepted as
  `unspecified`.
- `tests/postgres/numeric-precision.postgres.test.ts`: defaults, the CHECK
  constraints, enum vocabulary, same-Business integrity, historical snapshot
  immutability and Permanent Delete on PostgreSQL 17.
- `tests/fixtures/foundation-precision-scenarios.ts`: Foundation writes of
  `exact`, `approximate`, `estimate`, a range with both bounds, and the
  `unspecified` default, run on both PGlite and PostgreSQL.
- `tests/helpers/pglite-migrations.ts` applies every journaled migration to
  PGlite, replacing nine hardcoded migration lists (D8, B-21).

## Not in scope

- no historical retrofit or AI backfill of precision;
- no rebuild of the active Baslon Digital Business;
- no Evidence supersession;
- no diagnosis engine or Phase 1 diagnosis input contract.
