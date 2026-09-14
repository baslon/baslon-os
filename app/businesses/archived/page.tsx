import { getBusinessOverviewService } from "@/foundation";
import { ArchivedBusinesses } from "../../archived-businesses";

export const dynamic = "force-dynamic";

export default async function ArchivedBusinessesPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  const businesses = await getBusinessOverviewService().listArchived();
  return <ArchivedBusinesses businesses={businesses} deleted={deleted === "1"} />;
}
