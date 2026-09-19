import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../helpers/pglite-migrations";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  businessStateSnapshots,
  businesses,
  claimEvidence,
  claims,
  evidence as evidenceTable,
  metrics,
} from "@/db/schema";
import { FactAdmissionRepository } from "@/repositories/fact-admission-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { FactAdmissionService } from "@/services/fact-admission-service";
import { deriveHumanAuthority } from "@/domain/server-authority";
import {
  baslonBusiness,
  baslonClaims,
  baslonEvidence,
  baslonMetric,
} from "../fixtures/baslon-business";
import { foundationPrecisionScenarios } from "../fixtures/foundation-precision-scenarios";

describe("Milestone 1 PostgreSQL foundation", () => {
  let client: PGlite;
  let database: Database;
  let repository: FoundationRepository;

  beforeAll(async () => {
    client = new PGlite();
    await applyMigrations(client);
    database = drizzle(client, { schema }) as unknown as Database;
    repository = new FoundationRepository(database);
  }, 30_000);

  afterAll(async () => {
    await client.close();
  });

  foundationPrecisionScenarios(() => repository);

  it("persists Baslon #001, provenance, relations, metrics, and immutable snapshots", async () => {
    const business = await repository.createBusiness(baslonBusiness);
    await repository.updateBusinessProfile({
      businessId: business.id,
      profileData: {
        ...baslonBusiness.profileData,
        founder_hours_target: 28,
      },
    });
    const otherBusiness = await repository.createBusiness({ name: "Another Business" });
    const [revenueClaim, aspiration, unknown] = await Promise.all(
      baslonClaims(business.id).map((claim) => repository.addClaim(claim)),
    );
    const evidence = await repository.addEvidence(baslonEvidence(business.id));
    await repository.linkClaimEvidence({
      claimId: revenueClaim.id,
      evidenceId: evidence.id,
      relationshipType: "context",
      strengthScore: 0.7,
    });
    const metric = await repository.addMetric(baslonMetric(business.id, evidence.id));

    expect(aspiration.claimType).toBe("hypothesis");
    expect(unknown.claimType).toBe("unknown");
    expect(metric.sourceEvidenceId).toBe(evidence.id);

    const factualReplacement = {
      businessId: business.id,
      statement: "Records confirm annual revenue of £80k.",
      subjectArea: "economics",
      confidenceLevel: "high",
      confidenceBasis: { basis: "accounting record confirmed by owner" },
      sourceType: "accounting_record",
    };
    await expect(repository.addClaim({ ...factualReplacement, claimType: "fact" }))
      .rejects.toThrow("FactAdmissionService");
    await expect(database.insert(claims).values({
      ...factualReplacement,
      claimType: "fact",
    })).rejects.toThrow();
    await expect(repository.supersedeClaim(
      revenueClaim.id,
      { ...factualReplacement, claimType: "fact" },
    )).rejects.toThrow("FactAdmissionService");

    const factService = new FactAdmissionService(new FactAdmissionRepository(database));
    const corrected = await factService.promoteToFact({
      currentClaimId: revenueClaim.id,
      claim: factualReplacement,
      supportingEvidenceIds: [evidence.id],
      authority: deriveHumanAuthority({ actorType: "human", actorId: "owner-1" }),
    });
    const [prior] = await database.select().from(claims).where(eq(claims.id, revenueClaim.id));
    expect(prior).toMatchObject({ status: "superseded", supersededByClaimId: corrected.id });
    expect(corrected.confidenceBasis).toMatchObject({
      factAdmission: {
        actorType: "human",
        actorId: "owner-1",
        operation: "promote",
        supportingEvidenceIds: [evidence.id],
      },
    });
    const admittedLinks = await database.select().from(claimEvidence)
      .where(eq(claimEvidence.claimId, corrected.id));
    expect(admittedLinks).toEqual([
      expect.objectContaining({
        businessId: business.id,
        evidenceId: evidence.id,
        relationshipType: "supports",
      }),
    ]);

    const foreignEvidence = await repository.addEvidence(baslonEvidence(otherBusiness.id));
    await expect(factService.createFact({
      claim: factualReplacement,
      supportingEvidenceIds: [foreignEvidence.id],
      authority: deriveHumanAuthority({ actorType: "human", actorId: "owner-1" }),
    })).rejects.toThrow("same Business");
    await expect(repository.linkClaimEvidence({
      claimId: revenueClaim.id,
      evidenceId: foreignEvidence.id,
      relationshipType: "supports",
    })).rejects.toThrow("same business");
    await expect(repository.addMetric(baslonMetric(business.id, foreignEvidence.id)))
      .rejects.toThrow("same business");

    const [first, second] = await Promise.all([
      repository.createSnapshot(business.id),
      repository.createSnapshot(business.id),
    ]);
    expect([first.version, second.version].sort()).toEqual([1, 2]);
    expect(first.snapshotData).toMatchObject({
      business: { id: business.id },
      profile: { founder_hours_target: 28 },
    });

    await expect(database.update(businessStateSnapshots)
      .set({ snapshotData: { tampered: true } }))
      .rejects.toThrow();
    const [unchanged] = await database.select().from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.id, first.id));
    expect(unchanged.snapshotData).not.toEqual({ tampered: true });
    await expect(database.update(evidenceTable)
      .set({ statement: "Tampered evidence" })
      .where(eq(evidenceTable.id, evidence.id)))
      .rejects.toThrow();
    expect(await repository.archiveBusiness(business.id)).toMatchObject({
      status: "archived",
      archivedAt: expect.any(Date),
    });
    await expect(database.delete(businesses).where(eq(businesses.id, business.id)))
      .rejects.toThrow();
  });

  it("allows exactly one concurrent workflow transition", async () => {
    const business = await repository.createBusiness({ name: "Workflow Test Business" });
    const orchestrator = createStrategyOrchestrator(database);
    const transitions = await Promise.allSettled([1, 2].map(() => orchestrator.transition({
      businessId: business.id,
      event: "START_INTAKE",
      actorType: "human",
      actorId: "owner-1",
    })));
    expect(transitions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(transitions.filter((result) => result.status === "rejected")).toHaveLength(1);
    const workflow = await repository.getWorkflow(business.id);
    expect(workflow?.state).toBe("INTAKE_IN_PROGRESS");

    const history = await repository.getTransitionHistory(workflow!.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromState: "NEW",
      toState: "INTAKE_IN_PROGRESS",
      actorType: "human",
    });

    await expect(orchestrator.transition({
      businessId: business.id,
      event: "SUBMIT_INTAKE",
      actorType: "ai",
    })).rejects.toThrow("requires a human actor");
  });

  it("rolls back workflow state when transition-history persistence fails", async () => {
    const business = await repository.createBusiness({ name: "Rollback Test Business" });
    const orchestrator = createStrategyOrchestrator(database);
    await client.exec(`
      CREATE FUNCTION fail_transition_history() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced history failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_transition_history
      BEFORE INSERT ON workflow_transitions
      FOR EACH ROW EXECUTE FUNCTION fail_transition_history();
    `);
    await expect(orchestrator.transition({
      businessId: business.id,
      event: "START_INTAKE",
      actorType: "human",
      actorId: "owner-1",
    })).rejects.toThrow();
    const workflow = await repository.getWorkflow(business.id);
    expect(workflow?.state).toBe("NEW");
    expect(await repository.getTransitionHistory(workflow!.id)).toHaveLength(0);
    await client.exec(`
      DROP TRIGGER fail_transition_history ON workflow_transitions;
      DROP FUNCTION fail_transition_history();
    `);
  });

  it("rejects cross-Business relationships at the database boundary", async () => {
    const firstBusiness = await repository.createBusiness({ name: "Boundary Business A" });
    const secondBusiness = await repository.createBusiness({ name: "Boundary Business B" });
    const firstClaim = await repository.addClaim(baslonClaims(firstBusiness.id)[0]);
    const secondClaim = await repository.addClaim(baslonClaims(secondBusiness.id)[0]);
    const secondEvidence = await repository.addEvidence(baslonEvidence(secondBusiness.id));

    await expect(database.insert(claimEvidence).values({
      businessId: firstBusiness.id,
      claimId: firstClaim.id,
      evidenceId: secondEvidence.id,
      relationshipType: "supports",
    })).rejects.toThrow();
    await expect(database.insert(metrics).values({
      businessId: firstBusiness.id,
      metricKey: "invalid_cross_business_metric",
      metricLabel: "Invalid metric",
      numericValue: "1",
      unit: "count",
      sourceEvidenceId: secondEvidence.id,
    })).rejects.toThrow();
    await expect(database.update(claims).set({
      supersededByClaimId: secondClaim.id,
    }).where(eq(claims.id, firstClaim.id))).rejects.toThrow();
  });
});
