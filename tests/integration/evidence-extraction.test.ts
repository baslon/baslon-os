import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  EvidenceExtractionModel,
  EvidenceExtractionModelConfiguration,
  EvidenceExtractionModelResult,
} from "@/ai/evidence-extractor/model";
import type { EvidenceExtractionModelInput } from "@/ai/evidence-extractor/contracts";
import { EVIDENCE_EXTRACTOR_PROMPT_VERSION } from "@/ai/evidence-extractor/prompt";
import type { Database } from "@/db/client";
import {
  businessStateSnapshots,
  claims,
  evidence,
  evidenceExtractionRuns,
  metrics,
} from "@/db/schema";
import * as schema from "@/db/schema";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { SourceSubmissionService } from "@/services/source-submission-service";
import {
  baslonBusiness,
  baslonExtractionOutput,
  baslonMessyIntake,
} from "../fixtures/baslon-business";

class FakeEvidenceExtractionModel implements EvidenceExtractionModel {
  readonly inputs: EvidenceExtractionModelInput[] = [];

  constructor(private readonly result: EvidenceExtractionModelResult) {}

  getConfiguration(): EvidenceExtractionModelConfiguration {
    return {
      provider: "test-provider",
      model: "deterministic-extractor-v1",
      metadata: { structuredOutput: true, network: false },
    };
  }

  async extract(input: EvidenceExtractionModelInput) {
    this.inputs.push(input);
    return this.result;
  }
}

describe("Milestone 2A Evidence Extraction safety boundary", () => {
  let client: PGlite;
  let database: Database;
  let foundationRepository: FoundationRepository;
  let extractionRepository: EvidenceExtractionRepository;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    for (const migrationPath of [
      "../../drizzle/0000_furry_wolf_cub.sql",
      "../../drizzle/0001_evidence_extraction.sql",
      "../../drizzle/0003_business_permanent_delete.sql",
      "../../drizzle/0004_spotty_harpoon.sql",
    ]) {
      const migration = await readFile(new URL(migrationPath, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.exec(statement);
      }
    }
    database = drizzle(client, { schema }) as unknown as Database;
    foundationRepository = new FoundationRepository(database);
    extractionRepository = new EvidenceExtractionRepository(database);
  });

  afterAll(async () => {
    await client.close();
  });

  async function strategicState(businessId: string) {
    const [claimCount, evidenceCount, metricCount, snapshotCount] = await Promise.all([
      database.select({ value: count() }).from(claims)
        .where(eq(claims.businessId, businessId)),
      database.select({ value: count() }).from(evidence)
        .where(eq(evidence.businessId, businessId)),
      database.select({ value: count() }).from(metrics)
        .where(eq(metrics.businessId, businessId)),
      database.select({ value: count() }).from(businessStateSnapshots)
        .where(eq(businessStateSnapshots.businessId, businessId)),
    ]);
    const workflow = await foundationRepository.getWorkflow(businessId);
    return {
      claims: claimCount[0].value,
      evidence: evidenceCount[0].value,
      metrics: metricCount[0].value,
      snapshots: snapshotCount[0].value,
      workflowState: workflow?.state,
      workflowVersion: workflow?.version,
    };
  }

  it("persists valid proposals and provenance without mutating strategic state", async () => {
    const business = await new BusinessService(foundationRepository).create(baslonBusiness);
    const before = await strategicState(business.id);
    const model = new FakeEvidenceExtractionModel({
      output: baslonExtractionOutput,
      rawOutput: baslonExtractionOutput,
    });
    const service = new EvidenceExtractionService(extractionRepository, model);

    const result = await service.extract({
      businessId: business.id,
      rawIntakeText: baslonMessyIntake,
      sourceType: "business_intake",
      sourceReference: "Baslon Business #001 interview notes",
      sourceMetadata: { suppliedBy: "founder", capturedBy: "test fixture" },
    });

    expect(result.run).toMatchObject({
      businessId: business.id,
      status: "SUCCEEDED",
      promptVersion: EVIDENCE_EXTRACTOR_PROMPT_VERSION,
      provider: "test-provider",
      model: "deterministic-extractor-v1",
      rawIntakeText: baslonMessyIntake,
      sourceType: "business_intake",
      sourceReference: "Baslon Business #001 interview notes",
      sourceMetadata: { suppliedBy: "founder", capturedBy: "test fixture" },
      modelConfiguration: { structuredOutput: true, network: false },
      rawModelOutput: baslonExtractionOutput,
      completedAt: expect.any(Date),
    });
    expect(result.proposals).toHaveLength(6);
    expect(result.proposals.map((proposal) => proposal.proposalRef)).toEqual([
      "claim_1", "claim_2", "claim_3", "evidence_1", "metric_1", "relationship_1",
    ]);
    expect(result.output.claims.find((claim) => claim.proposalRef === "claim_3"))
      .toMatchObject({ claimType: "unknown" });
    expect(model.inputs).toHaveLength(1);
    expect(model.inputs[0]).not.toHaveProperty("businessId");
    expect(await strategicState(business.id)).toEqual(before);
  });

  it("links an extraction to its Source Submission without sending internal IDs to the model", async () => {
    const business = await new BusinessService(foundationRepository).create({
      ...baslonBusiness,
      name: "Source-linked extraction test",
    });
    const sourceService = new SourceSubmissionService(new SourceSubmissionRepository(database));
    const submission = await sourceService.create({
      businessId: business.id,
      sourceType: "additional_text",
      rawText: baslonMessyIntake,
      sourceReference: "source-linked-integration-test",
    });
    const model = new FakeEvidenceExtractionModel({
      output: baslonExtractionOutput,
      rawOutput: baslonExtractionOutput,
    });
    const service = new EvidenceExtractionService(extractionRepository, model);

    const result = await service.extract({
      businessId: business.id,
      sourceSubmissionId: submission.id,
      rawIntakeText: baslonMessyIntake,
      sourceType: submission.sourceType,
      sourceReference: submission.sourceReference ?? undefined,
    });

    expect(result.run.sourceSubmissionId).toBe(submission.id);
    expect(await sourceService.getForExtractionRun(business.id, result.run.id)).toEqual(submission);
    expect(model.inputs[0]).not.toHaveProperty("businessId");
    expect(model.inputs[0]).not.toHaveProperty("sourceSubmissionId");
  });

  it("preserves a Source Submission after failed extraction and reuses it for a later run", async () => {
    const business = await new BusinessService(foundationRepository).create({
      ...baslonBusiness,
      name: "Source-linked extraction retry test",
    });
    const sourceService = new SourceSubmissionService(new SourceSubmissionRepository(database));
    const submission = await sourceService.create({
      businessId: business.id,
      sourceType: "additional_text",
      rawText: baslonMessyIntake,
      sourceReference: "source-linked-retry-test",
    });
    const malformedService = new EvidenceExtractionService(
      extractionRepository,
      new FakeEvidenceExtractionModel({
        output: "malformed model response",
        rawOutput: "malformed model response",
      }),
    );

    await expect(malformedService.extract({
      businessId: business.id,
      sourceSubmissionId: submission.id,
      rawIntakeText: baslonMessyIntake,
    })).rejects.toThrow();
    const failedRun = await extractionRepository.getLatestRun(business.id);
    expect(failedRun).toMatchObject({
      sourceSubmissionId: submission.id,
      status: "FAILED",
    });
    expect(await sourceService.getById(business.id, submission.id)).toEqual(submission);

    const retry = await new EvidenceExtractionService(
      extractionRepository,
      new FakeEvidenceExtractionModel({
        output: baslonExtractionOutput,
        rawOutput: baslonExtractionOutput,
      }),
    ).extract({
      businessId: business.id,
      sourceSubmissionId: submission.id,
      rawIntakeText: baslonMessyIntake,
    });
    expect(retry.run).toMatchObject({
      sourceSubmissionId: submission.id,
      status: "SUCCEEDED",
    });
    expect(retry.run.id).not.toBe(failedRun?.id);
    expect(await sourceService.getById(business.id, submission.id)).toEqual(submission);
  });

  it("records malformed output as failed and persists no proposals or strategic state", async () => {
    const business = await new BusinessService(foundationRepository).create({
      ...baslonBusiness,
      name: "Baslon Digital malformed extraction test",
    });
    const before = await strategicState(business.id);
    const service = new EvidenceExtractionService(
      extractionRepository,
      new FakeEvidenceExtractionModel({
        output: "malformed model response",
        rawOutput: "malformed model response",
      }),
    );

    let failedRunId: string | undefined;
    await expect(service.extract({
      businessId: business.id,
      rawIntakeText: baslonMessyIntake,
      sourceReference: "Preserved live intake reference",
    }).catch((error: unknown) => {
      failedRunId = error && typeof error === "object" && "runId" in error
        ? String(error.runId)
        : undefined;
      throw error;
    })).rejects.toThrow();

    const [failedRun] = await database.select().from(evidenceExtractionRuns)
      .where(eq(evidenceExtractionRuns.businessId, business.id))
      .orderBy(desc(evidenceExtractionRuns.createdAt)).limit(1);
    expect(failedRun).toMatchObject({
      status: "FAILED",
      promptVersion: EVIDENCE_EXTRACTOR_PROMPT_VERSION,
      provider: "test-provider",
      model: "deterministic-extractor-v1",
      rawModelOutput: "malformed model response",
      rawIntakeText: baslonMessyIntake,
      sourceReference: "Preserved live intake reference",
    });
    expect(failedRunId).toBe(failedRun.id);
    expect(await extractionRepository.getLatestRun(business.id)).toMatchObject({
      id: failedRun.id,
      rawIntakeText: baslonMessyIntake,
      sourceReference: "Preserved live intake reference",
      status: "FAILED",
    });
    expect(failedRun.validationErrors).not.toEqual([]);
    expect(await extractionRepository.getProposals(failedRun.id, business.id)).toEqual([]);
    expect(await strategicState(business.id)).toEqual(before);
  });

  it("does not rewrite a succeeded run when the post-success proposal read fails", async () => {
    const business = await new BusinessService(foundationRepository).create({
      name: `Post-success read failure ${crypto.randomUUID()}`,
    });
    const read = vi.spyOn(extractionRepository, "getProposals")
      .mockRejectedValueOnce(new Error("forced post-success read failure"));
    try {
      await expect(new EvidenceExtractionService(
        extractionRepository,
        new FakeEvidenceExtractionModel({
          output: baslonExtractionOutput,
          rawOutput: baslonExtractionOutput,
        }),
      ).extract({
        businessId: business.id,
        rawIntakeText: baslonMessyIntake,
      })).rejects.toThrow("forced post-success read failure");
      expect(await extractionRepository.getLatestRun(business.id))
        .toMatchObject({ status: "SUCCEEDED" });
    } finally {
      read.mockRestore();
    }
  });

  it("rejects mismatched numeric provenance without mutating strategic state", async () => {
    const business = await new BusinessService(foundationRepository).create({
      ...baslonBusiness,
      name: "Baslon Digital numeric provenance test",
    });
    const before = await strategicState(business.id);
    const mismatchedOutput = structuredClone(baslonExtractionOutput);
    mismatchedOutput.metrics[0].numericValue = 81000;
    const service = new EvidenceExtractionService(
      extractionRepository,
      new FakeEvidenceExtractionModel({
        output: mismatchedOutput,
        rawOutput: mismatchedOutput,
      }),
    );

    await expect(service.extract({
      businessId: business.id,
      rawIntakeText: baslonMessyIntake,
    })).rejects.toThrow("numeric value 81000 is not explicitly present");

    const [failedRun] = await database.select().from(evidenceExtractionRuns)
      .where(eq(evidenceExtractionRuns.businessId, business.id))
      .orderBy(desc(evidenceExtractionRuns.createdAt)).limit(1);
    expect(failedRun.status).toBe("FAILED");
    expect(await extractionRepository.getProposals(failedRun.id, business.id)).toEqual([]);
    expect(await strategicState(business.id)).toEqual(before);
  });
});
