import Link from "next/link";
import {
  approveDiagnosisAction,
  generateDiagnosisAction,
  requestDiagnosisRevisionAction,
  reviewDiagnosisItemAction,
  startDiagnosisReviewAction,
} from "./actions";
import {
  diagnosisGroundings,
  diagnosisInterpretationConfidences,
  diagnosisItemTypes,
  diagnosisMaterialities,
  REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE,
} from "@/domain/phase1-diagnosis";
import { formatReferenceLines } from "@/domain/phase1-diagnosis-review-card";
import type { DiagnosisViewModel } from "@/services/phase1-diagnosis-service";
import { ApprovedDiagnosis, type DiagnosisView } from "./phase1-diagnosis-approved";
import { Fields, label, provenanceRows } from "./phase1-diagnosis-shared";

export { formatApprovalTime } from "./phase1-diagnosis-shared";

type Item = DiagnosisViewModel["items"][number];

function numeric(calculation: DiagnosisViewModel["calculations"][number]) {
  const value = calculation.valuePrecision === "range"
    ? `${calculation.valueLower}–${calculation.valueUpper}`
    : calculation.valueNumeric;
  return `${value} ${calculation.unit} (precision: ${calculation.valuePrecision})`;
}

function Options({ values, selected }: { values: readonly string[]; selected: string | null }) {
  return <>{values.map((value) => <option key={value} value={value} selected={value === selected}>{label(value)}</option>)}</>;
}

function DecisionForms({ model, item }: { model: DiagnosisViewModel; item: Item }) {
  const session = model.session!;
  const hidden = <>
    <input type="hidden" name="businessId" value={model.business.id} />
    <input type="hidden" name="reviewSessionId" value={session.id} />
    <input type="hidden" name="reviewerId" value={session.reviewerId} />
    <input type="hidden" name="diagnosisItemId" value={item.id} />
  </>;
  return <div className="decision-forms">
    <form action={reviewDiagnosisItemAction}>{hidden}<input type="hidden" name="decision" value="ACCEPTED" />
      <button type="submit">Accept</button></form>
    <form action={reviewDiagnosisItemAction}>{hidden}<input type="hidden" name="decision" value="REJECTED" />
      <label>Reason for rejecting<input name="reason" /></label>
      <button type="submit" className="secondary">Reject</button></form>
    <details><summary>Correct this item</summary>
      <form action={reviewDiagnosisItemAction}>{hidden}<input type="hidden" name="decision" value="CORRECTED" />
        <label>Type<select name="itemType"><Options values={diagnosisItemTypes} selected={item.itemType} /></select></label>
        <label>Conclusion<textarea name="statement" defaultValue={item.statement} required /></label>
        <label>Rationale<textarea name="rationale" defaultValue={item.rationale} required /></label>
        <label>Grounding<select name="grounding"><Options values={diagnosisGroundings} selected={item.grounding} /></select></label>
        <label>Materiality<select name="materiality"><Options values={diagnosisMaterialities} selected={item.materiality} /></select></label>
        <label>Interpretation confidence<select name="interpretationConfidence">
          <option value="" selected={item.interpretationConfidence === null}>Not given</option>
          <Options values={diagnosisInterpretationConfidences} selected={item.interpretationConfidence} />
        </select></label>
        <label>Limitations<textarea name="limitations" defaultValue={item.limitations ?? ""} /></label>
        <label>Supporting references (one &quot;role handle&quot; per line, e.g. &quot;primary E001&quot; or &quot;limiting_gap G001&quot;)
          <textarea name="references" defaultValue={formatReferenceLines(item.references)} /></label>
        <label>Reason for correcting<input name="reason" /></label>
        <p className="note">The corrected item must pass the same grounding and precision checks as the AI proposal.</p>
        <button type="submit">Save correction</button>
      </form>
    </details>
  </div>;
}

/**
 * Once decided, the card leads with the effective reviewed item: exactly what
 * approval will persist (M4-13). A corrected or rejected item keeps its
 * original AI proposal only in a labelled, collapsed audit section.
 */
function ItemCard({ model, item, readOnly }: { model: DiagnosisViewModel; item: Item; readOnly: boolean }) {
  const canDecide = model.session?.status === "OPEN" && !item.decision && !readOnly;
  const decision = item.decision?.decision;
  const reason = item.decision?.reason ? ` — ${item.decision.reason}` : "";
  const original = <details className="original-item" data-section="original">
    <summary>Original AI diagnosis item (audit, read-only)</summary>
    <Fields item={item} />
  </details>;
  return <article className="record-card" aria-label={`Diagnosis item ${item.itemRef}`}>
    {!decision ? <>
      <p className="eyebrow">{item.itemRef} · AI-proposed diagnosis item</p>
      <h3>{item.statement}</h3>
      <Fields item={item} />
    </> : null}
    {decision === "ACCEPTED" || decision === "CORRECTED" ? <>
      <p className="eyebrow">{item.itemRef} · Final reviewed diagnosis item</p>
      <p className="notice"><strong>Decision: {decision}</strong>{reason}
        <span className="muted">{decision === "ACCEPTED"
          ? " The generated item is accepted unchanged."
          : " The corrected values below replace the AI proposal."}</span></p>
      <section data-section="effective" aria-label={`Final reviewed item ${item.itemRef}`}>
        <h3>{item.effective!.statement}</h3>
        <Fields item={item.effective!} />
      </section>
      {decision === "CORRECTED" ? original : null}
    </> : null}
    {decision === "REJECTED" ? <>
      <p className="eyebrow">{item.itemRef} · Rejected diagnosis item</p>
      <p className="notice"><strong>Decision: REJECTED</strong>{reason} This item will not be included in the approved diagnosis.</p>
      {original}
    </> : null}
    {canDecide ? <DecisionForms model={model} item={item} /> : null}
  </article>;
}

function Provenance({ model }: { model: DiagnosisViewModel }) {
  return <details className="review-provenance"><summary>Provenance (recorded by Baslon OS, read-only)</summary>
    <dl>{provenanceRows(model).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
  </details>;
}

export function Phase1Diagnosis({ model, error, view = "overview" }: { model: DiagnosisViewModel; error?: string; view?: DiagnosisView }) {
  const { business, run } = model;
  const archived = business.status === "archived";
  // The workflow is authoritative for the approved presentation, not the
  // artifact alone: approval commits the artifact, then APPROVE_PHASE1 in a
  // second transaction. Any disagreement fails closed and is never repaired here.
  const approvedWorkflow = model.workflowState === "PHASE1_APPROVED";
  const hasApprovedArtifact = model.approved !== null;
  const approvalMismatch = approvedWorkflow !== hasApprovedArtifact;
  const approvedState = approvedWorkflow && hasApprovedArtifact;
  const readOnly = archived || approvalMismatch;
  // REVISION_REQUIRED never offers Run: v1 revision needs a newer snapshot.
  const canGenerate = !readOnly && (model.workflowState === "PHASE1_READY"
    || (model.workflowState === "PHASE1_ANALYSING" && run?.status === "FAILED"));
  const revisionRequired = model.workflowState === "REVISION_REQUIRED";
  const reviewing = model.workflowState === "PHASE1_AWAITING_REVIEW" && run?.status === "SUCCEEDED";
  const allDecided = model.items.length > 0 && model.items.every((item) => item.decision);
  const anySurviving = model.items.some((item) => item.decision?.decision === "ACCEPTED" || item.decision?.decision === "CORRECTED");
  const header = <>
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${business.id}`}>{business.name}</Link> <span aria-hidden="true">/</span> Phase 1 Diagnosis</nav>
    <p className="context-name">{business.name}</p>
    <h1 className="task-title">{approvedState ? "Phase 1 Diagnosis — Approved" : "Phase 1 Diagnosis"}</h1>
  </>;

  // Workflow says approved but no approved diagnosis exists: show nothing that could be mistaken for it.
  if (approvedWorkflow && !hasApprovedArtifact) {
    return <main>
      {header}
      <p className="error" role="alert" data-integrity="approved-without-artifact"><strong>Integrity check failed.</strong> The workflow is recorded as {label(model.workflowState)}, but no approved diagnosis exists for the current diagnosis run. The diagnosis is not shown and no action is available. Nothing has been changed.</p>
    </main>;
  }

  const provenance = run ? <Provenance model={model} /> : null;
  const gaps = model.gaps.length ? <section data-section="gaps"><h2>Known evidence gaps carried forward</h2><p className="muted">These remain open. Missing data is not evidence of poor performance.</p>
    <ul>{model.gaps.map((gap) => <li key={gap.handle}><code>{gap.handle}</code> · {gap.materiality} materiality · {label(gap.area)}: {gap.missingInformation}</li>)}</ul></section> : null;
  const calculations = model.calculations.length ? <section data-section="calculations"><h2>Software calculations</h2><p className="muted">Derived by software from canonical Metrics. They are calculated, not founder-supplied evidence.</p>
    <ul>{model.calculations.map((calculation) => <li key={calculation.handle}><code>{calculation.handle}</code> · {calculation.label}: {numeric(calculation)} · Formula: {calculation.formula} · Sources: {calculation.sources.join(", ")} · Rule {calculation.ruleKey} {calculation.ruleVersion}</li>)}</ul></section> : null;
  const items = model.items.length ? <section data-section="items">
    <h2>Diagnosis items</h2>
    <p className="note">Every field below is AI-proposed and will be recorded exactly as shown if you accept. Correct or reject anything you disagree with.</p>
    {reviewing && !model.session && !readOnly ? <form action={startDiagnosisReviewAction} className="panel">
      <input type="hidden" name="businessId" value={business.id} />
      <input type="hidden" name="runId" value={run!.id} />
      <label>Your name or identifier<input name="reviewerId" required /></label>
      <button type="submit">Start review</button>
    </form> : null}
    <div className="record-list">{model.items.map((item) => <ItemCard key={item.id} model={model} item={item} readOnly={readOnly} />)}</div>
  </section> : null;

  return <main>
    {header}
    {approvedState ? null : <p className="lede">An AI analysis of one immutable evidence snapshot. It is analytical, not canonical: it never changes Claims, Evidence or Metrics, and nothing advances until a person reviews every item and approves.</p>}
    {error ? <p className="error" role="alert">{error}</p> : null}
    {archived ? <div className="notice"><strong>Archived — read-only</strong></div> : null}
    {approvalMismatch ? <p className="error" role="alert" data-integrity="artifact-without-approved-workflow"><strong>Integrity check failed.</strong> An approved diagnosis exists for this run, but the workflow is {label(model.workflowState)}, not PHASE1 APPROVED. The diagnosis is shown read-only for its current workflow state, and no action is available. Nothing has been changed.</p> : null}

    {canGenerate ? <section className="status-panel">
      <p className="eyebrow">Workflow: {label(model.workflowState)}</p>
      <h2>{run?.status === "FAILED" ? "The last diagnosis failed validation" : "Ready for Phase 1 Diagnosis"}</h2>
      <p>The diagnosis reads snapshot {model.snapshot?.version} exactly as recorded, with its known evidence gaps. You will review every item before anything is approved.</p>
      <form action={generateDiagnosisAction}><input type="hidden" name="businessId" value={business.id} />
        <button type="submit">{run?.status === "FAILED" ? "Retry diagnosis" : "Run Phase 1 Diagnosis"}</button></form>
    </section> : null}
    {revisionRequired ? <section className="status-panel" aria-labelledby="revision-heading">
      <p className="eyebrow">Workflow: {label(model.workflowState)}</p>
      <h2 id="revision-heading">Revision requested: updated evidence needed</h2>
      <p>{REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE}</p>
      <p className="muted">The diagnosis sent for revision stays below, unchanged, as a record of snapshot {model.snapshot?.version}.</p>
      {!readOnly ? <Link className="button-link" href={`/businesses/${business.id}/information`}>Add Information</Link> : null}
    </section> : null}
    {!canGenerate && !run && !archived ? <section className="empty-state"><h2>Phase 1 Diagnosis is not available yet</h2><p>Continue with the latest snapshot&apos;s known gaps first.</p></section> : null}
    {run?.status === "RUNNING" ? <section className="status-panel"><p className="eyebrow">Diagnosis in progress</p><h2>Analysing snapshot {model.snapshot?.version}</h2></section> : null}

    {approvedState ? <ApprovedDiagnosis model={model} view={view} /> : <>
      {provenance}
      {gaps}
      {calculations}
      {items}
    </>}

    {reviewing && model.session?.status === "OPEN" && !readOnly ? <section className="panel" aria-labelledby="approve-heading">
      <h2 id="approve-heading">Approve the diagnosis</h2>
      <p>Approval accepts this diagnosis as the analytical basis for the next strategic phase. It does not make any Claim true, resolve any gap, or approve any recommendation.</p>
      {allDecided && !anySurviving
        ? <p className="notice" role="status">Every item was rejected, so this diagnosis cannot be approved. Request a revised diagnosis below.</p>
        : allDecided
        ? <form action={approveDiagnosisAction}>
          <p className="notice" role="note"><strong>You are approving the final reviewed diagnosis shown above.</strong> Corrected items use the corrected values displayed here; rejected items will not be included.</p>
          <input type="hidden" name="businessId" value={business.id} />
          <input type="hidden" name="reviewSessionId" value={model.session.id} />
          <input type="hidden" name="reviewerId" value={model.session.reviewerId} />
          <button type="submit">Approve diagnosis</button></form>
        : <p className="muted">Decide every item (accept, correct or reject) before approving.</p>}
    </section> : null}
    {reviewing && !readOnly ? <form action={requestDiagnosisRevisionAction} className="panel">
      <input type="hidden" name="businessId" value={business.id} />
      <label>Reason for requesting a revised diagnosis<input name="reason" /></label>
      <button type="submit" className="secondary">Request a revised diagnosis</button>
    </form> : null}
  </main>;
}
