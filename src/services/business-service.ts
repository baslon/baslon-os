import type { BusinessInput } from "@/domain/schemas";
import type { FoundationRepository } from "@/repositories/foundation-repository";

export class BusinessService {
  constructor(private readonly repository: FoundationRepository) {}

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
}
