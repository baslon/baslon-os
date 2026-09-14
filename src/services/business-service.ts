import type { BusinessInput } from "@/domain/schemas";
import type { FoundationRepository } from "@/repositories/foundation-repository";
import type { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { permanentDeleteBusinessSchema } from "@/domain/business-deletion";

export class BusinessService {
  constructor(
    private readonly repository: FoundationRepository,
    private readonly deletionRepository?: BusinessDeletionRepository,
  ) {}

  private deletion() {
    if (!this.deletionRepository) throw new Error("Permanent deletion is not configured");
    return this.deletionRepository;
  }

  create(input: BusinessInput) {
    return this.repository.createBusiness(input);
  }

  list() {
    return this.repository.listActiveBusinesses();
  }

  listArchived() {
    return this.repository.listArchivedBusinesses();
  }

  getActive(businessId: string) {
    return this.repository.getActiveBusiness(businessId);
  }

  getIncludingArchived(businessId: string) {
    return this.repository.getBusinessIncludingArchived(businessId);
  }

  assertActive(businessId: string) {
    return this.repository.assertBusinessActive(businessId);
  }

  archive(businessId: string) {
    return this.repository.archiveBusiness(businessId);
  }

  restore(businessId: string) {
    return this.repository.restoreBusiness(businessId);
  }

  getPermanentDeleteConfirmation(businessId: string) {
    return this.deletion().getConfirmation(businessId);
  }

  async permanentlyDelete(input: unknown) {
    const parsed = permanentDeleteBusinessSchema.parse(input);
    const current = await this.deletion().getConfirmation(parsed.businessId);
    if (parsed.confirmation.trim() !== current.phrase) {
      throw new Error("Business confirmation does not match.");
    }
    return this.deletion().permanentlyDelete(parsed);
  }
}
