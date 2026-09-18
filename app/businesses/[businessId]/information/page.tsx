import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessOverviewService, getEvidenceQualityService, getSourceSubmissionService } from "@/foundation";
import { addInformationAction } from "../../../actions";
import { InformationForm } from "../../../information-form";
import { isAiRunStale } from "@/domain/ai-run-recovery";

export const dynamic = "force-dynamic";

export default async function AddInformationPage({ params, searchParams }: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string; question?: string }>;
}) {
  const { businessId } = await params;
  const { error, question: questionId } = await searchParams;
  const overview = await getBusinessOverviewService().getIncludingArchived(businessId);
  if (!overview) notFound();
  const latest = overview.latestExtraction;
  const retry = latest?.sourceSubmissionId && (
    latest.status === "FAILED"
    || (latest.status === "RUNNING" && isAiRunStale(latest.createdAt))
  ) ? latest : undefined;
  const sourceService = getSourceSubmissionService();
  const retryContext = retry
    ? await sourceService.getQuestionContextForSource(businessId, retry.sourceSubmissionId!)
    : undefined;
  const requestedContext = questionId
    ? await sourceService.getQuestionContext(businessId, questionId)
    : undefined;
  const quality = questionId
    ? await getEvidenceQualityService().get(businessId).catch(() => undefined)
    : undefined;
  const currentQuestion = requestedContext
    && quality && !quality.isHistorical
    && quality.surfacedQuestions.some((item) => item.id === requestedContext.questionId)
    ? requestedContext
    : undefined;
  const question = retry ? retryContext : currentQuestion;
  const available = overview.business.status === "active" && (
    (!questionId && ["EVIDENCE_READY", "GAP_RESOLUTION_REQUIRED"].includes(overview.workflow?.state ?? ""))
    || (Boolean(currentQuestion && !currentQuestion.sourceSubmissionId) && overview.workflow?.state === "GAP_RESOLUTION_REQUIRED")
    || (overview.workflow?.state === "EVIDENCE_PROCESSING" && retry
      && (!questionId || retryContext?.questionId === questionId))
  );
  return <main className="narrow">
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> / <Link href={`/businesses/${businessId}`}>{overview.business.name}</Link> / Add Information</nav>
    <p className="context-name">{overview.business.name}</p>
    <h1 className="task-title">Add Information</h1>
    <p className="lede">Add new information without replacing anything already accepted. You will review the proposals before they enter the Evidence State.</p>
    {error ? <p className="notice" role="alert">Analysis could not be completed. Check your information and try again. Existing evidence is preserved.</p> : null}
    {questionId && !currentQuestion && !retryContext ? <p className="notice" role="alert">This Evidence Quality question is not available for new information.</p> : null}
    {available ? <InformationForm businessId={businessId} question={question ? { id: question.questionId, questionText: question.questionText } : undefined} retry={overview.workflow?.state === "EVIDENCE_PROCESSING" ? retry : undefined} action={addInformationAction} />
      : <p>Complete the current information and review process before adding another source. Archived businesses must first be restored.</p>}
    <Link href={`/businesses/${businessId}`}>Return to business</Link>
  </main>;
}
