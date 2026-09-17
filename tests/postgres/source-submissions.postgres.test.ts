import { randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  evidenceExtractionRuns,
  sourceSubmissionAttachments,
  sourceSubmissions,
} from "@/db/schema";
import { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { BusinessService } from "@/services/business-service";
import { SourceSubmissionService } from "@/services/source-submission-service";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

function extractionRunInput(businessId: string, sourceSubmissionId?: string) {
  return {
    businessId,
    sourceSubmissionId,
    rawIntakeText: "Source Submission extraction test content.",
    sourceType: "additional_text",
    sourceReference: "Milestone 3A PostgreSQL test",
    sourceMetadata: { test: "source-submission" },
    promptVersion: "evidence_extractor_v4",
    provider: "test-provider",
    model: "deterministic-test-model",
    modelConfiguration: { network: false },
  };
}

describe("real PostgreSQL 17 Source Submission foundation", () => {
  let pool: Pool;
  let database: Database;
  let businesses: BusinessService;
  let sources: SourceSubmissionService;
  let extractionRuns: EvidenceExtractionRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 6 });
    await verifyPostgresTestDatabase(pool);
    database = drizzle({ client: pool });
    const foundation = new FoundationRepository(database);
    businesses = new BusinessService(foundation, new BusinessDeletionRepository(database));
    sources = new SourceSubmissionService(new SourceSubmissionRepository(database));
    extractionRuns = new EvidenceExtractionRepository(database);
  });

  afterAll(async () => pool.end());

  async function createBusiness(label: string) {
    return businesses.create({ name: `${label} ${randomUUID()}` });
  }

  it("keeps multiple sources and attachment metadata isolated by Business", async () => {
    const businessA = await createBusiness("Source owner A");
    const businessB = await createBusiness("Source owner B");
    const sourceA1 = await sources.create({
      businessId: businessA.id,
      sourceType: "additional_text",
      description: "Sales meeting — September 2026",
      rawText: "Pipeline review notes supplied by management.",
      sourceReference: "meeting-notes-2026-09",
      sourceOccurredAt: "2026-09-10T09:00:00.000Z",
    });
    const sourceA2 = await sources.create({
      businessId: businessA.id,
      sourceType: "file_upload",
      description: "Q3 management accounts",
      rawText: null,
    });
    const sourceB = await sources.create({
      businessId: businessB.id,
      sourceType: "additional_text",
      rawText: "Business B source material.",
    });
    const attachmentA1 = await sources.addAttachment({
      businessId: businessA.id,
      sourceSubmissionId: sourceA2.id,
      originalFilename: "Management Accounts.pdf",
      mediaType: "application/pdf",
      byteSize: 4096,
    });
    const attachmentA2 = await sources.addAttachment({
      businessId: businessA.id,
      sourceSubmissionId: sourceA2.id,
      originalFilename: "Sales Pipeline.csv",
      mediaType: "text/csv",
      byteSize: 2048,
    });

    const businessASources = await sources.listForBusiness(businessA.id);
    expect(businessASources).toHaveLength(2);
    expect(businessASources.map((item) => item.id))
      .toEqual(expect.arrayContaining([sourceA1.id, sourceA2.id]));
    expect((await sources.listForBusiness(businessB.id)).map((item) => item.id)).toEqual([sourceB.id]);
    expect(await sources.listAttachments(businessA.id, sourceA2.id)).toEqual([
      attachmentA1,
      attachmentA2,
    ]);
    expect(await sources.getById(businessB.id, sourceA1.id)).toBeUndefined();

    await expect(sources.addAttachment({
      businessId: businessB.id,
      sourceSubmissionId: sourceA1.id,
      originalFilename: "Cross-business-application.pdf",
      mediaType: "application/pdf",
      byteSize: 10,
    })).rejects.toThrow("does not belong to this business");
    await expect(database.insert(sourceSubmissionAttachments).values({
      businessId: businessB.id,
      sourceSubmissionId: sourceA1.id,
      originalFilename: "Cross-business.pdf",
      mediaType: "application/pdf",
      byteSize: 10,
    })).rejects.toThrow();
  });

  it("supports repeated extraction of one source and nullable legacy provenance", async () => {
    const business = await createBusiness("Repeated source extraction");
    const submission = await sources.create({
      businessId: business.id,
      sourceType: "additional_text",
      rawText: "One source processed more than once.",
    });
    const firstRun = await extractionRuns.createRun(extractionRunInput(business.id, submission.id));
    const secondRun = await extractionRuns.createRun(extractionRunInput(business.id, submission.id));
    const legacyRun = await extractionRuns.createRun(extractionRunInput(business.id));

    expect(firstRun.sourceSubmissionId).toBe(submission.id);
    expect(secondRun.sourceSubmissionId).toBe(submission.id);
    expect(firstRun.id).not.toBe(secondRun.id);
    expect(legacyRun.sourceSubmissionId).toBeNull();
    expect(await sources.getForExtractionRun(business.id, firstRun.id)).toEqual(submission);
    expect(await sources.getForExtractionRun(business.id, legacyRun.id)).toBeUndefined();
  });

  it("rejects cross-Business extraction provenance in application and database layers", async () => {
    const businessA = await createBusiness("Extraction owner A");
    const businessB = await createBusiness("Extraction owner B");
    const sourceB = await sources.create({
      businessId: businessB.id,
      sourceType: "additional_text",
      rawText: "Business B source.",
    });

    await expect(extractionRuns.createRun(extractionRunInput(businessA.id, sourceB.id)))
      .rejects.toThrow("does not belong to this business");
    await expect(database.insert(evidenceExtractionRuns).values(
      extractionRunInput(businessA.id, sourceB.id),
    )).rejects.toThrow();
    const [countResult] = await database.select({ value: count() }).from(evidenceExtractionRuns)
      .where(and(
        eq(evidenceExtractionRuns.businessId, businessA.id),
        eq(evidenceExtractionRuns.sourceSubmissionId, sourceB.id),
      ));
    expect(countResult.value).toBe(0);
  });

  it("keeps sources and attachments immutable outside matching permanent-delete context", async () => {
    const businessA = await createBusiness("Immutable source A");
    const businessB = await createBusiness("Immutable source B");
    const sourceA = await sources.create({
      businessId: businessA.id,
      sourceType: "additional_text",
      rawText: "Immutable source A.",
    });
    const sourceB = await sources.create({
      businessId: businessB.id,
      sourceType: "additional_text",
      rawText: "Immutable source B.",
    });
    const attachmentA = await sources.addAttachment({
      businessId: businessA.id,
      sourceSubmissionId: sourceA.id,
      originalFilename: "immutable.txt",
      mediaType: "text/plain",
      byteSize: 20,
    });

    await expect(database.update(sourceSubmissions).set({ rawText: "Rewritten" })
      .where(eq(sourceSubmissions.id, sourceA.id))).rejects.toThrow();
    await expect(database.delete(sourceSubmissions)
      .where(eq(sourceSubmissions.id, sourceA.id))).rejects.toThrow();
    await expect(database.update(sourceSubmissionAttachments).set({ byteSize: 21 })
      .where(eq(sourceSubmissionAttachments.id, attachmentA.id))).rejects.toThrow();
    await expect(database.delete(sourceSubmissionAttachments)
      .where(eq(sourceSubmissionAttachments.id, attachmentA.id))).rejects.toThrow();
    await expect(database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('baslon.permanent_delete_business_id', ${businessA.id}, true)`);
      await tx.update(sourceSubmissions).set({ rawText: "Still forbidden" })
        .where(eq(sourceSubmissions.id, sourceA.id));
    })).rejects.toThrow();
    await expect(database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('baslon.permanent_delete_business_id', ${businessA.id}, true)`);
      await tx.update(sourceSubmissionAttachments).set({ byteSize: 22 })
        .where(eq(sourceSubmissionAttachments.id, attachmentA.id));
    })).rejects.toThrow();
    await expect(database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('baslon.permanent_delete_business_id', ${businessA.id}, true)`);
      await tx.delete(sourceSubmissions).where(eq(sourceSubmissions.id, sourceB.id));
    })).rejects.toThrow();
    await expect(database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('baslon.permanent_delete_business_id', ${businessB.id}, true)`);
      await tx.delete(sourceSubmissionAttachments).where(eq(sourceSubmissionAttachments.id, attachmentA.id));
    })).rejects.toThrow();
    expect(await sources.getById(businessB.id, sourceB.id)).toEqual(sourceB);
  });

  it("rejects archived creation and naturally permits it after restore", async () => {
    const business = await createBusiness("Archived source owner");
    await businesses.archive(business.id);
    await expect(sources.create({
      businessId: business.id,
      sourceType: "additional_text",
      rawText: "Must not be stored while archived.",
    })).rejects.toThrow("This business is archived");
    await businesses.restore(business.id);
    const submission = await sources.create({
      businessId: business.id,
      sourceType: "additional_text",
      rawText: "Stored after restore.",
    });
    expect(submission.businessId).toBe(business.id);
  });
});
