import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessOverviewService } from "@/foundation";
import { addInformationAction } from "../../../actions";
import { InformationForm } from "../../../information-form";

export const dynamic = "force-dynamic";

export default async function AddInformationPage({ params, searchParams }: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessId } = await params;
  const { error } = await searchParams;
  const overview = await getBusinessOverviewService().getIncludingArchived(businessId);
  if (!overview) notFound();
  const latest = overview.latestExtraction;
  const retry = latest?.status === "FAILED" && latest.sourceSubmissionId ? latest : undefined;
  const available = overview.business.status === "active" && (
    overview.workflow?.state === "EVIDENCE_READY"
    || (overview.workflow?.state === "EVIDENCE_PROCESSING" && retry)
  );
  return <main className="narrow">
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> / <Link href={`/businesses/${businessId}`}>{overview.business.name}</Link> / Add Information</nav>
    <p className="context-name">{overview.business.name}</p>
    <h1 className="task-title">Add Information</h1>
    <p className="lede">Add new information without replacing anything already accepted. You will review the proposals before they enter the Evidence State.</p>
    {error ? <p className="notice" role="alert">Analysis could not be completed. Check your information and try again. Existing evidence is preserved.</p> : null}
    {available ? <InformationForm businessId={businessId} retry={overview.workflow?.state === "EVIDENCE_PROCESSING" ? retry : undefined} action={addInformationAction} />
      : <p>Complete the current information and review process before adding another source. Archived businesses must first be restored.</p>}
    <Link href={`/businesses/${businessId}`}>Return to business</Link>
  </main>;
}
