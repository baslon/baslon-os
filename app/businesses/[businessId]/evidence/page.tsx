import Link from "next/link";
import { admitFactAction } from "../../../actions";
import { getEvidenceStateService, getEvidenceReviewService } from "@/foundation";
import { buildEvidenceStateSummary } from "@/domain/evidence-state-summary";
import { EvidenceStateSummary } from "../../../evidence-state-summary";
import { EvidenceStateOverview } from "../../../evidence-state-overview";
import { FactAdmissionAction } from "../../../fact-admission-action";
import { EvidenceValue } from "../../../evidence-value";
import { formatWorkspaceMetric } from "@/domain/workspace-metrics";
import { acceptsAddInformation } from "@/domain/workflow";
import { numericPrecisionLabel } from "@/domain/numeric-precision";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string; view?: string; claimType?: string }>;
};

type EvidenceState = Awaited<ReturnType<ReturnType<typeof getEvidenceStateService>["getCurrent"]>>;
type Claim = EvidenceState["claims"]["facts"][number];

const claimGroups = [
  ["facts", "Facts"],
  ["observations", "Observations"],
  ["managementBeliefs", "Management beliefs"],
  ["hypotheses", "Hypotheses"],
  ["aiInferences", "AI inferences"],
  ["unknowns", "Unknowns"],
] as const;

function sourceLabel(sourceType: string) {
  if (sourceType === "business_intake") return "Business information";
  if (sourceType === "human_fact_admission") return "Human fact admission";
  return sourceType.replaceAll("_", " ");
}

function ClaimCard({ claim, businessId, evidenceItems, readOnly }: { claim: Claim; businessId: string; evidenceItems: EvidenceState["evidence"]; readOnly: boolean }) {
  return <article className="record-card">
    <p className="eyebrow">{claim.claimType.replaceAll("_", " ")}</p>
    <h3>{claim.statement}</h3>
    <p className="record-attributes"><span>{claim.confidenceLevel} confidence</span><span>{claim.subjectArea}</span></p>
    {claim.lineage ? <p className="muted">Human reviewed · {claim.lineage.review.decision.toLowerCase()}</p> : <p className="muted">Entered outside Evidence Review.</p>}
    <details className="audit-details"><summary>Audit details</summary>
      <pre>{JSON.stringify(claim.confidenceBasis, null, 2)}</pre>
      {!readOnly && claim.claimType !== "fact" && evidenceItems.length > 0 ? <FactAdmissionAction>
        <form action={admitFactAction} className="form-grid compact-form">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="claimId" value={claim.id} />
          <input type="hidden" name="statement" value={claim.statement} />
          <input type="hidden" name="subjectArea" value={claim.subjectArea} />
          <label>Supporting evidence<select name="evidenceId" required defaultValue=""><option value="" disabled>Select evidence</option>{evidenceItems.map((item) => <option key={item.id} value={item.id}>{item.statement}</option>)}</select></label>
          <label>Reviewer identity<input name="reviewerId" required placeholder="Your name or internal identifier" /></label>
          <label>Confirmation basis<textarea name="basis" required placeholder="Why this evidence supports factual admission" /></label>
          <button type="submit">Confirm fact admission</button>
        </form>
      </FactAdmissionAction> : null}
    </details>
  </article>;
}

export default async function EvidenceStatePage({ params, searchParams }: PageProps) {
  const { businessId } = await params;
  const query = await searchParams;
  const state = await getEvidenceStateService().getCurrent(businessId);
  const workflowState = await getEvidenceReviewService().getWorkflowState(businessId);
  const view = ["overview", "claims", "evidence", "metrics", "relationships"].includes(query.view ?? "") ? query.view! : "overview";
  const reviewedEvidence = state.evidence.filter((item) => item.lineage && ["ACCEPTED", "CORRECTED"].includes(item.lineage.review.decision));
  const groups = claimGroups.map(([key, label]) => ({ key, label, items: state.claims[key] }));
  const allClaims = groups.flatMap((group) => group.items);
  const selectedGroup = groups.find((group) => group.key === query.claimType);
  const visibleClaims = selectedGroup?.items ?? allClaims;
  const claimById = new Map(allClaims.map((claim) => [claim.id, claim]));
  const evidenceById = new Map(state.evidence.map((item) => [item.id, item]));
  const summaries = buildEvidenceStateSummary({
    facts: state.claims.facts.length,
    observations: state.claims.observations.length,
    managementBeliefs: state.claims.managementBeliefs.length,
    hypotheses: state.claims.hypotheses.length,
    aiInferences: state.claims.aiInferences.length,
    unknowns: state.claims.unknowns.length,
    evidence: state.evidence.length,
    metrics: state.metrics.length,
    relationships: state.relationships.length,
  });
  const tabs = [["overview", "Overview"], ["claims", "Claims"], ["evidence", "Evidence"], ["metrics", "Metrics"], ["relationships", "Relationships"]] as const;
  const archived = state.business.status === "archived";

  return <main>
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${businessId}`}>{state.business.name}</Link> <span aria-hidden="true">/</span> Evidence State</nav>
    <p className="context-name">{state.business.name}</p>
    <h1 className="task-title">Evidence State</h1>
    <p className="lede">Reviewed information currently held about this business.</p>
    {!archived && acceptsAddInformation(workflowState) ? <Link className="button-link secondary-link" href={`/businesses/${businessId}/information`}>Add Information</Link> : null}
    <Link className="button-link secondary-link" href={`/businesses/${businessId}/evidence-quality`}>View Evidence Quality</Link>
    {archived ? <div className="notice"><strong>Archived — read-only</strong><p>Restore this business before making changes to its Evidence State.</p></div> : null}
    {query.error ? <p className="error" role="alert">That change could not be saved. Please review it and try again.</p> : null}

    <EvidenceStateSummary summary={summaries} />
    <nav className="tabs" aria-label="Evidence State sections">{tabs.map(([key, label]) => <Link key={key} className={view === key ? "active" : ""} aria-current={view === key ? "page" : undefined} href={`?view=${key}`}>{label}</Link>)}</nav>

    {view === "overview" ? <EvidenceStateOverview
      claims={allClaims.length}
      activeClaimTypes={groups.filter((group) => group.items.length > 0).length}
      evidence={state.evidence.length}
      metrics={state.metrics.length}
      relationships={state.relationships.length}
    /> : null}

    {view === "claims" ? <section>
      <div className="section-heading"><h2>Claims</h2><span className="muted">{visibleClaims.length} shown</span></div>
      <nav className="filter-pills" aria-label="Filter Claims"><Link className={!selectedGroup ? "active" : ""} href="?view=claims">All</Link>{groups.map((group) => <Link key={group.key} className={selectedGroup?.key === group.key ? "active" : ""} href={`?view=claims&claimType=${group.key}`}>{group.label} ({group.items.length})</Link>)}</nav>
      {visibleClaims.length > 0 ? <div className="record-list">{visibleClaims.map((claim) => <ClaimCard key={claim.id} claim={claim} businessId={businessId} evidenceItems={reviewedEvidence} readOnly={archived} />)}</div> : <p className="empty-state">No claims in this category.</p>}
    </section> : null}

    {view === "evidence" ? <section><h2>Evidence</h2>{state.evidence.length > 0 ? <div className="record-list">{state.evidence.map((item) => <article className="record-card" key={item.id}>
      <p className="eyebrow">Evidence</p><EvidenceValue statement={item.statement} valueNumeric={item.valueNumeric} valueText={item.valueText} unit={item.unit} valuePrecision={item.valuePrecision} valueLower={item.valueLower} valueUpper={item.valueUpper} />
      <p className="record-attributes"><span>{item.reliabilityLevel} reliability</span><span>{item.directnessLevel} directness</span><span>{item.materiality} materiality</span></p>
      <p className="muted">Source: {item.sourceReference ?? sourceLabel(item.sourceType)}{item.lineage ? ` · Human ${item.lineage.review.decision.toLowerCase()}` : ""}</p>
      <details><summary>Source provenance</summary><pre>{JSON.stringify(item.sourceMetadata, null, 2)}</pre></details>
    </article>)}</div> : <p className="empty-state">No Evidence has been recorded yet.</p>}</section> : null}

    {view === "metrics" ? <section><h2>Metrics</h2>{state.metrics.length > 0 ? <div className="metric-grid">{state.metrics.map((item) => <article className="metric-card" key={item.id}><p>{item.metricLabel}</p><strong>{formatWorkspaceMetric(item)}</strong><span className="muted">Precision: {numericPrecisionLabel(item.numericPrecision)}</span><span className="muted">{item.sourceEvidenceId ? "Source evidence available" : "No source evidence linked"}</span></article>)}</div> : <p className="empty-state">No metrics have been recorded yet.</p>}</section> : null}

    {view === "relationships" ? <section><h2>Relationships</h2>{state.relationships.length > 0 ? <div className="record-list">{state.relationships.map((item) => <article className="record-card relationship-card" key={`${item.claimId}-${item.evidenceId}-${item.relationshipType}`}>
      <div><p className="eyebrow">Claim</p><h3>{claimById.get(item.claimId)?.statement ?? "Claim unavailable"}</h3></div>
      <p className="relationship-badge">{item.relationshipType}</p>
      <div><p className="eyebrow">Evidence</p><p>{evidenceById.get(item.evidenceId)?.statement ?? "Evidence unavailable"}</p></div>
      {item.lineage ? <p className="muted">Human reviewed · {item.lineage.review.decision.toLowerCase()}</p> : null}
    </article>)}</div> : <p className="empty-state">No reviewed relationships yet.</p>}</section> : null}
  </main>;
}
