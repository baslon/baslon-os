import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { BusinessStateService } from "@/services/business-state-service";
import {
  baslonBusiness,
  baslonClaims,
  baslonEvidence,
  baslonMetric,
} from "../fixtures/baslon-business";

describe("Milestone 1 application acceptance path", () => {
  let client: PGlite;
  let repository: FoundationRepository;
  let businessService: BusinessService;
  let businessStateService: BusinessStateService;
  let orchestrator: ReturnType<typeof createStrategyOrchestrator>;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    const migration = await readFile(
      new URL("../../drizzle/0000_furry_wolf_cub.sql", import.meta.url),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }

    const database = drizzle(client, { schema }) as unknown as Database;
    repository = new FoundationRepository(database);
    businessService = new BusinessService(repository);
    businessStateService = new BusinessStateService(repository);
    orchestrator = createStrategyOrchestrator(database);
  });

  afterAll(async () => {
    await client.close();
  });

  it("completes the Foundation path through application services", async () => {
    const business = await businessService.create(baslonBusiness);
    await businessStateService.updateProfile({
      businessId: business.id,
      profileData: {
        ...baslonBusiness.profileData,
        founder_hours_target: 28,
      },
    });

    const claim = await businessStateService.addClaim(
      baslonClaims(business.id)[1],
    );
    const evidence = await businessStateService.addEvidence(
      baslonEvidence(business.id),
    );
    const relationship = await businessStateService.linkClaimEvidence({
      claimId: claim.id,
      evidenceId: evidence.id,
      relationshipType: "context",
      strengthScore: 0.7,
    });
    const metric = await businessStateService.addMetric(
      baslonMetric(business.id, evidence.id),
    );
    const snapshot = await businessStateService.createSnapshot(business.id);

    expect(snapshot.snapshotData).toMatchObject({
      business: { id: business.id, name: "Baslon Digital" },
      profile: { founder_hours_target: 28 },
      claims: [
        expect.objectContaining({
          id: claim.id,
          claimType: "hypothesis",
        }),
      ],
      evidence: [
        expect.objectContaining({ id: evidence.id }),
      ],
      claimEvidence: [
        expect.objectContaining({
          claimId: claim.id,
          evidenceId: evidence.id,
          relationshipType: relationship.relationshipType,
        }),
      ],
      metrics: [
        expect.objectContaining({
          id: metric.id,
          metricKey: "average_project_value",
          sourceEvidenceId: evidence.id,
        }),
      ],
    });

    const initialWorkflow = await repository.getWorkflow(business.id);
    expect(initialWorkflow?.state).toBe("NEW");

    await orchestrator.transition({
      businessId: business.id,
      event: "START_INTAKE",
      actorType: "human",
      actorId: "owner-1",
    });
    await orchestrator.transition({
      businessId: business.id,
      event: "SUBMIT_INTAKE",
      actorType: "human",
      actorId: "owner-1",
    });
    await orchestrator.transition({
      businessId: business.id,
      event: "PROCESS_EVIDENCE",
      actorType: "system",
      actorId: "evidence-processor",
    });

    await expect(orchestrator.transition({
      businessId: business.id,
      event: "APPROVE_PHASE1",
      actorType: "human",
      actorId: "owner-1",
    })).rejects.toThrow("Invalid workflow transition");

    const workflow = await repository.getWorkflow(business.id);
    expect(workflow?.state).toBe("EVIDENCE_PROCESSING");
    expect(workflow?.version).toBe(4);

    const history = await repository.getTransitionHistory(workflow!.id);
    expect(history).toHaveLength(3);
    expect(history.map((transition) => transition.event)).toEqual([
      "START_INTAKE",
      "SUBMIT_INTAKE",
      "PROCESS_EVIDENCE",
    ]);
  });
});
