# Milestone 3C — Evidence Coherence

Evidence Coherence analyses one immutable canonical Business State Snapshot for material contradictions and important evidence gaps. It is separate from Evidence Extraction: extraction proposes canonical information from human source material, while coherence reads already reviewed snapshot state and produces analytical findings only.

## Snapshot-bound input

`evidence_coherence_input_v1` deterministically projects the selected snapshot’s Business Profile, active Claims, Evidence, Metrics and Claim/Evidence relationships. Active Claims are derived from the snapshot payload, not live state. The exact model input and a stable SHA-256 hash are recorded on the Analysis Run.

## Analytical records

Contradictions, Evidence Gaps, finding references and questions are immutable and remain bound to their Analysis Run and snapshot. They are not Claims, Evidence, Metrics, facts or decisions and never update canonical Evidence State. References are accepted only when their canonical IDs occur in the exact analysed snapshot.

Materiality is `low`, `medium` or `high`; it is not confidence. The UI surfaces at most three questions, prioritising high then medium materiality and ordinal finding priority. Low-materiality findings remain historical but do not normally create prominent questions.

## Workflow and retries

The existing workflow moves from `EVIDENCE_READY` through `GAP_ANALYSIS` to `GAP_RESOLUTION_REQUIRED`. Provider or validation failure leaves the workflow at `GAP_ANALYSIS`, records a failed run and permits retry. An equivalent successful run is reused; an equivalent running run prevents duplicate work. A late analysis remains valid history but cannot advance workflow when a newer snapshot exists.

Successful persistence of findings, references, questions and run completion is one transaction. Invalid output creates no analytical findings. Archived Businesses cannot start analysis but retain read access to history.

## Question → Add Information handoff

A surfaced question can originate one Add Information submission while the Business is in `GAP_RESOLUTION_REQUIRED`. The server reloads the immutable question and verifies its Business, finding, successful coherence run and current snapshot before transactionally creating the human-answer Source Submission and `analysis_question_sources` link. One question may create only one answer Source Submission through this application path; a failed extraction retries against that same source and question.

Contextual extraction uses `evidence_extractor_v5`. Its narrow context shape is `{ kind: "analysis_question", questionId, questionText }`. The question identifies what a short answer refers to, but only `SourceSubmission.raw_text` is evidentiary. Source excerpts and numeric provenance continue to be validated solely against that human answer. Exact context is recorded in extraction-run source metadata; ordinary Add Information remains on `evidence_extractor_v4`.

Question answers still pass through proposal review and the existing transactional canonical-application path. Accepted or corrected proposals contribute to the next cumulative snapshot; rejected and unresolved proposals do not. The analytical question and prior coherence analysis remain immutable and are never marked resolved. A new coherence run may subsequently analyse the new snapshot.
