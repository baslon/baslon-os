import type { ReactNode } from "react";
import { diagnosisLabelDefinitions } from "@/domain/phase1-diagnosis";
import type { DiagnosisViewModel } from "@/services/phase1-diagnosis-service";
import { Disclosure } from "./disclosure";
import { ApprovalTime, Fields, provenanceRows } from "./phase1-diagnosis-shared";

/**
 * The approved Phase 1 Diagnosis, presented business meaning first and audit
 * detail last. Everything here is a deterministic projection of the frozen
 * approved artifact (plus the run's recorded provenance): no item is merged,
 * re-ranked, rewritten or summarised, and nothing is written.
 */

export const diagnosisViews = [
  { key: "overview", label: "Overview" },
  { key: "full", label: "Full Diagnosis" },
  { key: "gaps", label: "Evidence Gaps" },
  { key: "calculations", label: "Calculations" },
  { key: "audit", label: "Audit & Provenance" },
] as const;
export type DiagnosisView = (typeof diagnosisViews)[number]["key"];

export function parseDiagnosisView(value: string | undefined): DiagnosisView {
  return diagnosisViews.find((view) => view.key === value)?.key ?? "overview";
}

type ApprovedReference = { entityType: string; handle: string; role: string; id: string; label: string };
type ApprovedItem = {
  itemRef: string;
  diagnosisItemId: string;
  decision: string;
  reason: string | null;
  itemType: string;
  statement: string;
  rationale: string;
  grounding: string;
  materiality: string;
  interpretationConfidence: string | null;
  limitations: string | null;
  references: ApprovedReference[];
};
type ApprovedGap = { handle: string; id: string; analysisRunId: string; area: string; materiality: string; missingInformation: string; decisionImpact: string };
type ApprovedCalculation = {
  handle: string; id: string; ruleKey: string; ruleVersion: string; label: string; formula: string;
  valueNumeric: string | null; valuePrecision: string; valueLower: string | null; valueUpper: string | null; unit: string;
  sources: Array<{ entityType: string; id: string; handle: string }>;
};
export type ApprovedContent = {
  artifactVersion?: string;
  semantics?: string;
  analysisRunId?: string;
  reviewSessionId?: string;
  snapshot?: { id: string; version: number; contentHash: string | null };
  inputProjectionVersion?: string;
  promptVersion?: string;
  inputHash?: string;
  provider?: string;
  model?: string;
  reviewer?: string;
  decisions?: Record<string, number>;
  items?: ApprovedItem[];
  excludedItems?: Array<{ itemRef: string; decision: string; reason: string | null }>;
  calculations?: ApprovedCalculation[];
  carriedForwardGaps?: ApprovedGap[];
};

// Business language for the primary views. Raw values stay in Audit & Provenance.
const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const humanise = (value: string) => capitalise(value.replaceAll("_", " "));
export const itemTypeLabels: Record<string, string> = {
  position: "Current position", strength: "Strength", constraint: "Constraint", risk: "Risk",
  opportunity: "Opportunity", limitation: "Limitation", decision_required: "Decision required",
};
const itemTypePlurals: Record<string, [string, string]> = {
  position: ["current position", "current positions"], strength: ["strength", "strengths"],
  constraint: ["constraint", "constraints"], risk: ["risk", "risks"], opportunity: ["opportunity", "opportunities"],
  limitation: ["limitation", "limitations"], decision_required: ["decision required", "decisions required"],
};
export const groundingLabels: Record<string, string> = {
  evidence_backed: "Evidence-backed", calculated: "Calculated", interpretive: "Interpretive", hypothesis: "Hypothesis",
};
export const decisionLabels: Record<string, string> = { ACCEPTED: "Accepted", CORRECTED: "Corrected", REJECTED: "Rejected" };
const roleLabels: Record<string, string> = { primary: "Primary support", context: "Context", limiting_gap: "Limiting evidence gap" };
const entityLabels: Record<string, string> = { claim: "Claim", evidence: "Evidence", metric: "Metric", gap: "Evidence gap", calculation: "Calculation" };
const precisionLabels: Record<string, string> = { exact: "Exact", approximate: "Approximate", estimate: "Estimate", range: "Range", unspecified: "Precision unspecified" };
export const importanceLabel = (materiality: string) => `${humanise(materiality)} importance`;
const typeLabel = (itemType: string) => itemTypeLabels[itemType] ?? humanise(itemType);
const countOf = (count: number, itemType: string) => {
  const [one, many] = itemTypePlurals[itemType] ?? [humanise(itemType).toLowerCase(), humanise(itemType).toLowerCase()];
  return `${count} ${count === 1 ? one : many}`;
};
const typeOrder = ["position", "strength", "constraint", "risk", "opportunity", "limitation", "decision_required"];

/** Display a stored decimal amount; no arithmetic beyond formatting. */
export function formatCalculationValue(calculation: Pick<ApprovedCalculation, "valueNumeric" | "valuePrecision" | "valueLower" | "valueUpper" | "unit">) {
  const amount = (value: string | null) => value === null ? "—" : Number(value).toLocaleString("en-GB", { maximumFractionDigits: 4 });
  const money = calculation.unit.startsWith("GBP");
  const figure = (value: string | null) => money ? `£${amount(value)}` : amount(value);
  const unit = money ? calculation.unit.slice(3) : ` ${calculation.unit}`;
  return calculation.valuePrecision === "range"
    ? `${figure(calculation.valueLower)}–${figure(calculation.valueUpper)}${unit}`
    : `${figure(calculation.valueNumeric)}${unit}`;
}

function Badges({ item }: { item: ApprovedItem }) {
  return <p className="badges">
    <span className="badge">{typeLabel(item.itemType)}</span>
    <span className="badge">{importanceLabel(item.materiality)}</span>
    <span className={`badge decision-${item.decision.toLowerCase()}`}>{decisionLabels[item.decision] ?? humanise(item.decision)}</span>
  </p>;
}

/** Second level of disclosure: the reasoning, the grounding and the supporting sources. */
function ItemDetail({ item, showSourceHandles }: { item: ApprovedItem; showSourceHandles: boolean }) {
  const references = item.references ?? [];
  return <dl className="item-detail">
    <div><dt>Reasoning</dt><dd>{item.rationale}</dd></div>
    <div><dt>Limitations</dt><dd>{item.limitations ?? <span className="muted">None stated</span>}</dd></div>
    <div><dt>Grounding</dt><dd>{groundingLabels[item.grounding] ?? humanise(item.grounding)} <span className="muted">({diagnosisLabelDefinitions.grounding[item.grounding as keyof typeof diagnosisLabelDefinitions.grounding] ?? ""})</span></dd></div>
    {item.interpretationConfidence ? <div><dt>Interpretation confidence</dt><dd>{humanise(item.interpretationConfidence)} <span className="muted">({diagnosisLabelDefinitions.interpretationConfidence})</span></dd></div> : null}
    <div><dt>Supporting evidence</dt><dd>
      {references.length} {references.length === 1 ? "source" : "sources"}
      {showSourceHandles
        ? <Disclosure label="View sources" className="nested">
          <ul className="source-list">{references.map((reference) => <li key={`${reference.handle}-${reference.role}`}>
            <strong>{roleLabels[reference.role] ?? humanise(reference.role)}</strong> · {entityLabels[reference.entityType] ?? humanise(reference.entityType)}: {reference.label} <code>{reference.handle}</code>
          </li>)}</ul>
        </Disclosure>
        : <> · <a href={`?view=full#finding-${item.itemRef}`}>View sources in Full Diagnosis</a></>}
    </dd></div>
    <div><dt>Review decision</dt><dd>
      {decisionLabels[item.decision] ?? humanise(item.decision)}
      {item.reason ? <> — {item.reason}</> : null}
      {item.decision === "CORRECTED" ? <span className="muted"> These are the corrected values. The original AI proposal is kept in <a href="?view=audit">Audit &amp; Provenance</a>.</span> : null}
    </dd></div>
  </dl>;
}

function FindingCard({ item, showSourceHandles }: { item: ApprovedItem; showSourceHandles: boolean }) {
  return <article className="record-card finding-card" id={showSourceHandles ? `finding-${item.itemRef}` : undefined}>
    <Badges item={item} />
    <h3>{item.statement}</h3>
    <Disclosure label="View reasoning & evidence"><ItemDetail item={item} showSourceHandles={showSourceHandles} /></Disclosure>
  </article>;
}

function Group({ id, title, items, showSourceHandles, className }: { id: string; title: string; items: ApprovedItem[]; showSourceHandles: boolean; className?: string }) {
  if (!items.length) return null;
  return <section id={id} data-group={id} className={className} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>{title} <span className="muted">({items.length})</span></h2>
    <div className="record-list">{items.map((item) => <FindingCard key={item.itemRef} item={item} showSourceHandles={showSourceHandles} />)}</div>
  </section>;
}

const byType = (items: ApprovedItem[], ...types: string[]) => items.filter((item) => types.includes(item.itemType));

function Overview({ content }: { content: ApprovedContent }) {
  const items = content.items ?? [];
  const gaps = content.carriedForwardGaps ?? [];
  const limitations = byType(items, "limitation");
  const counts = typeOrder.map((type) => [type, byType(items, type).length] as const).filter(([, count]) => count > 0);
  const gapSeverity = ["high", "medium", "low"].map((level) => [level, gaps.filter((gap) => gap.materiality === level).length] as const).filter(([, count]) => count > 0);
  return <>
    <section aria-labelledby="glance-heading" className="glance">
      <h2 id="glance-heading">Diagnosis at a glance</h2>
      <p><strong>{items.length} reviewed findings</strong></p>
      <ul className="glance-counts">{counts.map(([type, count]) => <li key={type}>{countOf(count, type)}</li>)}</ul>
    </section>
    {byType(items, "position").length ? <section id="position" data-group="position" aria-labelledby="position-heading">
      <h2 id="position-heading">Current position</h2>
      {byType(items, "position").map((item) => <div key={item.itemRef} className="position-summary">
        <p className="position-statement">{item.statement}</p>
        <Disclosure label="View reasoning & evidence"><ItemDetail item={item} showSourceHandles={false} /></Disclosure>
      </div>)}
    </section> : null}
    <Group id="working" title="What’s working" items={byType(items, "strength")} showSourceHandles={false} />
    <Group id="holding-back" title="What’s holding growth back" items={byType(items, "constraint", "risk")} showSourceHandles={false} />
    <Group id="opportunities" title="Opportunities" items={byType(items, "opportunity")} showSourceHandles={false} />
    <Group id="decisions" title="Decisions required" items={byType(items, "decision_required")} showSourceHandles={false} className="decisions-required" />
    {limitations.length ? <section aria-labelledby="limitations-summary-heading" className="summary-block" data-group="limitations-summary">
      <h2 id="limitations-summary-heading">Diagnostic limitations</h2>
      <p>{limitations.length} known {limitations.length === 1 ? "limitation affects" : "limitations affect"} how confidently some findings can be interpreted.</p>
      <a href="?view=full#limitations">View limitations</a>
    </section> : null}
    {gaps.length ? <section aria-labelledby="gaps-summary-heading" className="summary-block" data-group="gaps-summary">
      <h2 id="gaps-summary-heading">Known evidence gaps</h2>
      <p>{gaps.length} {gaps.length === 1 ? "gap remains" : "gaps remain"} unresolved. <span className="muted">{gapSeverity.map(([level, count]) => `${count} ${level}`).join(" · ")}</span></p>
      <p className="muted">Missing information is not evidence of poor performance.</p>
      <a href="?view=gaps">View evidence gaps</a>
    </section> : null}
  </>;
}

function FullDiagnosis({ content }: { content: ApprovedContent }) {
  const items = content.items ?? [];
  return <>
    <Group id="position" title="Current position" items={byType(items, "position")} showSourceHandles />
    <Group id="strengths" title="Strengths" items={byType(items, "strength")} showSourceHandles />
    <Group id="constraints-risks" title="Constraints & risks" items={byType(items, "constraint", "risk")} showSourceHandles />
    <Group id="opportunities" title="Opportunities" items={byType(items, "opportunity")} showSourceHandles />
    <Group id="limitations" title="Limitations" items={byType(items, "limitation")} showSourceHandles />
    <Group id="decisions" title="Decisions required" items={byType(items, "decision_required")} showSourceHandles className="decisions-required" />
    {/* Any item type added later is still shown rather than silently dropped. */}
    <Group id="other" title="Other findings" items={items.filter((item) => !typeOrder.includes(item.itemType))} showSourceHandles />
  </>;
}

function EvidenceGaps({ content }: { content: ApprovedContent }) {
  const gaps = content.carriedForwardGaps ?? [];
  return <section aria-labelledby="gaps-heading">
    <h2 id="gaps-heading">Evidence Gaps</h2>
    <p>{gaps.length} known evidence {gaps.length === 1 ? "gap remains" : "gaps remain"} unresolved.</p>
    <p className="muted">Missing information is not evidence of poor performance.</p>
    <div className="record-list">{gaps.map((gap) => <article key={gap.handle} className="record-card" data-gap={gap.area}>
      <p className="badges"><span className="badge">{importanceLabel(gap.materiality)}</span></p>
      <h3>{humanise(gap.area)}</h3>
      <p>{gap.missingInformation}</p>
      <p><strong>Why this matters:</strong> {gap.decisionImpact}</p>
    </article>)}</div>
  </section>;
}

function Calculations({ content }: { content: ApprovedContent }) {
  const calculations = content.calculations ?? [];
  return <section aria-labelledby="calculations-heading">
    <h2 id="calculations-heading">Calculations</h2>
    <p className="muted">Derived by software from canonical Metrics. They are calculated, not founder-supplied evidence.</p>
    <div className="record-list">{calculations.map((calculation) => <article key={calculation.handle} className="record-card" data-calculation={calculation.ruleKey}>
      <h3>{calculation.label}</h3>
      <p className="metric-value">{formatCalculationValue(calculation)}</p>
      <p className="badges">
        <span className="badge">{precisionLabels[calculation.valuePrecision] ?? humanise(calculation.valuePrecision)}</span>
        <span className="badge">Derived value</span>
      </p>
      {calculation.ruleKey === "annualised_run_rate" ? <p>A monthly figure annualised: a run-rate, not realised annual revenue.</p> : null}
      <Disclosure label="Calculation details">
        <dl className="item-detail">
          <div><dt>Formula</dt><dd>{calculation.formula}</dd></div>
          <div><dt>Calculation version</dt><dd>{calculation.ruleKey} {calculation.ruleVersion}</dd></div>
          <div><dt>Precision</dt><dd>{calculation.valuePrecision}</dd></div>
          <div><dt>Source metric</dt><dd>{calculation.sources.map((source) => source.handle).join(", ")}</dd></div>
          <div><dt>Calculation reference</dt><dd><code>{calculation.handle}</code></dd></div>
        </dl>
      </Disclosure>
    </article>)}</div>
  </section>;
}

function Rows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="audit-rows">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}

function AuditProvenance({ model, content }: { model: DiagnosisViewModel; content: ApprovedContent }) {
  const approved = model.approved!;
  const items = content.items ?? [];
  const gaps = content.carriedForwardGaps ?? [];
  const calculations = content.calculations ?? [];
  const references = [...new Map(items.flatMap((item) => item.references ?? []).map((reference) => [reference.handle, reference])).values()]
    .toSorted((left, right) => left.handle.localeCompare(right.handle));
  const original = new Map(model.items.map((item) => [item.itemRef, item]));
  return <section aria-labelledby="audit-heading">
    <h2 id="audit-heading">Audit &amp; Provenance</h2>
    <p className="muted">Recorded by Baslon OS and read-only. System identifiers, hashes and internal handles are kept here.</p>
    <Disclosure label="Approval record" className="audit-group">
      <Rows rows={[
        ["Approved diagnosis", approved.id],
        ["Version", String(approved.version)],
        ["Artifact contract", content.artifactVersion ?? "unrecorded"],
        ["Approved by", approved.approvedBy],
        ["Approved at", <><ApprovalTime iso={approved.approvedAt} /> ({approved.approvedAt})</>],
        ["Workflow state", model.workflowState],
        ["Review session", `${model.session?.id ?? content.reviewSessionId ?? "unrecorded"} (${model.session?.status ?? "unrecorded"})`],
        ["Decisions", Object.entries(content.decisions ?? {}).map(([key, value]) => `${key} ${value}`).join(" · ")],
        ["Approval meaning", content.semantics ?? ""],
      ]} />
    </Disclosure>
    <Disclosure label="Snapshot provenance" className="audit-group">
      <Rows rows={[
        ["Snapshot", content.snapshot ? `${content.snapshot.id} (version ${content.snapshot.version})` : "unrecorded"],
        ["Snapshot content hash", content.snapshot?.contentHash ?? "unrecorded"],
        ["Gap source run", [...new Set(gaps.map((gap) => gap.analysisRunId))].join(", ") || "unrecorded"],
      ]} />
    </Disclosure>
    <Disclosure label="Diagnosis run" className="audit-group">
      <Rows rows={provenanceRows(model)} />
    </Disclosure>
    <Disclosure label="Review history" className="audit-group">
      <ol className="review-history">{items.map((item) => <li key={item.itemRef} data-audit-item={item.itemRef}>
        <strong>{item.itemRef}</strong> · {item.itemType} · {item.decision}{item.reason ? ` — ${item.reason}` : ""}
        {item.decision === "CORRECTED" && original.get(item.itemRef) ? <div data-section="original-ai">
          <p className="muted">Original AI proposal (superseded by the correction above):</p>
          <Fields item={original.get(item.itemRef)!} />
        </div> : null}
      </li>)}</ol>
      {content.excludedItems?.length ? <p>Rejected and excluded: {content.excludedItems.map((item) => item.itemRef).join(", ")}</p> : null}
    </Disclosure>
    <Disclosure label="Reference map" className="audit-group">
      <table className="reference-map"><thead><tr><th scope="col">Handle</th><th scope="col">Type</th><th scope="col">Record</th><th scope="col">Canonical ID</th></tr></thead>
        <tbody>
          {references.map((reference) => <tr key={reference.handle}><td><code>{reference.handle}</code></td><td>{reference.entityType}</td><td>{reference.label}</td><td>{reference.id}</td></tr>)}
          {gaps.map((gap) => <tr key={gap.handle}><td><code>{gap.handle}</code></td><td>gap</td><td>{gap.missingInformation}</td><td>{gap.id}</td></tr>)}
          {calculations.map((calculation) => <tr key={calculation.handle}><td><code>{calculation.handle}</code></td><td>calculation</td><td>{calculation.label} (from {calculation.sources.map((source) => source.handle).join(", ")})</td><td>{calculation.id}</td></tr>)}
        </tbody>
      </table>
    </Disclosure>
  </section>;
}

/** Only rendered by Phase1Diagnosis when the workflow is PHASE1_APPROVED and the artifact exists. */
export function ApprovedDiagnosis({ model, view }: { model: DiagnosisViewModel; view: DiagnosisView }) {
  const approved = model.approved!;
  const content = approved.content as ApprovedContent;
  const decisions = content.decisions ?? {};
  return <>
    <section className="approved-header" aria-labelledby="approved-summary-heading">
      <h2 id="approved-summary-heading" className="sr-only">Approval summary</h2>
      <p>Approved by {approved.approvedBy} · <ApprovalTime iso={approved.approvedAt} /> · Version {approved.version}</p>
      <p>{(content.items ?? []).length} diagnosis items · {decisions.ACCEPTED ?? 0} accepted · {decisions.CORRECTED ?? 0} corrected · {decisions.REJECTED ?? 0} rejected</p>
      {content.semantics ? <p className="note">{content.semantics}</p> : null}
    </section>
    <nav className="tabs diagnosis-tabs" aria-label="Diagnosis views">
      {diagnosisViews.map((entry) => <a key={entry.key} href={`?view=${entry.key}`} className={entry.key === view ? "active" : undefined} aria-current={entry.key === view ? "page" : undefined}>{entry.label}</a>)}
    </nav>
    <div data-view={view}>
      {view === "overview" ? <Overview content={content} /> : null}
      {view === "full" ? <FullDiagnosis content={content} /> : null}
      {view === "gaps" ? <EvidenceGaps content={content} /> : null}
      {view === "calculations" ? <Calculations content={content} /> : null}
      {view === "audit" ? <AuditProvenance model={model} content={content} /> : null}
    </div>
  </>;
}
