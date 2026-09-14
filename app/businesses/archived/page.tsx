import { getBusinessOverviewService } from "@/foundation";
import { ArchivedBusinesses } from "../../archived-businesses";

export const dynamic = "force-dynamic";

export default async function ArchivedBusinessesPage() {
  const businesses = await getBusinessOverviewService().listArchived();
  return <ArchivedBusinesses businesses={businesses} />;
}
