import { randomUUID } from "node:crypto";
import { count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  EvidenceExtractionModel,
  EvidenceExtractionModelConfiguration,
  EvidenceExtractionModelResult,
} from "@/ai/evidence-extractor/model";
import { EVIDENCE_EXTRACTOR_PROMPT_VERSION } from "@/ai/evidence-extractor/prompt";
import type { Database } from "@/db/client";
import {
  businessStateSnapshots,
  claims,
  evidence,
  evidenceExtractionRuns,
  evidenceProposals,
  metrics,
} from "@/db/schema";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import {
  baslonBusiness,
  baslonExtractionOutput,
  baslonMessyIntake,
} from "../fixtures/baslon-business";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

class FakeEvidenceExtractionModel implements EvidenceExtractionModel {
  constructor(private readonly result: EvidenceExtractionModelResult) {}

  getConfiguration(): EvidenceExtractionModelConfiguration {
    return {
      provider: "postgres-test-provider",
      model: "postgres-deterministic-extractor-v1",
      metadata: { structuredOutput: true, network: false },
    };
  }

  async extract() {
    return this.result;
  }
}

describe("real PostgreSQL 17 Evidence Extraction verification", () => {
  let pool: Pool;
  let database: Database;
  let foundationRepository: FoundationRepository;
  let extractionRepository: EvidenceExtractionRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 6 });
    await verifyPostgresTestDatabase(pool);
    database = drizzle({ client: pool });
    foundationRepository = new FoundationRepository(database);
    extractionRepository = new EvidenceExtractionRepository(database);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createBusiness(label: string) {
    return new BusinessService(foundationRepository).create({
      ...baslonBusiness,
      name: `${label} ${randomUUID()}`,
    });
  }

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

  it("persists a successful extraction and proposals without changing strategic state", async () => {
    const business = await createBusiness("PostgreSQL successful extraction");
    const before = await strategicState(business.id);
    const service = new EvidenceExtractionService(
      extractionRepository,
      new FakeEvidenceExtractionModel({
        output: baslonExtractionOutput,
        rawOutput: baslonExtractionOutput,
      }),
    );

    const result = await service.extract({
      businessId: business.id,
      rawIntakeText: baslonMessyIntake,
      sourceType: "business_intake",
      sourceReference: "PostgreSQL Baslon Business #001 fixture",
      sourceMetadata: { suppliedBy: "founder", verification: "postgres-17" },
    });

    const persistedRun = await extractionRepository.getRun(result.run.id, business.id);
    expect(persistedRun).toMatchObject({
      businessId: business.id,
      status: "SUCCEEDED",
      promptVersion: EVIDENCE_EXTRACTOR_PROMPT_VERSION,
      provider: "postgres-test-provider",
      model: "postgres-deterministic-extractor-v1",
      modelConfiguration: { structuredOutput: true, network: false },
      rawIntakeText: baslonMessyIntake,
      sourceType: "business_intake",
      sourceReference: "PostgreSQL Baslon Business #001 fixture",
      sourceMetadata: { suppliedBy: "founder", verification: "postgres-17" },
      rawModelOutput: baslonExtractionOutput,
      completedAt: expect.any(Date),
    });
    expect(result.proposals).toHaveLength(6);
    expect(result.proposals.map((proposal) => proposal.proposalRef)).toEqual([
      "claim_1", "claim_2", "claim_3", "evidence_1", "metric_1", "relationship_1",
    ]);
    expect(result.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        extractionRunId: result.run.id,
        businessId: business.id,
      }),
    ]));
    expect(result.proposals.every((proposal) => (
      proposal.extractionRunId === result.run.id
      && proposal.businessId === business.id
    ))).toBe(true);
    expect(await strategicState(business.id)).toEqual(before);
  });

  it("records failed extraction without proposals or strategic-state changes", async () => {
    const business = await createBusiness("PostgreSQL failed extraction");
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
      businessId: business.id,
      status: "FAILED",
      promptVersion: EVIDENCE_EXTRACTOR_PROMPT_VERSION,
      provider: "postgres-test-provider",
      model: "postgres-deterministic-extractor-v1",
      rawModelOutput: "malformed model response",
      completedAt: expect.any(Date),
    });
    expect(failedRun.validationErrors).not.toEqual([]);
    expect(await extractionRepository.getProposals(failedRun.id, business.id)).toEqual([]);
    expect(await strategicState(business.id)).toEqual(before);
  });

  it("rejects associating a proposal with another Business's extraction run", async () => {
    const runBusiness = await createBusiness("PostgreSQL proposal run owner");
    const otherBusiness = await createBusiness("PostgreSQL proposal foreign owner");
    const service = new EvidenceExtractionService(
      extractionRepository,
      new FakeEvidenceExtractionModel({
        output: baslonExtractionOutput,
        rawOutput: baslonExtractionOutput,
      }),
    );
    const result = await service.extract({
      businessId: runBusiness.id,
      rawIntakeText: baslonMessyIntake,
    });

    await expect(database.insert(evidenceProposals).values({
      extractionRunId: result.run.id,
      businessId: otherBusiness.id,
      proposalRef: `foreign_proposal_${randomUUID().replaceAll("-", "")}`,
      proposalType: "claim",
      structuredPayload: { statement: "Must be rejected by PostgreSQL" },
    })).rejects.toThrow();

    const foreignRows = await database.select({ value: count() }).from(evidenceProposals)
      .where(eq(evidenceProposals.businessId, otherBusiness.id));
    expect(foreignRows[0].value).toBe(0);
  });
});
