import { claimInputSchema, type ClaimInput } from "@/domain/schemas";
import {
  assertHumanAuthority,
  type HumanAuthority,
} from "@/domain/server-authority";

export type FactClaimInput = Omit<ClaimInput, "claimType">;
export type FactAdmissionOperation = "create" | "promote";

export type AuthorizedFactAdmission = Readonly<{
  operation: FactAdmissionOperation;
  currentClaimId?: string;
  claim: ReturnType<typeof claimInputSchema.parse>;
  supportingEvidenceIds: readonly string[];
  audit: Readonly<{
    actorType: "human";
    actorId: string;
    admittedAt: string;
    operation: FactAdmissionOperation;
  }>;
}>;

const authorizedAdmissions = new WeakSet<object>();

export function authorizeFactAdmission(input: {
  operation: FactAdmissionOperation;
  currentClaimId?: string;
  claim: FactClaimInput;
  supportingEvidenceIds: string[];
  authority: HumanAuthority;
}): AuthorizedFactAdmission {
  assertHumanAuthority(input.authority);
  if (input.supportingEvidenceIds.length === 0) {
    throw new Error("Fact admission requires at least one supporting Evidence record");
  }
  if (input.operation === "promote" && !input.currentClaimId) {
    throw new Error("Fact promotion requires the current Claim id");
  }
  const command = Object.freeze({
    operation: input.operation,
    currentClaimId: input.currentClaimId,
    claim: claimInputSchema.parse({ ...input.claim, claimType: "fact" }),
    supportingEvidenceIds: Object.freeze([...new Set(input.supportingEvidenceIds)]),
    audit: Object.freeze({
      actorType: "human" as const,
      actorId: input.authority.actorId,
      admittedAt: new Date().toISOString(),
      operation: input.operation,
    }),
  });
  authorizedAdmissions.add(command);
  return command;
}

export function assertAuthorizedFactAdmission(
  command: AuthorizedFactAdmission,
): void {
  if (!authorizedAdmissions.has(command)) {
    throw new Error("Unauthorised fact admission command");
  }
}
