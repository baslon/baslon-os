import Link from "next/link";
import { notFound } from "next/navigation";
import {
  completeEvidenceReviewAction,
  reviewProposalAction,
  startEvidenceReviewAction,
} from "../../../../actions";
import { getBusinessService, getEvidenceReviewService } from "@/foundation";

export const dynamic = "force-dynamic";

type Proposal = Awaited<ReturnType<ReturnType<typeof getEvidenceReviewService>["getExtraction"]>>["proposals"][number];

function display(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function CorrectionFields({ proposal }: { proposal: Proposal }) {
  const payload = proposal.structuredPayload;
  if (proposal.proposalType === "claim") {
    return <div className="correction-grid">
      <label>Statement<input name="statement" defaultValue={display(payload.statement)} /></label>
      <label>Claim type<select name="claimType" defaultValue={display(payload.claimType)}>
        {['observation', 'management_belief', 'hypothesis', 'ai_inference', 'unknown'].map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label>Subject area<input name="subjectArea" defaultValue={display(payload.subjectArea)} /></label>
      <label>Confidence level<input name="confidenceLevel" defaultValue={display(payload.confidenceLevel)} /></label>
      <label>Confidence score<input name="confidenceScore" type="number" min="0" max="1" step="0.01" defaultValue={display(payload.confidenceScore)} /></label>
      <label>Confidence basis<input name="confidenceBasis" defaultValue={display((payload.confidenceBasis as Record<string, unknown>)?.basis)} /></label>
    </div>;
  }
  if (proposal.proposalType === "evidence") {
    return <div className="correction-grid">
      <label>Statement<input name="statement" defaultValue={display(payload.statement)} /></label>
      <label>Numeric value<input name="valueNumeric" type="number" step="any" defaultValue={display(payload.valueNumeric)} /></label>
      <label>Text value<input name="valueText" defaultValue={display(payload.valueText)} /></label>
      <label>Unit<input name="unit" defaultValue={display(payload.unit)} /></label>
      <label>Period start<input name="periodStart" type="date" defaultValue={display(payload.periodStart)} /></label>
      <label>Period end<input name="periodEnd" type="date" defaultValue={display(payload.periodEnd)} /></label>
      <label>Reliability<input name="reliabilityLevel" defaultValue={display(payload.reliabilityLevel)} /></label>
      <label>Reliability score<input name="reliabilityScore" type="number" min="0" max="1" step="0.01" defaultValue={display(payload.reliabilityScore)} /></label>
      <label>Directness<input name="directnessLevel" defaultValue={display(payload.directnessLevel)} /></label>
      <label>Recency<input name="recencyLevel" defaultValue={display(payload.recencyLevel)} /></label>
      <label>Materiality<input name="materiality" defaultValue={display(payload.materiality)} /></label>
    </div>;
  }
  if (proposal.proposalType === "metric") {
    return <div className="correction-grid">
      <label>Metric key<input name="metricKey" defaultValue={display(payload.metricKey)} /></label>
      <label>Label<input name="metricLabel" defaultValue={display(payload.metricLabel)} /></label>
      <label>Numeric value<input name="numericValue" type="number" step="any" defaultValue={display(payload.numericValue)} /></label>
      <label>Unit<input name="unit" defaultValue={display(payload.unit)} /></label>
      <label>Period start<input name="periodStart" type="date" defaultValue={display(payload.periodStart)} /></label>
      <label>Period end<input name="periodEnd" type="date" defaultValue={display(payload.periodEnd)} /></label>
    </div>;
  }
  return <div className="correction-grid">
    <label>Relationship type<select name="relationshipType" defaultValue={display(payload.relationshipType)}>
      {['supports', 'contradicts', 'context'].map((item) => <option key={item}>{item}</option>)}
    </select></label>
    <label>Strength score<input name="strengthScore" type="number" min="0" max="1" step="0.01" defaultValue={display(payload.strengthScore)} /></label>
  </div>;
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

    {['claim', 'evidence', 'metric', 'claim_evidence'].map((type) => {
      const proposals = details.proposals.filter((proposal) => proposal.proposalType === type);
      if (proposals.length === 0) return null;
      return <section key={type}>
        <h2>{type === 'claim_evidence' ? 'Relationships' : `${type[0].toUpperCase()}${type.slice(1)}s`}</h2>
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
              {type === 'claim_evidence' && <p className="note">Endpoints: {display(payload.claimRef)} → {display(payload.evidenceRef)} (not editable)</p>}
              {type === 'metric' && Boolean(payload.sourceEvidenceRef) && <p className="note">Evidence dependency: {display(payload.sourceEvidenceRef)}</p>}
              <details><summary>Original AI proposal</summary><pre>{JSON.stringify(payload, null, 2)}</pre></details>
              {review ? <div>
                <p>Decision recorded {review.reviewedAt.toLocaleString()}.</p>
                {review.reason && <p>Reason: {review.reason}</p>}
                {review.reviewedPayload && <details><summary>Corrected payload</summary><pre>{JSON.stringify(review.reviewedPayload, null, 2)}</pre></details>}
              </div> : <form action={reviewProposalAction} className="review-form">
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="extractionRunId" value={runId} />
                <input type="hidden" name="reviewSessionId" value={details.session.id} />
                <input type="hidden" name="proposalId" value={proposal.id} />
                <input type="hidden" name="proposalType" value={proposal.proposalType} />
                <input type="hidden" name="reviewerId" value={details.session.reviewerId} />
                <CorrectionFields proposal={proposal} />
                <label>Review reason (optional)<input name="reason" /></label>
                <div className="button-row">
                  <button name="decision" value="ACCEPTED">Accept</button>
                  <button name="decision" value="CORRECTED" className="secondary">Edit &amp; Accept</button>
                  <button name="decision" value="REJECTED" className="secondary">Reject</button>
                  <button name="decision" value="UNRESOLVED" className="secondary">Leave Unresolved</button>
                </div>
              </form>}
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
