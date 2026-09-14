import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  evidenceExtractionRuns,
  evidenceProposals,
} from "@/db/schema";

export type ExtractionRunStart = {
  businessId: string;
  rawIntakeText: string;
  sourceType?: string;
  sourceReference?: string;
  sourceMetadata: Record<string, unknown>;
  promptVersion: string;
  provider: string;
  model: string;
  modelConfiguration: Record<string, unknown>;
};

export type ExtractionProposalRecord = {
  proposalRef: string;
  proposalType: "claim" | "evidence" | "metric" | "claim_evidence";
  structuredPayload: Record<string, unknown>;
};

export class EvidenceExtractionRepository {
  constructor(private readonly database: Database) {}

  async createRun(input: ExtractionRunStart) {
    const [run] = await this.database.insert(evidenceExtractionRuns).values(input).returning();
    return run;
  }

  async completeRun(input: {
    runId: string;
    businessId: string;
    rawModelOutput: unknown;
    proposals: ExtractionProposalRecord[];
  }) {
    return this.database.transaction(async (tx) => {
      if (input.proposals.length > 0) {
        await tx.insert(evidenceProposals).values(input.proposals.map((proposal) => ({
          extractionRunId: input.runId,
          businessId: input.businessId,
          ...proposal,
        })));
      }
      const [run] = await tx.update(evidenceExtractionRuns).set({
        status: "SUCCEEDED",
        rawModelOutput: input.rawModelOutput,
        validationErrors: [],
        completedAt: new Date(),
      }).where(and(
        eq(evidenceExtractionRuns.id, input.runId),
        eq(evidenceExtractionRuns.businessId, input.businessId),
        eq(evidenceExtractionRuns.status, "RUNNING"),
      )).returning();
      if (!run) throw new Error("Evidence extraction run is not active");
      return run;
    });
  }

  async failRun(input: {
    runId: string;
    businessId: string;
    rawModelOutput: unknown;
    validationErrors: unknown[];
  }) {
    const [run] = await this.database.update(evidenceExtractionRuns).set({
      status: "FAILED",
      rawModelOutput: input.rawModelOutput,
      validationErrors: input.validationErrors,
      completedAt: new Date(),
    }).where(and(
      eq(evidenceExtractionRuns.id, input.runId),
      eq(evidenceExtractionRuns.businessId, input.businessId),
      eq(evidenceExtractionRuns.status, "RUNNING"),
    )).returning();
    if (!run) throw new Error("Evidence extraction run is not active");
    return run;
  }

  async getRun(runId: string, businessId: string) {
    const [run] = await this.database.select().from(evidenceExtractionRuns)
      .where(and(
        eq(evidenceExtractionRuns.id, runId),
        eq(evidenceExtractionRuns.businessId, businessId),
      ));
    return run;
  }

  async getLatestRun(businessId: string) {
    const [run] = await this.database.select().from(evidenceExtractionRuns)
      .where(eq(evidenceExtractionRuns.businessId, businessId))
      .orderBy(desc(evidenceExtractionRuns.createdAt))
      .limit(1);
    return run;
  }

  getProposals(runId: string, businessId: string) {
    return this.database.select().from(evidenceProposals)
      .where(and(
        eq(evidenceProposals.extractionRunId, runId),
        eq(evidenceProposals.businessId, businessId),
      ))
      .orderBy(evidenceProposals.createdAt, evidenceProposals.proposalRef);
  }
}
