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
  diagnosisLabelDefinitions,
  diagnosisMaterialities,
} from "@/domain/phase1-diagnosis";
import {
  diagnosisReviewFields,
  formatReferenceLines,
} from "@/domain/phase1-diagnosis-review-card";
import type { DiagnosisViewModel } from "@/services/phase1-diagnosis-service";

type Item = DiagnosisViewModel["items"][number];

const label = (value: string) => value.replaceAll("_", " ");

function numeric(calculation: DiagnosisViewModel["calculations"][number]) {
  const value = calculation.valuePrecision === "range"
    ? `${calculation.valueLower}–${calculation.valueUpper}`
    : calculation.valueNumeric;
  return `${value} ${calculation.unit} (precision: ${calculation.valuePrecision})`;
}

/** Renders one material field exactly as persisted. */
function FieldValue({ item, field }: { item: Item; field: (typeof diagnosisReviewFields)[number]["field"] }) {
  if (field === "references") {
    return item.references.length
      ? <ul className="reference-list">{item.references.map((reference) => <li key={`${reference.handle}-${reference.role}`}>
        <code>{reference.handle}</code> · {label(reference.role)} · {reference.entityType}: {reference.label}
      </li>)}</ul>
      : <span className="muted">No references</span>;
  }
  if (field === "grounding") {
    return <>{label(item.grounding)} <span className="muted">({diagnosisLabelDefinitions.grounding[item.grounding as keyof typeof diagnosisLabelDefinitions.grounding]})</span></>;
  }
  if (field === "materiality") {
    return <>{item.materiality} <span className="muted">({diagnosisLabelDefinitions.materiality})</span></>;
  }
  if (field === "interpretationConfidence") {
    return item.interpretationConfidence
      ? <>{item.interpretationConfidence} <span className="muted">({diagnosisLabelDefinitions.interpretationConfidence})</span></>
      : <span className="muted">Not given</span>;
  }
  if (field === "limitations") return item.limitations ? <>{item.limitations}</> : <span className="muted">None stated</span>;
  if (field === "itemType") return <>{label(item.itemType)}</>;
  return <>{item[field]}</>;
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

function ItemCard({ model, item }: { model: DiagnosisViewModel; item: Item }) {
  const canDecide = model.session?.status === "OPEN" && !item.decision && model.business.status !== "archived";
  return <article className="record-card" aria-label={`Diagnosis item ${item.itemRef}`}>
    <p className="eyebrow">{item.itemRef} · AI-proposed diagnosis item</p>
    <h3>{item.statement}</h3>
    <dl className="review-record-details">
      {diagnosisReviewFields.map(({ field, label: fieldLabel }) => <div key={field} data-field={field}>
        <dt>{fieldLabel}</dt><dd><FieldValue item={item} field={field} /></dd>
      </div>)}
    </dl>
    {item.decision ? <p className="notice"><strong>Decision: {item.decision.decision}</strong>{item.decision.reason ? ` — ${item.decision.reason}` : ""}
      {item.decision.correctedPayload ? <span className="muted"> Corrected values: {String(item.decision.correctedPayload.statement ?? "")}</span> : null}</p> : null}
    {canDecide ? <DecisionForms model={model} item={item} /> : null}
  </article>;
}

function Provenance({ model }: { model: DiagnosisViewModel }) {
  const run = model.run!;
  const rows: Array<[string, string]> = [
    ["Diagnosis run", run.id],
    ["Snapshot", model.snapshot ? `${model.snapshot.id} (version ${model.snapshot.version})` : "none"],
    ["Snapshot content hash", run.snapshotContentHash ?? "unrecorded"],
    ["Input version", run.inputProjectionVersion],
    ["Prompt version", run.promptVersion],
    ["Input hash", run.inputHash],
    ["Provider / model", `${run.provider} / ${run.modelIdentifier}`],
    ["Started", run.createdAt],
    ["Completed", run.completedAt ?? "not completed"],
  ];
  return <details className="review-provenance"><summary>Provenance (recorded by Baslon OS, read-only)</summary>
    <dl>{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
  </details>;
}

function Approved({ model }: { model: DiagnosisViewModel }) {
  const approved = model.approved!;
  const content = approved.content as {
    semantics?: string;
    decisions?: Record<string, number>;
    items?: Array<{ itemRef: string; decision: string; itemType: string; statement: string; grounding: string; materiality: string }>;
    excludedItems?: Array<{ itemRef: string; reason: string | null }>;
  };
  return <section className="panel" aria-labelledby="approved-heading">
    <p className="eyebrow">Approved diagnosis · version {approved.version}</p>
    <h2 id="approved-heading">Approved analytical basis for the next strategic phase</h2>
    <p>Approved by {approved.approvedBy} at {approved.approvedAt}.</p>
    <p className="note">{content.semantics}</p>
    <p className="muted">Decisions: {Object.entries(content.decisions ?? {}).map(([key, value]) => `${value} ${key.toLowerCase()}`).join(" · ")}</p>
    <ol>{(content.items ?? []).map((item) => <li key={item.itemRef}><strong>{label(item.itemType)}</strong> ({label(item.grounding)}, {item.materiality} materiality, {item.decision.toLowerCase()}): {item.statement}</li>)}</ol>
    {content.excludedItems?.length ? <p className="muted">Rejected and excluded: {content.excludedItems.map((item) => item.itemRef).join(", ")}</p> : null}
  </section>;
}

export function Phase1Diagnosis({ model, error }: { model: DiagnosisViewModel; error?: string }) {
  const { business, run } = model;
  const archived = business.status === "archived";
  const canGenerate = !archived && (["PHASE1_READY", "REVISION_REQUIRED"].includes(model.workflowState)
    || (model.workflowState === "PHASE1_ANALYSING" && run?.status === "FAILED"));
  const reviewing = model.workflowState === "PHASE1_AWAITING_REVIEW" && run?.status === "SUCCEEDED";
  const allDecided = model.items.length > 0 && model.items.every((item) => item.decision);
  return <main>
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${business.id}`}>{business.name}</Link> <span aria-hidden="true">/</span> Phase 1 Diagnosis</nav>
    <p className="context-name">{business.name}</p>
    <h1 className="task-title">Phase 1 Diagnosis</h1>
    <p className="lede">An AI analysis of one immutable evidence snapshot. It is analytical, not canonical: it never changes Claims, Evidence or Metrics, and nothing advances until a person reviews every item and approves.</p>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {archived ? <div className="notice"><strong>Archived — read-only</strong></div> : null}

    {canGenerate ? <section className="status-panel">
      <p className="eyebrow">Workflow: {label(model.workflowState)}</p>
      <h2>{run?.status === "FAILED" ? "The last diagnosis failed validation" : "Ready for Phase 1 Diagnosis"}</h2>
      <p>The diagnosis reads snapshot {model.snapshot?.version} exactly as recorded, with its known evidence gaps. You will review every item before anything is approved.</p>
      <form action={generateDiagnosisAction}><input type="hidden" name="businessId" value={business.id} />
        <button type="submit">{run?.status === "FAILED" ? "Retry diagnosis" : "Run Phase 1 Diagnosis"}</button></form>
    </section> : null}
    {!canGenerate && !run && !archived ? <section className="empty-state"><h2>Phase 1 Diagnosis is not available yet</h2><p>Continue with the latest snapshot&apos;s known gaps first.</p></section> : null}
    {run?.status === "RUNNING" ? <section className="status-panel"><p className="eyebrow">Diagnosis in progress</p><h2>Analysing snapshot {model.snapshot?.version}</h2></section> : null}

    {run ? <Provenance model={model} /> : null}

    {model.gaps.length ? <section><h2>Known evidence gaps carried forward</h2><p className="muted">These remain open. Missing data is not evidence of poor performance.</p>
      <ul>{model.gaps.map((gap) => <li key={gap.handle}><code>{gap.handle}</code> · {gap.materiality} materiality · {label(gap.area)}: {gap.missingInformation}</li>)}</ul></section> : null}
    {model.calculations.length ? <section><h2>Software calculations</h2><p className="muted">Derived by software from canonical Metrics. They are calculated, not founder-supplied evidence.</p>
      <ul>{model.calculations.map((calculation) => <li key={calculation.handle}><code>{calculation.handle}</code> · {calculation.label}: {numeric(calculation)} · Formula: {calculation.formula} · Sources: {calculation.sources.join(", ")} · Rule {calculation.ruleKey} {calculation.ruleVersion}</li>)}</ul></section> : null}

    {model.approved ? <Approved model={model} /> : null}

    {model.items.length ? <section><h2>Diagnosis items</h2>
      <p className="note">Every field below is AI-proposed and will be recorded exactly as shown if you accept. Correct or reject anything you disagree with.</p>
      {reviewing && !model.session && !archived ? <form action={startDiagnosisReviewAction} className="panel">
        <input type="hidden" name="businessId" value={business.id} />
        <input type="hidden" name="runId" value={run!.id} />
        <label>Your name or identifier<input name="reviewerId" required /></label>
        <button type="submit">Start review</button>
      </form> : null}
      <div className="record-list">{model.items.map((item) => <ItemCard key={item.id} model={model} item={item} />)}</div>
    </section> : null}

    {reviewing && model.session?.status === "OPEN" && !archived ? <section className="panel" aria-labelledby="approve-heading">
      <h2 id="approve-heading">Approve the diagnosis</h2>
      <p>Approval accepts this diagnosis as the analytical basis for the next strategic phase. It does not make any Claim true, resolve any gap, or approve any recommendation.</p>
      {allDecided
        ? <form action={approveDiagnosisAction}>
          <input type="hidden" name="businessId" value={business.id} />
          <input type="hidden" name="reviewSessionId" value={model.session.id} />
          <input type="hidden" name="reviewerId" value={model.session.reviewerId} />
          <button type="submit">Approve diagnosis</button></form>
        : <p className="muted">Decide every item (accept, correct or reject) before approving.</p>}
    </section> : null}
    {reviewing && !archived ? <form action={requestDiagnosisRevisionAction} className="panel">
      <input type="hidden" name="businessId" value={business.id} />
      <label>Reason for requesting a revised diagnosis<input name="reason" /></label>
      <button type="submit" className="secondary">Request a revised diagnosis</button>
    </form> : null}
  </main>;
}
