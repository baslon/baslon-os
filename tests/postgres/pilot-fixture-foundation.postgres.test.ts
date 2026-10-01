import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import {
  analysisRuns,
  approvedDiagnoses,
  businesses,
  diagnosisItemReviews,
  diagnosisItems,
  diagnosisReviewSessions,
  fixtureInstanceRunProvenance,
  fixtureInstances,
  fixtureResetOperations,
  fixtureTemplates,
} from "@/db/schema";
import { deriveFixtureAdminAuthority } from "@/domain/fixture-authority";
import {
  businessUsages,
  PilotFixtureEngineUnavailableError,
  PilotFixtureRuleError,
} from "@/domain/pilot-fixture";
import {
  PHASE1_DIAGNOSIS_ARTIFACT_V2,
  PHASE1_DIAGNOSIS_INPUT_VERSION,
} from "@/domain/phase1-diagnosis";
import { PHASE1_DIAGNOSIS_PROMPT_V2 } from "@/ai/phase1-diagnosis/prompt";
import { BusinessService } from "@/services/business-service";
import { PilotFixtureService } from "@/services/pilot-fixture-service";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { PilotFixtureRepository } from "@/repositories/pilot-fixture-repository";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();
/**
 * Assert that a database operation is refused for the expected reason.
 *
 * Drizzle wraps PostgreSQL errors as "Failed query: ..." and keeps the original message
 * on `cause`, so matching the top-level message would silently pass for the wrong
 * failure. This walks the cause chain and asserts on the real database message.
 */
async function expectDatabaseRefusal(
  operation: Promise<unknown>,
  expected: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }
  expect(thrown, "expected the database to refuse this operation").toBeDefined();
  const messages: string[] = [];
  let current: unknown = thrown;
  while (current instanceof Error) {
    messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  expect(messages.join(" | ")).toMatch(expected);
}


describe("pilot fixture domain foundation on real PostgreSQL 17", () => {
  let pool: Pool;
  let database: Database;
  let foundation: FoundationRepository;
  let businessService: BusinessService;
  let fixtures: PilotFixtureRepository;
  let service: PilotFixtureService;

  /** Full admin authority. Narrowed tokens are exercised separately. */
  const admin = () => deriveFixtureAdminAuthority(
    { actorType: "human", actorId: "fixture-admin" },
    ["template_admin", "instance_admin", "reset_admin"],
  );

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 6 });
    // Mandatory shared guard: refuses anything that is not baslon_os_test on PG 17.x.
    await verifyPostgresTestDatabase(pool);
    // Second, independent runtime check before this suite mutates anything.
    const [{ db }] = (await pool.query<{ db: string }>("select current_database() as db")).rows
      .map((row) => ({ db: row.db }));
    if (db !== "baslon_os_test") throw new Error(`Refusing to mutate ${db}`);

    database = drizzle({ client: pool, schema }) as unknown as Database;
    foundation = new FoundationRepository(database);
    businessService = new BusinessService(foundation, new BusinessDeletionRepository(database));
    fixtures = new PilotFixtureRepository(database);
    service = new PilotFixtureService(fixtures);
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Seeds an independent synthetic source graph: a Business with one immutable Snapshot
   * and one approved Diagnosis bound to it. Never the live Baslon Digital graph — every
   * identifier here is freshly generated for this test run.
   */
  async function seedSyntheticSource() {
    const business = await businessService.create({
      name: `Fixture source ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    const snapshot = await foundation.createSnapshot(business.id);

    const [run] = await database.insert(analysisRuns).values({
      businessId: business.id,
      module: "phase1_diagnosis",
      runType: "synthetic_fixture_seed",
      inputSnapshotId: snapshot.id,
      // Real contract versions: an approved Diagnosis must match its run's prompt
      // version to the matching artifact version, enforced by an existing guard.
      inputProjectionVersion: PHASE1_DIAGNOSIS_INPUT_VERSION,
      inputPayload: { seeded: true },
      inputHash: `source-input-${randomUUID()}`,
      promptVersion: PHASE1_DIAGNOSIS_PROMPT_V2,
      provider: "test",
      modelIdentifier: "deterministic",
    }).returning();
    // An approvable Diagnosis needs at least one item accepted by a completed review,
    // so the seed walks the same path a real review takes rather than forcing rows in.
    const [item] = await database.insert(diagnosisItems).values({
      businessId: business.id,
      analysisRunId: run.id,
      itemRef: "I001",
      itemType: "constraint",
      statement: "Synthetic fixture seed constraint",
      rationale: "Seeded so the approval guards have a legal item to accept",
      grounding: "interpretive",
      materiality: "medium",
      interpretationConfidence: "medium",
      // Interpretive grounding must declare its limitations, by CHECK constraint.
      limitations: "Seeded synthetic item; not derived from real evidence",
      // Required on phase1_diagnosis_v2 rows by trigger.
      headline: "Synthetic fixture seed headline",
    }).returning();

    // Only now may the run be completed: diagnosis items are writable while it RUNS.
    await database.update(analysisRuns)
      .set({ status: "SUCCEEDED", completedAt: new Date(), structuredOutput: { ok: true } })
      .where(eq(analysisRuns.id, run.id));

    const [openSession] = await database.insert(diagnosisReviewSessions).values({
      businessId: business.id,
      analysisRunId: run.id,
      reviewerId: "fixture-seed-reviewer",
    }).returning();

    await database.insert(diagnosisItemReviews).values({
      businessId: business.id,
      analysisRunId: run.id,
      reviewSessionId: openSession.id,
      diagnosisItemId: item.id,
      decision: "ACCEPTED",
    });

    const [session] = await database.update(diagnosisReviewSessions)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(eq(diagnosisReviewSessions.id, openSession.id))
      .returning();

    const [diagnosis] = await database.insert(approvedDiagnoses).values({
      businessId: business.id,
      analysisRunId: run.id,
      reviewSessionId: session.id,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      inputProjectionVersion: run.inputProjectionVersion,
      promptVersion: run.promptVersion,
      inputHash: run.inputHash,
      artifactVersion: PHASE1_DIAGNOSIS_ARTIFACT_V2,
      version: 1,
      approvedBy: "fixture-seed-approver",
      approvedContent: { seeded: true },
    }).returning();

    return { business, snapshot, run, diagnosis };
  }

  /** Registers an approved template over a freshly created template Business. */
  async function seedTemplate(templateVersion = 1) {
    const source = await seedSyntheticSource();
    const templateBusiness = await businessService.create({
      name: `Fixture template ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    const template = await service.registerTemplate(admin(), {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      sourceSnapshotContentHash: `snapshot-hash-${randomUUID()}`,
      templateContentFingerprint: `template-fp-${randomUUID()}`,
      createdBy: { actorType: "human", actorId: "fixture-admin" },
      approvedBy: { actorType: "human", actorId: "fixture-approver" },
    });
    return { source, templateBusiness, template };
  }

  /** Registers an unverified first-generation instance on a new Business. */
  async function seedInstance(templateId: string) {
    const business = await businessService.create({
      name: `Fixture instance ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    const instance = await service.registerInstance(admin(), {
      businessId: business.id,
      fixtureTemplateId: templateId,
      createdBy: { actorType: "human", actorId: "fixture-admin" },
    });
    return { business, instance };
  }

  // =========================================================================
  // 1. Four usage values round-trip; invalid values fail; status stays independent
  // =========================================================================

  it("round-trips all four usage values and keeps lifecycle status independent", async () => {
    const created = await businessService.create({ name: `Usage default ${randomUUID()}` });
    expect(created.businessUsage).toBe("LIVE");

    const synthetic = await businessService.create({
      name: `Usage synthetic ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    expect(synthetic.businessUsage).toBe("SYNTHETIC_TEST");

    // The protected two are reachable only through the guarded pathway.
    const { templateBusiness, template } = await seedTemplate();
    const [templateRow] = await database.select().from(businesses)
      .where(eq(businesses.id, templateBusiness.id));
    expect(templateRow.businessUsage).toBe("PILOT_FIXTURE_TEMPLATE");

    const { business: instanceBusiness } = await seedInstance(template.id);
    const [instanceRow] = await database.select().from(businesses)
      .where(eq(businesses.id, instanceBusiness.id));
    expect(instanceRow.businessUsage).toBe("PILOT_FIXTURE_INSTANCE");

    expect([...businessUsages].sort()).toEqual([
      "LIVE", "PILOT_FIXTURE_INSTANCE", "PILOT_FIXTURE_TEMPLATE", "SYNTHETIC_TEST",
    ]);

    // An unknown value is rejected by the enum type itself.
    await expectDatabaseRefusal(
      database.execute(sql`
        update businesses set business_usage = 'NOT_A_USAGE' where id = ${synthetic.id}
      `),
      /invalid input value for enum business_usage/,
    );

    // Lifecycle and usage are orthogonal: archiving changes status, never usage.
    await businessService.archive(synthetic.id);
    const [archived] = await database.select().from(businesses)
      .where(eq(businesses.id, synthetic.id));
    expect(archived.status).toBe("archived");
    expect(archived.businessUsage).toBe("SYNTHETIC_TEST");

    await businessService.restore(synthetic.id);
    const [restored] = await database.select().from(businesses)
      .where(eq(businesses.id, synthetic.id));
    expect(restored.status).toBe("active");
    expect(restored.businessUsage).toBe("SYNTHETIC_TEST");
  });

  // =========================================================================
  // 2. Existing and ordinary new Businesses get the safe default; synthetic is explicit
  // =========================================================================

  it("defaults every ordinary Business to LIVE and leaves no row unclassified", async () => {
    await businessService.create({ name: `Default classification ${randomUUID()}` });
    const [unclassified] = await database.select({ value: sql<number>`count(*)::int` })
      .from(businesses).where(sql`business_usage is null`);
    expect(unclassified.value).toBe(0);

    // The migration backfilled pre-existing rows to LIVE, the conservative direction:
    // LIVE is ineligible for pilot reset, so a misclassification withholds a capability
    // rather than exposing real data to disposal.
    const [live] = await database.select({ value: sql<number>`count(*)::int` })
      .from(businesses).where(eq(businesses.businessUsage, "LIVE"));
    expect(live.value).toBeGreaterThan(0);
  });

  // =========================================================================
  // 3. Generic requests and unauthorised actors cannot manufacture fixture identity
  // =========================================================================

  it("refuses fixture classification through the generic create path", async () => {
    await expect(businessService.create({
      name: `Smuggled template ${randomUUID()}`,
      // @ts-expect-error deliberately outside the self-assignable union
      businessUsage: "PILOT_FIXTURE_TEMPLATE",
    })).rejects.toThrow();

    await expect(businessService.create({
      name: `Smuggled instance ${randomUUID()}`,
      // @ts-expect-error deliberately outside the self-assignable union
      businessUsage: "PILOT_FIXTURE_INSTANCE",
    })).rejects.toThrow();
  });

  it("refuses a direct database promotion into or out of a protected classification", async () => {
    const ordinary = await businessService.create({ name: `Direct promote ${randomUUID()}` });

    // Straight SQL, bypassing every service: the trigger still refuses.
    await expectDatabaseRefusal(database.execute(sql`
      update businesses set business_usage = 'PILOT_FIXTURE_TEMPLATE' where id = ${ordinary.id}
    `), /guarded fixture pathway/);

    await expectDatabaseRefusal(database.execute(sql`
      insert into businesses (name, business_usage)
      values (${`Direct insert ${randomUUID()}`}, 'PILOT_FIXTURE_INSTANCE')
    `), /guarded fixture pathway/);

    // And a fixture cannot be silently promoted to LIVE.
    const { template } = await seedTemplate();
    const { business: instanceBusiness } = await seedInstance(template.id);
    await expectDatabaseRefusal(database.execute(sql`
      update businesses set business_usage = 'LIVE' where id = ${instanceBusiness.id}
    `), /guarded fixture pathway/);

    const [stillInstance] = await database.select().from(businesses)
      .where(eq(businesses.id, instanceBusiness.id));
    expect(stillInstance.businessUsage).toBe("PILOT_FIXTURE_INSTANCE");
  });

  it("refuses fixture administration without the matching capability", async () => {
    const { source, template } = await seedTemplate();
    const resetOnly = deriveFixtureAdminAuthority(
      { actorType: "human", actorId: "reset-only" },
      ["reset_admin"],
    );
    const templateBusiness = await businessService.create({
      name: `Unauthorised template ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });

    expect(() => service.registerTemplate(resetOnly, {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 99,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      sourceSnapshotContentHash: "hash",
      templateContentFingerprint: "fp",
      createdBy: { actorType: "human", actorId: "x" },
      approvedBy: { actorType: "human", actorId: "y" },
    })).toThrow(/template_admin capability/);

    expect(() => service.registerInstance(resetOnly, {
      businessId: templateBusiness.id,
      fixtureTemplateId: template.id,
      createdBy: { actorType: "human", actorId: "x" },
    })).toThrow(/instance_admin capability/);

    // A hand-made object is not an authority, however well-shaped it looks.
    const forged = {
      actorType: "human" as const,
      actorId: "forged",
      capabilities: ["template_admin", "instance_admin", "reset_admin"] as const,
    };
    expect(() => service.retireTemplate(forged, {
      fixtureTemplateId: template.id,
      retiredBy: { actorType: "human", actorId: "forged" },
    })).toThrow(/server-derived administrative authority/);

    // AI actors cannot hold fixture authority at all.
    expect(() => deriveFixtureAdminAuthority(
      { actorType: "ai", actorId: "model" },
      ["template_admin"],
    )).toThrow(/AI actor/);
  });

  // =========================================================================
  // 4. Collisions, mismatches and invalid linkage are rejected
  // =========================================================================

  it("rejects source/template identity collision and cross-Business provenance", async () => {
    const source = await seedSyntheticSource();

    // Same Business as both source and template: a relabel, which §5.2 forbids.
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: source.business.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      sourceSnapshotContentHash: "hash",
      templateContentFingerprint: "fp",
      createdBy: { actorType: "human", actorId: "a" },
      approvedBy: { actorType: "human", actorId: "b" },
    })).rejects.toThrow(/distinct from its source/);

    // Provenance belonging to a different Business.
    const other = await seedSyntheticSource();
    const templateBusiness = await businessService.create({
      name: `Mismatch template ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: other.diagnosis.id,
      sourceApprovedDiagnosisVersion: other.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      sourceSnapshotContentHash: "hash",
      templateContentFingerprint: "fp",
      createdBy: { actorType: "human", actorId: "a" },
      approvedBy: { actorType: "human", actorId: "b" },
    })).rejects.toThrow(PilotFixtureRuleError);

    // A LIVE Business can never become a template.
    const liveBusiness = await businessService.create({ name: `Live ${randomUUID()}` });
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: liveBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 2,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      sourceSnapshotContentHash: "hash",
      templateContentFingerprint: "fp",
      createdBy: { actorType: "human", actorId: "a" },
      approvedBy: { actorType: "human", actorId: "b" },
    })).rejects.toThrow(/LIVE Business cannot be registered/);
  });

  it("rejects duplicate Business linkage and duplicate version per source", async () => {
    const { source, template, templateBusiness } = await seedTemplate(1);

    // One template per Business.
    const secondSource = await seedSyntheticSource();
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: secondSource.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: secondSource.diagnosis.id,
      sourceApprovedDiagnosisVersion: secondSource.diagnosis.version,
      sourceSnapshotId: secondSource.snapshot.id,
      sourceSnapshotVersion: secondSource.snapshot.version,
      sourceSnapshotContentHash: "hash",
      templateContentFingerprint: "fp",
      createdBy: { actorType: "human", actorId: "a" },
      approvedBy: { actorType: "human", actorId: "b" },
    })).rejects.toThrow();

    // Version is unique per source family, so a duplicate v1 for the same source fails.
    const anotherTemplateBusiness = await businessService.create({
      name: `Duplicate version ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: anotherTemplateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      sourceSnapshotContentHash: "hash",
      templateContentFingerprint: "fp",
      createdBy: { actorType: "human", actorId: "a" },
      approvedBy: { actorType: "human", actorId: "b" },
    })).rejects.toThrow();

    expect(template.templateVersion).toBe(1);
  });

  it("rejects invalid predecessor and template linkage on instances", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    const replacementBusiness = await businessService.create({
      name: `Bad generation ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });

    // Generation 0 with a predecessor is contradictory.
    await expect(service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: template.id,
      createdBy: { actorType: "human", actorId: "a" },
      generation: 0,
      predecessorInstanceId: instance.id,
    })).rejects.toThrow(/first-generation instance has no predecessor/);

    // A later generation without a predecessor is equally contradictory.
    await expect(service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: template.id,
      createdBy: { actorType: "human", actorId: "a" },
      generation: 1,
    })).rejects.toThrow(/requires a predecessor/);

    // Generation must advance by exactly one.
    await expect(service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: template.id,
      createdBy: { actorType: "human", actorId: "a" },
      generation: 5,
      predecessorInstanceId: instance.id,
    })).rejects.toThrow(/exactly one greater/);

    // A replacement must come from the predecessor's own template.
    const { template: otherTemplate } = await seedTemplate();
    await expect(service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: otherTemplate.id,
      createdBy: { actorType: "human", actorId: "a" },
      generation: 1,
      predecessorInstanceId: instance.id,
    })).rejects.toThrow(/derive from the predecessor's template/);

    // A template Business cannot double as an instance.
    const { template: t2, templateBusiness: tb2 } = await seedTemplate();
    await expect(service.registerInstance(admin(), {
      businessId: tb2.id,
      fixtureTemplateId: t2.id,
      createdBy: { actorType: "human", actorId: "a" },
    })).rejects.toThrow(PilotFixtureRuleError);
  });

  // =========================================================================
  // 5. Approved template baseline cannot be edited; retirement preserves it
  // =========================================================================

  it("freezes an approved template baseline and allows only retirement", async () => {
    const { template } = await seedTemplate();

    for (const mutation of [
      sql`update fixture_templates set source_snapshot_content_hash = 'tampered' where id = ${template.id}`,
      sql`update fixture_templates set template_content_fingerprint = 'tampered' where id = ${template.id}`,
      sql`update fixture_templates set source_business_id = ${randomUUID()} where id = ${template.id}`,
      sql`update fixture_templates set template_version = 42 where id = ${template.id}`,
      sql`update fixture_templates set approved_by_actor_id = 'someone-else' where id = ${template.id}`,
    ]) {
      await expectDatabaseRefusal(database.execute(mutation), /immutable/);
    }

    const retired = await service.retireTemplate(admin(), {
      fixtureTemplateId: template.id,
      retiredBy: { actorType: "human", actorId: "fixture-admin" },
    });
    expect(retired.status).toBe("RETIRED");
    expect(retired.retiredAt).not.toBeNull();

    // Retirement preserved every provenance field.
    expect(retired.sourceSnapshotContentHash).toBe(template.sourceSnapshotContentHash);
    expect(retired.templateContentFingerprint).toBe(template.templateContentFingerprint);
    expect(retired.sourceBusinessId).toBe(template.sourceBusinessId);
    expect(retired.templateVersion).toBe(template.templateVersion);
    expect(retired.approvedByActorId).toBe(template.approvedByActorId);

    // Retirement is one-way, and a retired template cannot be un-retired or reused.
    await expect(service.retireTemplate(admin(), {
      fixtureTemplateId: template.id,
      retiredBy: { actorType: "human", actorId: "fixture-admin" },
    })).rejects.toThrow(/cannot be retired/);
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_templates set status = 'ACTIVE' where id = ${template.id}
    `), /ACTIVE to RETIRED/);

    const orphanBusiness = await businessService.create({
      name: `Retired template instance ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    await expect(service.registerInstance(admin(), {
      businessId: orphanBusiness.id,
      fixtureTemplateId: template.id,
      createdBy: { actorType: "human", actorId: "a" },
    })).rejects.toThrow(/RETIRED template cannot create new instances/);
  });

  // =========================================================================
  // 6. Unverified, failed and incomplete instances stay ineligible
  // =========================================================================

  it("keeps unverified, failed and detached instances ineligible", async () => {
    const { template } = await seedTemplate();
    const { business, instance } = await seedInstance(template.id);

    // Correctly classified, metadata present — and still ineligible, because no clone
    // verification has run. Classification alone never establishes eligibility.
    expect(instance.verificationPassed).toBe(false);
    let eligibility = await service.evaluateEligibility(business.id);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain("clone_verification_not_passed");

    await service.recordInstanceVerification(admin(), {
      fixtureInstanceId: instance.id,
      verificationFingerprint: `verified-${randomUUID()}`,
      verifiedBy: { actorType: "human", actorId: "verifier" },
    });
    eligibility = await service.evaluateEligibility(business.id);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reasons).toEqual([]);

    // Verification cannot be forged directly: the CHECK demands the whole evidence set.
    const { business: b2, instance: i2 } = await seedInstance(template.id);
    await expectDatabaseRefusal(
      database.execute(sql`
        update fixture_instances set verification_passed = true where id = ${i2.id}
      `),
      /fixture_instances_verification_check/,
    );
    expect((await service.evaluateEligibility(b2.id)).eligible).toBe(false);

    // A failed creation is terminal and never eligible.
    const { business: b3, instance: i3 } = await seedInstance(template.id);
    await service.markInstanceFailedCreation(admin(), {
      fixtureInstanceId: i3.id,
      failureReason: "clone aborted during seeding",
      recordedBy: { actorType: "human", actorId: "a" },
    });
    const failed = await service.evaluateEligibility(b3.id);
    expect(failed.eligible).toBe(false);
    expect(failed.reasons).toContain("fixture_instance_not_active");
    await expect(service.recordInstanceVerification(admin(), {
      fixtureInstanceId: i3.id,
      verificationFingerprint: "late",
      verifiedBy: { actorType: "human", actorId: "a" },
    })).rejects.toThrow(/cannot record a verification result/);

    // An ordinary Business with no fixture metadata is ineligible for both reasons.
    const plain = await businessService.create({ name: `Plain ${randomUUID()}` });
    const plainEligibility = await service.evaluateEligibility(plain.id);
    expect(plainEligibility.eligible).toBe(false);
    expect(plainEligibility.reasons).toContain("business_usage_not_pilot_fixture_instance");
    expect(plainEligibility.reasons).toContain("fixture_instance_metadata_missing");
  });

  it("records per-run provenance keeping source hashes distinct from the clone", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);

    const clonedRunId = randomUUID();
    const sourceRunId = randomUUID();
    const recorded = await service.recordRunProvenance(admin(), {
      fixtureInstanceId: instance.id,
      entries: [{
        clonedAnalysisRunId: clonedRunId,
        sourceAnalysisRunId: sourceRunId,
        sourceAnalysisModule: "phase1_diagnosis",
        sourceInputHash: "source-input-hash-abc",
        sourceSnapshotContentHash: "source-snapshot-hash-def",
      }],
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].sourceInputHash).toBe("source-input-hash-abc");
    expect(recorded[0].sourceSnapshotContentHash).toBe("source-snapshot-hash-def");
    expect(recorded[0].clonedAnalysisRunId).not.toBe(recorded[0].sourceAnalysisRunId);

    // The record of what was copied is never edited.
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_instance_run_provenance set source_input_hash = 'tampered'
      where id = ${recorded[0].id}
    `), /immutable/);

    // A cloned run cannot masquerade as its own source.
    await expect(service.recordRunProvenance(admin(), {
      fixtureInstanceId: instance.id,
      entries: [{
        clonedAnalysisRunId: sourceRunId,
        sourceAnalysisRunId: sourceRunId,
        sourceAnalysisModule: "phase1_diagnosis",
        sourceInputHash: "h",
      }],
    })).rejects.toThrow(/must differ from its source/);

    // The same cloned run cannot be mapped twice for one instance.
    await expect(service.recordRunProvenance(admin(), {
      fixtureInstanceId: instance.id,
      entries: [{
        clonedAnalysisRunId: clonedRunId,
        sourceAnalysisRunId: randomUUID(),
        sourceAnalysisModule: "phase1_diagnosis",
        sourceInputHash: "h",
      }],
    })).rejects.toThrow();
  });

  // =========================================================================
  // 7. Reset metadata: identities, export confirmation, retries, invalid transitions
  // =========================================================================

  it("preserves reset identities, demands export confirmation and rejects rebinding", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await service.recordInstanceVerification(admin(), {
      fixtureInstanceId: instance.id,
      verificationFingerprint: `v-${randomUUID()}`,
      verifiedBy: { actorType: "human", actorId: "verifier" },
    });

    const operationId = randomUUID();
    const request = await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "pilot attempt complete",
      requestedBy: { actorType: "human", actorId: "reset-admin" },
    });
    expect(request.state).toBe("REQUESTED");
    expect(request.originalBusinessId).toBe(instance.historicalBusinessId);

    // A request alone never means success.
    expect(request.completedAt).toBeNull();
    expect(request.replacementInstanceId).toBeNull();

    // Retry with the same id is idempotent and returns the same row.
    const replay = await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "pilot attempt complete",
      requestedBy: { actorType: "human", actorId: "reset-admin" },
    });
    expect(replay.id).toBe(request.id);
    expect(replay.originalInstanceId).toBe(instance.id);

    // A retry must not be able to point the operation at a different victim.
    const { instance: otherInstance } = await seedInstance(template.id);
    await expect(service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: otherInstance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "hijack",
      requestedBy: { actorType: "human", actorId: "reset-admin" },
    })).rejects.toThrow(/cannot be rebound to a different original instance/);

    // Disposal cannot begin before the reviewed export is confirmed.
    await expect(service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "DISPOSING",
    })).rejects.toThrow(/verified reviewed export/);

    const confirmed = await service.confirmResetExport(admin(), {
      resetOperationId: operationId,
      exportReference: "s3://baslon-pilot-exports/attempt-1.json",
      exportChecksum: "sha256-abc123",
      disposalConfirmedBy: { actorType: "human", actorId: "owner" },
    });
    expect(confirmed.exportVerifiedAt).not.toBeNull();
    expect(confirmed.disposalConfirmedAt).not.toBeNull();

    // A confirmed export reference is part of the audit and cannot be re-pointed.
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_reset_operations set export_reference = 'elsewhere' where id = ${operationId}
    `), /confirmed reviewed-export reference cannot be changed/);

    // Illegal jumps in the state machine fail.
    await expect(service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "SUCCEEDED",
    })).rejects.toThrow(/cannot move from REQUESTED to SUCCEEDED/);

    await service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "DISPOSING",
      preDisposalFingerprint: `pre-${randomUUID()}`,
    });

    // Walk to a replacement and succeed.
    const replacementBusiness = await businessService.create({
      name: `Replacement ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    const replacement = await service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: template.id,
      createdBy: { actorType: "human", actorId: "a" },
      generation: 1,
      predecessorInstanceId: instance.id,
    });
    await service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "RECREATING",
      replacementInstanceId: replacement.id,
    });

    // Once recorded, the replacement cannot be swapped for another.
    const { instance: decoy } = await seedInstance(template.id);
    await expect(service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "VERIFYING",
      replacementInstanceId: decoy.id,
    })).rejects.toThrow(/cannot be replaced by a different one/);

    await service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "VERIFYING",
    });
    const succeeded = await service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "SUCCEEDED",
      replacementVerificationFingerprint: `rv-${randomUUID()}`,
    });
    expect(succeeded.state).toBe("SUCCEEDED");
    expect(succeeded.originalInstanceId).toBe(instance.id);
    expect(succeeded.replacementInstanceId).toBe(replacement.id);
    expect(succeeded.replacementBusinessId).toBe(replacement.historicalBusinessId);
    expect(succeeded.completedAt).not.toBeNull();

    // A terminal operation is frozen.
    await expect(service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "FAILED",
      failureCode: "late",
    })).rejects.toThrow(/cannot move from SUCCEEDED/);
  });

  it("records a failure through a separate guarded update and requires a code", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    const operationId = randomUUID();
    await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "will fail",
      requestedBy: { actorType: "human", actorId: "reset-admin" },
    });

    await expect(service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "FAILED",
    })).rejects.toThrow(/requires a failure code/);

    // The committed REQUESTED record survives and takes the failure, exactly as §9.4
    // requires of a rolled-back destructive transaction.
    const failed = await service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "FAILED",
      failureCode: "export_verification_failed",
      failureDetail: "checksum mismatch",
    });
    expect(failed.state).toBe("FAILED");
    expect(failed.failureCode).toBe("export_verification_failed");
    expect(failed.originalInstanceId).toBe(instance.id);
    expect(failed.replacementInstanceId).toBeNull();
  });

  // =========================================================================
  // 8. Audit and retained provenance survive the deletion boundary
  // =========================================================================

  it("keeps audit and retained identity after the fixture Business is deleted", async () => {
    const { template } = await seedTemplate();
    const { business, instance } = await seedInstance(template.id);
    await service.recordRunProvenance(admin(), {
      fixtureInstanceId: instance.id,
      entries: [{
        clonedAnalysisRunId: randomUUID(),
        sourceAnalysisRunId: randomUUID(),
        sourceAnalysisModule: "phase1_diagnosis",
        sourceInputHash: "retained-source-hash",
        sourceSnapshotContentHash: "retained-snapshot-hash",
      }],
    });
    const operationId = randomUUID();
    await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "disposal persistence check",
      requestedBy: { actorType: "human", actorId: "reset-admin" },
    });

    // While the instance still holds its live link, the Business is protected from
    // deletion by the restrict FK. Step A has no disposal engine, so that is correct.
    await businessService.archive(business.id);
    const confirmation = await businessService.getPermanentDeleteConfirmation(business.id);
    await expect(businessService.permanentlyDelete({
      businessId: business.id,
      confirmation: confirmation.phrase,
    })).rejects.toThrow();

    // Detach the live link the way Step D disposal will, keeping the retained identity.
    await database.update(fixtureInstances).set({
      businessId: null,
      businessUsageBinding: null,
      status: "DISPOSED",
      disposedAt: new Date(),
      disposalByActorType: "human",
      disposalByActorId: "reset-admin",
      disposalReason: "disposal persistence check",
    }).where(eq(fixtureInstances.id, instance.id));

    const deleted = await businessService.permanentlyDelete({
      businessId: business.id,
      confirmation: confirmation.phrase,
    });
    expect(deleted.businessId).toBe(business.id);
    const [gone] = await database.select({ value: sql<number>`count(*)::int` })
      .from(businesses).where(eq(businesses.id, business.id));
    expect(gone.value).toBe(0);

    // Everything needed to interpret the disposal survived it.
    const survivingInstance = await service.getInstance(instance.id);
    expect(survivingInstance).not.toBeNull();
    expect(survivingInstance!.businessId).toBeNull();
    expect(survivingInstance!.historicalBusinessId).toBe(business.id);
    expect(survivingInstance!.status).toBe("DISPOSED");

    const provenance = await service.listRunProvenance(instance.id);
    expect(provenance).toHaveLength(1);
    expect(provenance[0].sourceInputHash).toBe("retained-source-hash");

    const audit = await service.listResetOperationsForBusiness(business.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].id).toBe(operationId);
    expect(audit[0].originalBusinessId).toBe(business.id);

    // And the audit itself cannot be deleted.
    await expectDatabaseRefusal(database.execute(sql`
      delete from fixture_reset_operations where id = ${operationId}
    `), /retained audit trail/);
  });

  it("protects a template Business from deletion while its template exists", async () => {
    const { templateBusiness } = await seedTemplate();
    await businessService.archive(templateBusiness.id);
    const confirmation = await businessService.getPermanentDeleteConfirmation(templateBusiness.id);
    await expect(businessService.permanentlyDelete({
      businessId: templateBusiness.id,
      confirmation: confirmation.phrase,
    })).rejects.toThrow();
    const [stillThere] = await database.select({ value: sql<number>`count(*)::int` })
      .from(businesses).where(eq(businesses.id, templateBusiness.id));
    expect(stillThere.value).toBe(1);
  });

  // =========================================================================
  // 9. Guard rejection, and the engines fail closed
  // =========================================================================

  it("rejects a non-test target before any mutation", async () => {
    expect(() => requirePostgresTestDatabaseUrl(
      "postgresql://baslon:secret@localhost:5432/baslon_os",
    )).toThrow(/baslon_os_test/);
    // An absent value is refused too. Passing "" rather than undefined, because
    // undefined falls through to the function's own process.env default.
    expect(() => requirePostgresTestDatabaseUrl("")).toThrow(/TEST_DATABASE_URL/);
    expect(() => requirePostgresTestDatabaseUrl("not-a-url")).toThrow(/valid TEST_DATABASE_URL/);
    // This suite's own connection resolves to the test database.
    const [{ db }] = (await pool.query<{ db: string }>("select current_database() as db")).rows;
    expect(db).toBe("baslon_os_test");
  });

  it("fails closed on every operation that needs the Step B or Step D engines", () => {
    expect(() => service.createTemplateFromSource()).toThrow(PilotFixtureEngineUnavailableError);
    expect(() => service.createInstanceFromTemplate()).toThrow(/Step B/);
    expect(() => service.verifyClone()).toThrow(/Step B/);
    expect(() => service.resetPilotFixture()).toThrow(/Step D/);
    expect(() => service.disposePilotFixtureInstance()).toThrow(/Step D/);
    expect(() => service.generateReviewedExport()).toThrow(/Step D/);
  });

  it("leaves no fixture row referencing a Business of the wrong classification", async () => {
    const [mismatchedTemplates] = await database.select({ value: sql<number>`count(*)::int` })
      .from(fixtureTemplates)
      .innerJoin(businesses, eq(businesses.id, fixtureTemplates.templateBusinessId))
      .where(sql`${businesses.businessUsage} <> 'PILOT_FIXTURE_TEMPLATE'`);
    expect(mismatchedTemplates.value).toBe(0);

    const [mismatchedInstances] = await database.select({ value: sql<number>`count(*)::int` })
      .from(fixtureInstances)
      .innerJoin(businesses, eq(businesses.id, fixtureInstances.businessId))
      .where(sql`${businesses.businessUsage} <> 'PILOT_FIXTURE_INSTANCE'`);
    expect(mismatchedInstances.value).toBe(0);

    // Reset operations are keyed on retained identities, never on a live FK to a
    // Business, which is what lets the audit outlive the graph.
    const [orphanAudit] = await database.select({ value: sql<number>`count(*)::int` })
      .from(fixtureResetOperations);
    expect(orphanAudit.value).toBeGreaterThan(0);

    const [provenanceRows] = await database.select({ value: sql<number>`count(*)::int` })
      .from(fixtureInstanceRunProvenance);
    expect(provenanceRows.value).toBeGreaterThan(0);

    // Sanity: the composite FK means an instance's recorded template version always
    // matches a real template version.
    const [versionMismatch] = await database.select({ value: sql<number>`count(*)::int` })
      .from(fixtureInstances)
      .innerJoin(fixtureTemplates, eq(fixtureTemplates.id, fixtureInstances.fixtureTemplateId))
      .where(and(sql`${fixtureInstances.templateVersion} <> ${fixtureTemplates.templateVersion}`));
    expect(versionMismatch.value).toBe(0);
  });
});
