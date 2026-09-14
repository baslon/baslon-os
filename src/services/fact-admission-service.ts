import type { FactClaimInput } from "@/domain/fact-admission";
import { authorizeFactAdmission } from "@/domain/fact-admission";
import type { HumanAuthority } from "@/domain/server-authority";
import type { FactAdmissionRepository } from "@/repositories/fact-admission-repository";

export class FactAdmissionService {
  constructor(private readonly repository: FactAdmissionRepository) {}

  async createFact(input: {
    claim: FactClaimInput;
    supportingEvidenceIds: string[];
    authority: HumanAuthority;
  }) {
    await this.repository.assertBusinessActive(input.claim.businessId);
    return this.repository.apply(authorizeFactAdmission({
      operation: "create",
      ...input,
    }));
  }

  async promoteToFact(input: {
    currentClaimId: string;
    claim: FactClaimInput;
    supportingEvidenceIds: string[];
    authority: HumanAuthority;
  }) {
    await this.repository.assertBusinessActive(input.claim.businessId);
    return this.repository.apply(authorizeFactAdmission({
      operation: "promote",
      ...input,
    }));
  }
}
