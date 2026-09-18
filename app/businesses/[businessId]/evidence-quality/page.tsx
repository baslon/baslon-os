import { notFound } from "next/navigation";
import { getEvidenceQualityService } from "@/foundation";
import { EvidenceQuality } from "../../../evidence-quality";

export const dynamic = "force-dynamic";

export default async function EvidenceQualityPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const model = await getEvidenceQualityService().get(businessId).catch(() => undefined);
  if (!model) notFound();
  return <EvidenceQuality
    model={model}
    error={query.error === "1"}
    continueError={query.error === "continue"}
  />;
}
