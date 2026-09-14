import Link from "next/link";
import { notFound } from "next/navigation";
import { runEvidenceExtractionAction } from "../../../actions";
import { getBusinessService, getEvidenceExtractionService, getEvidenceStateService } from "@/foundation";
import { deriveIntakePresentation } from "@/domain/intake-presentation";

export const dynamic = "force-dynamic";

export default async function BusinessIntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessId } = await params;
  const { error } = await searchParams;
  const business = await getBusinessService().getIncludingArchived(businessId);
  if (!business) notFound();
  if (business.status === "archived") return <main className="narrow">
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${businessId}`}>{business.name}</Link> <span aria-hidden="true">/</span> Business information</nav>
    <p className="context-name">{business.name}</p>
    <h1 className="task-title">This business is archived.</h1>
    <p className="lede">Restore it before adding or analysing new business information.</p>
    <Link className="button-link" href={`/businesses/${businessId}`}>Return to business</Link>
  </main>;
  const [latestRun, state] = await Promise.all([
    getEvidenceExtractionService().getLatestRun(businessId).catch(() => undefined),
    getEvidenceStateService().getCurrent(businessId).catch(() => undefined),
  ]);
  const hasCanonicalEvidence = Boolean(state && (
    Object.values(state.claims).some((claims) => claims.length > 0)
    || state.evidence.length > 0
    || state.metrics.length > 0
  ));
  const presentation = deriveIntakePresentation({ latestRun, hasCanonicalEvidence, hasErrorSignal: Boolean(error) });

  return (
    <main className="narrow">
      <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${businessId}`}>{business.name}</Link> <span aria-hidden="true">/</span> Business information</nav>
      <p className="context-name">{business.name}</p>
      <p className="eyebrow">Business information</p>
      <h1 className="task-title">{presentation.heading}</h1>
      {presentation.returning ? <p className="lede">Baslon OS already contains reviewed information about this business. Add another source of information to continue building the business Evidence State.</p> : <div className="lede">
        <p>Paste whatever information you already have about this business.</p>
        <p>This can include notes, figures, problems, goals, observations, customer information or anything else that may be relevant.</p>
        <p>You don&apos;t need to organise or format it.</p>
      </div>}
      {presentation.showRetryMessage && <div className="notice" role="alert">
        <h2>Analysis wasn&apos;t completed</h2>
        <p>Your information has been saved. You can review it below and try again when you&apos;re ready.</p>
      </div>}
      <form action={runEvidenceExtractionAction} className="stacked-form panel">
        <input type="hidden" name="businessId" value={business.id} />
        <label>
          Business information
          <textarea name="rawIntakeText" rows={18} required defaultValue={presentation.rawIntakeText} placeholder="Paste notes, interview answers, emails or other business information here..." />
        </label>
        <label>
          Source details <span className="field-note">Optional</span>
          <input name="sourceReference" placeholder="Founder interview — 14 September 2026" defaultValue={presentation.sourceReference} />
        </label>
        <button type="submit">{presentation.submitLabel}</button>
      </form>
      <div className="trust-note"><strong>You stay in control.</strong><p>Baslon OS will identify potential facts, observations, beliefs, evidence and metrics. Nothing becomes part of the business record until you review and approve it.</p></div>
    </main>
  );
}
