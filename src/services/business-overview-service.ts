import { deriveBusinessProgress } from "@/domain/business-progress";
import type { BusinessOverviewRepository } from "@/repositories/business-overview-repository";
import { buildWorkspaceDashboard } from "@/domain/workspace-dashboard";

export class BusinessOverviewService {
  constructor(private readonly repository: BusinessOverviewRepository) {}

  async list() {
    const rows = await this.repository.list();
    return rows.map((row) => this.present(row));
  }

  async get(businessId: string) {
    const row = await this.repository.get(businessId);
    return row ? this.present(row) : undefined;
  }

  async getIncludingArchived(businessId: string) {
    const row = await this.repository.getIncludingArchived(businessId);
    return row ? this.present(row) : undefined;
  }

  async listArchived() {
    const rows = await this.repository.listArchived();
    return rows.map((row) => this.present(row));
  }

  async getWorkspaceOverview() {
    const businesses = await this.list();
    return { businesses, ...buildWorkspaceDashboard(businesses) };
  }

  private present(row: NonNullable<Awaited<ReturnType<BusinessOverviewRepository["get"]>>>) {
    const progress = deriveBusinessProgress({
      workflowState: row.workflow?.state ?? "NEW",
      latestExtraction: row.latestExtraction,
      reviewSession: row.reviewSession,
    });
    const primaryHref = progress.primaryActionPath === "workspace"
      ? `/businesses/${row.business.id}`
      : progress.primaryActionPath === "evidence"
        ? `/businesses/${row.business.id}/evidence`
        : progress.primaryActionPath === "review" && row.latestExtraction
          ? `/businesses/${row.business.id}/reviews/${row.latestExtraction.id}`
          : row.latestExtraction?.sourceSubmissionId
            ? `/businesses/${row.business.id}/information`
            : `/businesses/${row.business.id}/intake`;
    return { ...row, progress, primaryHref };
  }
}
