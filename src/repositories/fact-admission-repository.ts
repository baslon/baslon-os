import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { claimEvidence, claims, evidence } from "@/db/schema";
import {
  assertAuthorizedFactAdmission,
  type AuthorizedFactAdmission,
} from "@/domain/fact-admission";
import { assertBusinessActive } from "@/repositories/business-lifecycle-guard";

export class FactAdmissionRepository {
  constructor(private readonly database: Database) {}

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async apply(command: AuthorizedFactAdmission) {
    assertAuthorizedFactAdmission(command);
    return this.database.transaction(async (tx) => {
      for (const evidenceId of command.supportingEvidenceIds) {
        const [support] = await tx.select({ businessId: evidence.businessId })
          .from(evidence).where(eq(evidence.id, evidenceId));
        if (!support || support.businessId !== command.claim.businessId) {
          throw new Error("Supporting Evidence must belong to the same Business");
        }
      }

      let current: typeof claims.$inferSelect | undefined;
      if (command.operation === "promote") {
        [current] = await tx.select().from(claims)
          .where(eq(claims.id, command.currentClaimId!)).for("update");
        if (!current) throw new Error("Claim not found");
        if (current.businessId !== command.claim.businessId) {
          throw new Error("Replacement Claim must belong to the same Business");
        }
        if (current.claimType === "fact") throw new Error("Claim is already a fact");
        if (current.supersededByClaimId) throw new Error("Claim has already been superseded");
      }

      const [fact] = await tx.insert(claims).values({
        ...command.claim,
        confidenceScore: command.claim.confidenceScore?.toString(),
        confidenceBasis: {
          ...command.claim.confidenceBasis,
          factAdmission: {
            ...command.audit,
            supportingEvidenceIds: command.supportingEvidenceIds,
          },
        },
      }).returning();

      await tx.insert(claimEvidence).values(command.supportingEvidenceIds.map((evidenceId) => ({
        businessId: command.claim.businessId,
        claimId: fact.id,
        evidenceId,
        relationshipType: "supports" as const,
      })));

      if (current) {
        await tx.update(claims).set({
          status: "superseded",
          supersededByClaimId: fact.id,
          updatedAt: new Date(),
        }).where(eq(claims.id, current.id));
      }
      return fact;
    });
  }
}
