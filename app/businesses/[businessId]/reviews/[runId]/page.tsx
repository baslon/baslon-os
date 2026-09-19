import Link from "next/link";
import { notFound } from "next/navigation";
import {
  completeEvidenceReviewAction,
  reviewProposalAction,
  startEvidenceReviewAction,
} from "../../../../actions";
import { getBusinessService, getEvidenceReviewService, getSourceSubmissionService } from "@/foundation";
import { ProposalReviewControls } from "../../../../proposal-review-controls";
import { RelationshipEndpoints } from "../../../../relationship-endpoints";
import { ProposalNumericValue } from "../../../../proposal-numeric-value";
import { buildReviewQueue } from "@/domain/review-queue";

export const dynamic = "force-dynamic";

function display(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const proposalLabels = {
  claim: "Claim",
  evidence: "Evidence",
  metric: "Metric",
  claim_evidence: "Relationship",
} as const;

export default async function EvidenceReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; runId: string }>;
  searchParams: Promise<{ session?: string; error?: string }>;
}) {
  const { businessId, runId } = await params;
  const query = await searchParams;
  const service = getEvidenceReviewService();
  const extraction = await service.getExtraction(runId, businessId).catch(() => null);
  const business = await getBusinessService().getIncludingArchived(businessId);
  if (!extraction || !business) notFound();
  const source = await getSourceSubmissionService().getForExtractionRun(businessId, runId);
  const sourceDetails = source ? <details className="panel"><summary>Submitted information</summary>
    {source.sourceReference ? <p>Source: {source.sourceReference}</p> : null}
    <p className="source-block" style={{ whiteSpace: "pre-wrap" }}>{source.rawText}</p>
  </details> : null;
  if (business.status === "archived") return <main className="narrow">
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${businessId}`}>{business.name}</Link> <span aria-hidden="true">/</span> Evidence Review</nav>
    <p className="context-name">{business.name}</p>
    <h1 className="task-title">Evidence Review</h1>
    <div className="notice"><strong>Archived — read-only</strong><p>Restore this business before making or completing review decisions.</p></div>
    <p>{extraction.proposals.length} proposals are preserved from this extraction run.</p>
    <div className="button-row"><Link className="button-link" href={`/businesses/${businessId}/evidence`}>View Evidence State</Link><Link href={`/businesses/${businessId}`}>Return to business</Link></div>
  </main>;
  const existingSession = query.session ? { id: query.session } : await service.getReviewByRun(runId, businessId);

  if (!existingSession) {
    return <main className="narrow">
      <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${businessId}`}>{business.name}</Link> <span aria-hidden="true">/</span> Evidence Review</nav>
      <p className="context-name">{business.name}</p>
      <p className="eyebrow">Evidence Review</p>
      <h1 className="task-title">Review the findings</h1>
      {sourceDetails}
      {query.error && <p className="error" role="alert">The review could not be started. Please try again.</p>}
      <section className="panel">
        <h2>{extraction.proposals.length} proposals are ready</h2>
        <p>Review each proposed claim, piece of evidence, metric and relationship before it becomes part of the business record.</p>
        {extraction.run.sourceReference ? <p className="muted">Source: {extraction.run.sourceReference}</p> : null}
        <form action={startEvidenceReviewAction} className="stacked-form">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="extractionRunId" value={runId} />
          <label>Your name or identifier<input name="reviewerId" required /></label>
          <button type="submit">Start review →</button>
        </form>
      </section>
    </main>;
  }

  const details = await service.getReview(existingSession.id, businessId);
  const queue = buildReviewQueue(details.proposals, details.reviews);
  const current = queue.current
    ? details.proposals.find((proposal) => proposal.id === queue.current?.id)
    : undefined;
  const payload = current?.structuredPayload;
  const complete = details.session.status === "COMPLETED";

  return <main className="review-page">
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${businessId}`}>{business.name}</Link> <span aria-hidden="true">/</span> Evidence Review</nav>
    <p className="context-name">{business.name}</p>
    <h1 className="task-title">Evidence Review</h1>
    {query.error && <p className="error" role="alert">That decision could not be saved. Please review it and try again.</p>}
    {sourceDetails}

    <section className="review-progress" aria-labelledby="review-progress-heading">
      <div className="section-heading">
        <div><h2 id="review-progress-heading">{queue.reviewed} of {queue.total} reviewed</h2><p className="muted">{queue.remaining} remaining</p></div>
        <strong>{queue.percent}%</strong>
      </div>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={queue.total} aria-valuenow={queue.reviewed} aria-label={`${queue.reviewed} of ${queue.total} proposals reviewed`}>
        <span style={{ width: `${queue.percent}%` }} />
      </div>
      <div className="review-type-counts">
        <span>{queue.typeCounts.claim ?? 0} Claims</span><span>{queue.typeCounts.evidence ?? 0} Evidence</span><span>{queue.typeCounts.metric ?? 0} Metrics</span><span>{queue.typeCounts.claim_evidence ?? 0} Relationships</span>
      </div>
      <details className="review-summary-details"><summary>Review summary</summary>
        <p>{queue.total} proposals · {queue.counts.ACCEPTED ?? 0} accepted · {queue.counts.CORRECTED ?? 0} corrected · {queue.counts.REJECTED ?? 0} rejected · {queue.counts.UNRESOLVED ?? 0} unresolved · {queue.remaining} remaining</p>
      </details>
    </section>

    {complete ? <section className="completion-card">
      <p className="success-mark" aria-hidden="true">✓</p>
      <h2>Evidence review complete</h2>
      <p>{queue.total} proposals reviewed</p>
      <p>{queue.counts.ACCEPTED ?? 0} accepted · {queue.counts.CORRECTED ?? 0} corrected · {queue.counts.REJECTED ?? 0} rejected · {queue.counts.UNRESOLVED ?? 0} unresolved</p>
      <p>Your reviewed information has been added to the business Evidence State.</p>
      <div className="button-row centered"><Link className="button-link" href={`/businesses/${businessId}/evidence`}>View Evidence State →</Link><Link href={`/businesses/${businessId}`}>Return to {business.name}</Link></div>
    </section> : current && payload ? <section aria-label="Current proposal">
      <article className="proposal-card current-proposal">
        <p className="eyebrow">{proposalLabels[current.proposalType]}</p>
        <h2>{display(payload.statement ?? payload.metricLabel ?? payload.relationshipType)}</h2>
        <div className="proposal-attributes">
          {payload.claimType ? <span>{display(payload.claimType).replaceAll("_", " ")}</span> : null}
          {payload.confidenceLevel ? <span>{display(payload.confidenceLevel)} confidence</span> : null}
          {payload.materiality ? <span>{display(payload.materiality)} materiality</span> : null}
        </div>
        {payload.sourceExcerpt ? <div className="source-block"><p className="eyebrow">Source</p><blockquote>{display(payload.sourceExcerpt)}</blockquote></div> : null}
        {current.proposalType === "claim_evidence" ? <RelationshipEndpoints relationship={payload} proposals={details.proposals} /> : null}
        <ProposalNumericValue proposalType={current.proposalType} payload={payload} />
        <ProposalReviewControls proposal={current} context={{
          businessId,
          extractionRunId: runId,
          reviewSessionId: details.session.id,
          reviewerId: details.session.reviewerId,
        }} reviewAction={reviewProposalAction} />
      </article>
    </section> : <section className="completion-card">
      <h2>Every proposal has a decision</h2>
      <p>Complete the review to add the reviewed information to the Evidence State.</p>
      <form action={completeEvidenceReviewAction}>
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="extractionRunId" value={runId} />
        <input type="hidden" name="reviewSessionId" value={details.session.id} />
        <input type="hidden" name="reviewerId" value={details.session.reviewerId} />
        <button type="submit">Complete Evidence Review →</button>
      </form>
    </section>}
  </main>;
}
