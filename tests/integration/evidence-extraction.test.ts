import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
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

    await expect(service.extract({
      businessId: business.id,
      rawIntakeText: baslonMessyIntake,
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
    });
    expect(failedRun.validationErrors).not.toEqual([]);
    expect(await extractionRepository.getProposals(failedRun.id, business.id)).toEqual([]);
    expect(await strategicState(business.id)).toEqual(before);
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
