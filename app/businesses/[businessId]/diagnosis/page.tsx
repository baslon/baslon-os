import { notFound } from "next/navigation";
import { getPhase1DiagnosisService } from "@/foundation";
import { Phase1Diagnosis } from "../../../phase1-diagnosis";

export const dynamic = "force-dynamic";

export default async function Phase1DiagnosisPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const model = await getPhase1DiagnosisService().get(businessId).catch(() => undefined);
  if (!model) notFound();
  return <Phase1Diagnosis model={model} error={query.error} />;
}
