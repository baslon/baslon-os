import type { FoundationRepository } from "@/repositories/foundation-repository";

export class BusinessStateService {
  constructor(private readonly repository: FoundationRepository) {}

  async updateProfile(
    input: Parameters<FoundationRepository["updateBusinessProfile"]>[0],
  ) {
    await this.repository.assertBusinessActive(input.businessId);
    return this.repository.updateBusinessProfile(input);
  }

  async addClaim(input: Parameters<FoundationRepository["addClaim"]>[0]) {
    await this.repository.assertBusinessActive(input.businessId);
    return this.repository.addClaim(input);
  }

  async addEvidence(input: Parameters<FoundationRepository["addEvidence"]>[0]) {
    await this.repository.assertBusinessActive(input.businessId);
    return this.repository.addEvidence(input);
  }

  async linkClaimEvidence(
    input: Parameters<FoundationRepository["linkClaimEvidence"]>[0],
  ) {
    // Ownership is resolved by the repository; it validates both records before mutation.
    const claim = await this.repository.getClaim(input.claimId);
    if (!claim) throw new Error("Claim not found");
    await this.repository.assertBusinessActive(claim.businessId);
    return this.repository.linkClaimEvidence(input);
  }

  async addMetric(input: Parameters<FoundationRepository["addMetric"]>[0]) {
    await this.repository.assertBusinessActive(input.businessId);
    return this.repository.addMetric(input);
  }

  async createSnapshot(
    businessId: Parameters<FoundationRepository["createSnapshot"]>[0],
  ) {
    await this.repository.assertBusinessActive(businessId);
    return this.repository.createSnapshot(businessId);
  }
}
