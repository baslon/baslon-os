import type { FoundationRepository } from "@/repositories/foundation-repository";

export class BusinessStateService {
  constructor(private readonly repository: FoundationRepository) {}

  updateProfile(
    input: Parameters<FoundationRepository["updateBusinessProfile"]>[0],
  ) {
    return this.repository.updateBusinessProfile(input);
  }

  addClaim(input: Parameters<FoundationRepository["addClaim"]>[0]) {
    return this.repository.addClaim(input);
  }

  addEvidence(input: Parameters<FoundationRepository["addEvidence"]>[0]) {
    return this.repository.addEvidence(input);
  }

  linkClaimEvidence(
    input: Parameters<FoundationRepository["linkClaimEvidence"]>[0],
  ) {
    return this.repository.linkClaimEvidence(input);
  }

  addMetric(input: Parameters<FoundationRepository["addMetric"]>[0]) {
    return this.repository.addMetric(input);
  }

  createSnapshot(
    businessId: Parameters<FoundationRepository["createSnapshot"]>[0],
  ) {
    return this.repository.createSnapshot(businessId);
  }
}
