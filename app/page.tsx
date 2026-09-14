import { getBusinessOverviewService } from "@/foundation";
import { WorkspaceHome } from "./home";

export const dynamic = "force-dynamic";

export default async function Home() {
  const model = await getBusinessOverviewService().getWorkspaceOverview();

  return <WorkspaceHome model={model} />;
}
