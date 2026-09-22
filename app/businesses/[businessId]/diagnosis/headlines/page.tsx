import { notFound } from "next/navigation";
import { getDiagnosisHeadlineService } from "@/foundation";
import { DiagnosisHeadlines } from "../../../../diagnosis-headlines";

export const dynamic = "force-dynamic";

export default async function DiagnosisHeadlinesPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const model = await getDiagnosisHeadlineService().get(businessId).catch(() => undefined);
  if (!model) notFound();
  return <DiagnosisHeadlines model={model} error={query.error} />;
}
