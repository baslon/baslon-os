import type { BusinessInput } from "@/domain/schemas";
import type { FoundationRepository } from "@/repositories/foundation-repository";

export class BusinessService {
  constructor(private readonly repository: FoundationRepository) {}

  create(input: BusinessInput) {
    return this.repository.createBusiness(input);
  }

  list() {
    return this.repository.listBusinesses();
  }

  archive(businessId: string) {
    return this.repository.archiveBusiness(businessId);
  }
}
