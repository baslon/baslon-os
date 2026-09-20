"use client";

import { useState, type FormEvent } from "react";
import { numericPrecisionLabel, numericPrecisions } from "@/domain/numeric-precision";

function PrecisionOptions() {
  return numericPrecisions.map((item) => <option key={item} value={item}>{numericPrecisionLabel(item)}</option>);
}

export type ReviewableProposal = {
  id: string;
  proposalType: "claim" | "evidence" | "metric" | "claim_evidence";
  structuredPayload: Record<string, unknown>;
};

type ReviewContext = {
  businessId: string;
  extractionRunId: string;
  reviewSessionId: string;
  reviewerId: string;
};

type Props = {
  proposal: ReviewableProposal;
  context: ReviewContext;
  reviewAction: (formData: FormData) => void | Promise<void>;
  initialEditing?: boolean;
  initialNoteOpen?: boolean;
};

function display(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function ProposalCorrectionFields({ proposal }: { proposal: ReviewableProposal }) {
  const payload = proposal.structuredPayload;
  if (proposal.proposalType === "claim") {
    return <div className="correction-grid">
      <label>Statement<input name="statement" defaultValue={display(payload.statement)} /></label>
      <label>Claim type<select name="claimType" defaultValue={display(payload.claimType)}>
        {["observation", "management_belief", "hypothesis", "ai_inference", "unknown"].map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label>Subject area<input name="subjectArea" defaultValue={display(payload.subjectArea)} /></label>
      <label>Confidence level<input name="confidenceLevel" defaultValue={display(payload.confidenceLevel)} /></label>
      <label>Confidence score<input name="confidenceScore" type="number" min="0" max="1" step="0.01" defaultValue={display(payload.confidenceScore)} /></label>
      <label>Confidence basis<input name="confidenceBasis" defaultValue={display((payload.confidenceBasis as Record<string, unknown>)?.basis)} /></label>
    </div>;
  }
  if (proposal.proposalType === "evidence") {
    return <>
      <div className="correction-grid">
        <label>Statement<input name="statement" defaultValue={display(payload.statement)} /></label>
        <label>Evidence type<input name="evidenceType" defaultValue={display(payload.evidenceType)} /></label>
        <label>Numeric value<input name="valueNumeric" type="number" step="any" defaultValue={display(payload.valueNumeric)} /></label>
        <label>Precision<select name="valuePrecision" defaultValue={display(payload.valuePrecision ?? (payload.valueNumeric === null || payload.valueNumeric === undefined ? "" : "unspecified"))}>
          <option value="">No numeric value</option>
          <PrecisionOptions />
        </select></label>
        <label>Range lower bound<input name="valueLower" type="number" step="any" defaultValue={display(payload.valueLower)} /></label>
        <label>Range upper bound<input name="valueUpper" type="number" step="any" defaultValue={display(payload.valueUpper)} /></label>
        <label>Text value<input name="valueText" defaultValue={display(payload.valueText)} /></label>
        <label>Unit<input name="unit" defaultValue={display(payload.unit)} /></label>
        <label>Period start<input name="periodStart" type="date" defaultValue={display(payload.periodStart)} /></label>
        <label>Period end<input name="periodEnd" type="date" defaultValue={display(payload.periodEnd)} /></label>
        <label>Reliability<input name="reliabilityLevel" defaultValue={display(payload.reliabilityLevel)} /></label>
        <label>Reliability score<input name="reliabilityScore" type="number" min="0" max="1" step="0.01" defaultValue={display(payload.reliabilityScore)} /></label>
        <label>Directness<input name="directnessLevel" defaultValue={display(payload.directnessLevel)} /></label>
        <label>Recency<input name="recencyLevel" defaultValue={display(payload.recencyLevel)} /></label>
        <label>Materiality<input name="materiality" defaultValue={display(payload.materiality)} /></label>
        <label>Source notes<input name="sourceNotes" defaultValue={display((payload.sourceMetadata as Record<string, unknown> | undefined)?.notes)} /></label>
      </div>
      <p className="note">Reliability describes how trustworthy the Evidence is. Materiality describes its strategic importance. Precision describes how precisely the source states the number; a range uses the two bounds and no single value. These are separate judgments.</p>
    </>;
  }
  if (proposal.proposalType === "metric") {
    return <div className="correction-grid">
      <label>Metric key<input name="metricKey" defaultValue={display(payload.metricKey)} /></label>
      <label>Label<input name="metricLabel" defaultValue={display(payload.metricLabel)} /></label>
      <label>Numeric value<input name="numericValue" type="number" step="any" defaultValue={display(payload.numericValue)} /></label>
      <label>Precision<select name="numericPrecision" defaultValue={display(payload.numericPrecision ?? "unspecified")}>
        <PrecisionOptions />
      </select></label>
      <label>Range lower bound<input name="numericLower" type="number" step="any" defaultValue={display(payload.numericLower)} /></label>
      <label>Range upper bound<input name="numericUpper" type="number" step="any" defaultValue={display(payload.numericUpper)} /></label>
      <label>Unit<input name="unit" defaultValue={display(payload.unit)} /></label>
      <label>Period start<input name="periodStart" type="date" defaultValue={display(payload.periodStart)} /></label>
      <label>Period end<input name="periodEnd" type="date" defaultValue={display(payload.periodEnd)} /></label>
      <label>Dimension<input name="dimension" defaultValue={display((payload.dimensionData as Record<string, unknown> | undefined)?.dimension)} /></label>
      <label>Dimension value<input name="dimensionValue" defaultValue={display((payload.dimensionData as Record<string, unknown> | undefined)?.value)} /></label>
      <p className="note">A Metric taken from numeric Evidence must have the same precision as that Evidence. If you changed the Evidence precision, choose the same precision here.</p>
    </div>;
  }
  return <div className="correction-grid">
    <label>Relationship type<select name="relationshipType" defaultValue={display(payload.relationshipType)}>
      {["supports", "contradicts", "context"].map((item) => <option key={item}>{item}</option>)}
    </select></label>
    <label>Strength score<input name="strengthScore" type="number" min="0" max="1" step="0.01" defaultValue={display(payload.strengthScore)} /></label>
  </div>;
}

function HiddenContext({ proposal, context, decision }: {
  proposal: ReviewableProposal;
  context: ReviewContext;
  decision: "ACCEPTED" | "CORRECTED" | "REJECTED" | "UNRESOLVED";
}) {
  return <>
    <input type="hidden" name="businessId" value={context.businessId} />
    <input type="hidden" name="extractionRunId" value={context.extractionRunId} />
    <input type="hidden" name="reviewSessionId" value={context.reviewSessionId} />
    <input type="hidden" name="proposalId" value={proposal.id} />
    <input type="hidden" name="proposalType" value={proposal.proposalType} />
    <input type="hidden" name="reviewerId" value={context.reviewerId} />
    <input type="hidden" name="decision" value={decision} />
  </>;
}

function confirmDecision(message: string) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (!globalThis.confirm(message)) event.preventDefault();
  };
}

function ReviewNote({
  note,
  setNote,
  fieldName,
  initiallyOpen = false,
}: {
  note: string;
  setNote: (value: string) => void;
  fieldName?: string;
  initiallyOpen?: boolean;
}) {
  return <details className="review-note" open={initiallyOpen}>
    <summary>Add review note <span className="field-note">Optional</span></summary>
    <label>
      Review note
      <input name={fieldName} value={note} onChange={(event) => setNote(event.target.value)} />
    </label>
    <p className="note">This note is stored in the audit history. It does not change the proposal.</p>
  </details>;
}

export function ProposalReviewControls({
  proposal,
  context,
  reviewAction,
  initialEditing = false,
  initialNoteOpen = false,
}: Props) {
  const [editing, setEditing] = useState(initialEditing);
  const [note, setNote] = useState("");

  if (editing) {
    return <form action={reviewAction} className="review-form">
      <HiddenContext proposal={proposal} context={context} decision="CORRECTED" />
      <h3>Correct proposal</h3>
      <ProposalCorrectionFields proposal={proposal} />
      <ReviewNote note={note} setNote={setNote} fieldName="reason" initiallyOpen={initialNoteOpen} />
      <div className="button-row">
        <button type="submit">Save correction</button>
        <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>;
  }

  return <div className="review-controls">
    <ReviewNote note={note} setNote={setNote} initiallyOpen={initialNoteOpen} />
    <div className="button-row">
      <form action={reviewAction}>
        <HiddenContext proposal={proposal} context={context} decision="ACCEPTED" />
        <input type="hidden" name="reason" value={note} />
        <button type="submit">Accept</button>
      </form>
      <button type="button" className="secondary" onClick={() => setEditing(true)}>Correct proposal</button>
      <form action={reviewAction} onSubmit={confirmDecision("Reject this proposal? Once you submit a review decision, it cannot currently be changed.")}>
        <HiddenContext proposal={proposal} context={context} decision="REJECTED" />
        <input type="hidden" name="reason" value={note} />
        <button type="submit" className="secondary">Reject</button>
      </form>
      <form action={reviewAction} onSubmit={confirmDecision("Leave this proposal unresolved? Once you submit a review decision, it cannot currently be changed.")}>
        <HiddenContext proposal={proposal} context={context} decision="UNRESOLVED" />
        <input type="hidden" name="reason" value={note} />
        <button type="submit" className="secondary">Leave unresolved</button>
      </form>
    </div>
    <p className="note decision-helper">Once you submit a review decision, it cannot currently be changed.</p>
  </div>;
}
