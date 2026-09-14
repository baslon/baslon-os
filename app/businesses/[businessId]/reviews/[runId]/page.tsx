import Link from "next/link";
import { notFound } from "next/navigation";
import {
  completeEvidenceReviewAction,
  reviewProposalAction,
  startEvidenceReviewAction,
} from "../../../../actions";
import { getBusinessService, getEvidenceReviewService } from "@/foundation";
import { ProposalReviewControls } from "../../../../proposal-review-controls";
import { RelationshipEndpoints } from "../../../../relationship-endpoints";

export const dynamic = "force-dynamic";

function display(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

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
  const business = (await getBusinessService().list()).find((item) => item.id === businessId);
  if (!extraction || !business) notFound();
  const existingSession = query.session
    ? { id: query.session }
    : await service.getReviewByRun(runId, businessId);

  if (!existingSession) {
    return <main>
      <p><Link href={`/businesses/${businessId}/intake`}>← Intake</Link></p>
      <p className="eyebrow">Evidence Review</p>
      <h1 className="page-title">{business.name}</h1>
      {query.error && <p className="error" role="alert">{query.error}</p>}
      <section>
        <p>Extraction status: <strong>{extraction.run.status}</strong></p>
        <p>Source: {extraction.run.sourceReference ?? "No source reference supplied"}</p>
        <p>{extraction.proposals.length} proposals are ready for human review.</p>
        <form action={startEvidenceReviewAction} className="stacked-form">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="extractionRunId" value={runId} />
          <label>Reviewer name or identifier<input name="reviewerId" required /></label>
          <button type="submit">Start Evidence Review</button>
        </form>
        <p className="note">Reviewer identity is asserted for audit purposes; authentication is not implemented.</p>
      </section>
    </main>;
  }

  const details = await service.getReview(existingSession.id, businessId);
  const reviewByProposal = new Map(details.reviews.map((review) => [review.proposalId, review]));
  const counts = details.reviews.reduce<Record<string, number>>((total, review) => {
    total[review.decision] = (total[review.decision] ?? 0) + 1;
    return total;
  }, {});
  const allReviewed = details.proposals.every((proposal) => reviewByProposal.has(proposal.id));

  return <main className="wide">
    <p><Link href={`/businesses/${businessId}/intake`}>← Intake</Link></p>
    <p className="eyebrow">Evidence Review</p>
    <h1 className="page-title">{business.name}</h1>
    {query.error && <p className="error" role="alert">{query.error}</p>}
    <section className="review-summary">
      <p><strong>{details.proposals.length}</strong> proposals · <strong>{details.reviews.length}</strong> decided</p>
      <p>{counts.ACCEPTED ?? 0} accepted · {counts.CORRECTED ?? 0} corrected · {counts.REJECTED ?? 0} rejected · {counts.UNRESOLVED ?? 0} unresolved</p>
      <p>Reviewer: {details.session.reviewerId} <span className="note">(asserted, not authenticated)</span></p>
    </section>

    {([['claim', 'Claims'], ['evidence', 'Evidence'], ['metric', 'Metrics'], ['claim_evidence', 'Relationships']] as const).map(([type, heading]) => {
      const proposals = details.proposals.filter((proposal) => proposal.proposalType === type);
      if (proposals.length === 0) return null;
      return <section key={type}>
        <h2>{heading}</h2>
        <div className="proposal-list">
          {proposals.map((proposal) => {
            const review = reviewByProposal.get(proposal.id);
            const payload = proposal.structuredPayload;
            return <article className="proposal-card" key={proposal.id}>
              <div className="proposal-heading">
                <strong>{display(payload.statement ?? payload.metricLabel ?? payload.relationshipType)}</strong>
                <span className={`status ${review?.decision.toLowerCase() ?? 'pending'}`}>{review?.decision ?? 'PENDING'}</span>
              </div>
              {'sourceExcerpt' in payload && <blockquote>{display(payload.sourceExcerpt)}</blockquote>}
              {type === 'claim_evidence' && <RelationshipEndpoints relationship={payload} proposals={details.proposals} />}
              {type === 'metric' && Boolean(payload.sourceEvidenceRef) && <p className="note">Evidence dependency: {display(payload.sourceEvidenceRef)}</p>}
              <details><summary>Original AI proposal</summary><pre>{JSON.stringify(payload, null, 2)}</pre></details>
              {review ? <div>
                <p>Decision recorded {review.reviewedAt.toLocaleString()}.</p>
                {review.reason && <p>Reason: {review.reason}</p>}
                {review.reviewedPayload && <details><summary>Corrected payload</summary><pre>{JSON.stringify(review.reviewedPayload, null, 2)}</pre></details>}
              </div> : <ProposalReviewControls
                proposal={proposal}
                context={{
                  businessId,
                  extractionRunId: runId,
                  reviewSessionId: details.session.id,
                  reviewerId: details.session.reviewerId,
                }}
                reviewAction={reviewProposalAction}
              />}
            </article>;
          })}
        </div>
      </section>;
    })}

    {details.session.status === 'COMPLETED' ? (
      <p><Link href={`/businesses/${businessId}/evidence`}>Inspect Evidence State →</Link></p>
    ) : allReviewed ? (
      <form action={completeEvidenceReviewAction}>
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="extractionRunId" value={runId} />
        <input type="hidden" name="reviewSessionId" value={details.session.id} />
        <input type="hidden" name="reviewerId" value={details.session.reviewerId} />
        <button type="submit">Complete Evidence Review</button>
      </form>
    ) : <p className="note">Every proposal needs an explicit decision before review can be completed.</p>}
  </main>;
}
