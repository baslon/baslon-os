import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  businesses,
  evidenceExtractionRuns,
  sourceSubmissionAttachments,
  sourceSubmissions,
} from "@/db/schema";
import type {
  CreateSourceSubmission,
  CreateSourceSubmissionAttachment,
} from "@/domain/source-submission";
import { SourceSubmissionOwnershipError } from "@/domain/source-submission";
import {
  assertBusinessActive,
  BusinessArchivedError,
} from "@/repositories/business-lifecycle-guard";

async function assertBusinessActiveForSourceWrite(
  database: Pick<Database, "select">,
  businessId: string,
) {
  const [business] = await database.select({ status: businesses.status }).from(businesses)
    .where(eq(businesses.id, businessId)).for("update");
  if (!business) throw new Error("Business not found");
  if (business.status !== "active") throw new BusinessArchivedError();
}

export class SourceSubmissionRepository {
  constructor(private readonly database: Database) {}

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async create(input: CreateSourceSubmission) {
    return this.database.transaction(async (tx) => {
      await assertBusinessActiveForSourceWrite(tx, input.businessId);
      const [submission] = await tx.insert(sourceSubmissions).values(input).returning();
      return submission;
    });
  }

  async getById(businessId: string, sourceSubmissionId: string) {
    const [submission] = await this.database.select().from(sourceSubmissions).where(and(
      eq(sourceSubmissions.id, sourceSubmissionId),
      eq(sourceSubmissions.businessId, businessId),
    ));
    return submission;
  }

  listForBusiness(businessId: string) {
    return this.database.select().from(sourceSubmissions)
      .where(eq(sourceSubmissions.businessId, businessId))
      .orderBy(sourceSubmissions.submittedAt, sourceSubmissions.id);
  }

  async createAttachment(input: CreateSourceSubmissionAttachment) {
    return this.database.transaction(async (tx) => {
      await assertBusinessActiveForSourceWrite(tx, input.businessId);
      const [submission] = await tx.select({ id: sourceSubmissions.id }).from(sourceSubmissions).where(and(
        eq(sourceSubmissions.id, input.sourceSubmissionId),
        eq(sourceSubmissions.businessId, input.businessId),
      ));
      if (!submission) throw new SourceSubmissionOwnershipError();
      const [attachment] = await tx.insert(sourceSubmissionAttachments).values(input).returning();
      return attachment;
    });
  }

  listAttachments(businessId: string, sourceSubmissionId: string) {
    return this.database.select().from(sourceSubmissionAttachments).where(and(
      eq(sourceSubmissionAttachments.businessId, businessId),
      eq(sourceSubmissionAttachments.sourceSubmissionId, sourceSubmissionId),
    )).orderBy(sourceSubmissionAttachments.createdAt, sourceSubmissionAttachments.id);
  }

  async getForExtractionRun(businessId: string, extractionRunId: string) {
    const [result] = await this.database.select({ submission: sourceSubmissions })
      .from(evidenceExtractionRuns)
      .innerJoin(sourceSubmissions, and(
        eq(sourceSubmissions.id, evidenceExtractionRuns.sourceSubmissionId),
        eq(sourceSubmissions.businessId, evidenceExtractionRuns.businessId),
      ))
      .where(and(
        eq(evidenceExtractionRuns.id, extractionRunId),
        eq(evidenceExtractionRuns.businessId, businessId),
      ));
    return result?.submission;
  }
}
