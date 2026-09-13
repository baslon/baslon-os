import type { FactClaimInput } from "@/domain/fact-admission";
import { authorizeFactAdmission } from "@/domain/fact-admission";
import type { HumanAuthority } from "@/domain/server-authority";
import type { FactAdmissionRepository } from "@/repositories/fact-admission-repository";

export class FactAdmissionService {
  constructor(private readonly repository: FactAdmissionRepository) {}

  createFact(input: {
    claim: FactClaimInput;
    supportingEvidenceIds: string[];
    authority: HumanAuthority;
  }) {
    return this.repository.apply(authorizeFactAdmission({
      operation: "create",
      ...input,
    }));
  }

  promoteToFact(input: {
    currentClaimId: string;
    claim: FactClaimInput;
    supportingEvidenceIds: string[];
    authority: HumanAuthority;
  }) {
    return this.repository.apply(authorizeFactAdmission({
      operation: "promote",
      ...input,
    }));
  }
}
