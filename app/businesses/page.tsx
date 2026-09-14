import { getBusinessOverviewService } from "@/foundation";
import { BusinessesDashboard } from "../business-dashboard";

export const dynamic = "force-dynamic";

export default async function BusinessesPage() {
  const businesses = await getBusinessOverviewService().list();
  return <BusinessesDashboard businesses={businesses} />;
}
