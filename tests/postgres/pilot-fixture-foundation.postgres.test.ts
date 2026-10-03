import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import {
  analysisRuns,
  approvedDiagnoses,
  businesses,
  businessStateSnapshots,
  diagnosisItemReviews,
  diagnosisItems,
  diagnosisReviewSessions,
  fixtureInstanceRunProvenance,
  fixtureInstances,
  fixtureResetOperations,
  fixtureTemplates,
} from "@/db/schema";
import { stableSha256 } from "@/domain/phase1-diagnosis-projection";
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
import { ProtectedFixtureTemplateError } from "@/repositories/business-lifecycle-guard";
import { testFixtureAuthority } from "../helpers/fixture-admin-principal";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

/**
 * Assert a database operation is refused for the expected reason.
 *
 * Drizzle wraps PostgreSQL errors as "Failed query: ..." and keeps the real message on
 * `cause`, so matching the wrapper would pass for the wrong failure. This walks the cause
 * chain and asserts on the actual database message.
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

  /** Full administrative authority, resolved from a trusted test principal (R1). */
  const admin = () => testFixtureAuthority("fixture_administrator", "fixture-admin");

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 8 });
    // Mandatory shared guard: refuses anything that is not baslon_os_test on PG 17.x.
    await verifyPostgresTestDatabase(pool);
    // Independent runtime check before this suite mutates anything.
    const [{ db }] = (await pool.query<{ db: string }>("select current_database() as db")).rows;
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
   * and one approved Diagnosis bound to it. Never the live Baslon Digital graph.
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
      inputProjectionVersion: PHASE1_DIAGNOSIS_INPUT_VERSION,
      inputPayload: { seeded: true },
      inputHash: `source-input-${randomUUID()}`,
      promptVersion: PHASE1_DIAGNOSIS_PROMPT_V2,
      provider: "test",
      modelIdentifier: "deterministic",
    }).returning();

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
      limitations: "Seeded synthetic item; not derived from real evidence",
      headline: "Synthetic fixture seed headline",
    }).returning();

    // Items are writable only while the run RUNS, so completion comes after.
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
      approvedBy: `source-approver-${randomUUID()}`,
      approvedContent: { seeded: true },
    }).returning();

    return { business, snapshot, run, diagnosis };
  }

  /** Registers AND approves a template: instances require an approved version. */
  async function seedTemplate(templateVersion = 1) {
    const source = await seedSyntheticSource();
    const templateBusiness = await businessService.create({
      name: `Fixture template ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    const fingerprint = `template-fp-${randomUUID()}`;
    const registered = await service.registerTemplate(admin(), {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      templateContentFingerprint: fingerprint,
    });
    const template = await service.approveTemplate(admin(), {
      fixtureTemplateId: registered.id,
      templateContentFingerprint: fingerprint,
    });
    return { source, templateBusiness, template, registered, fingerprint };
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
    });
    return { business, instance };
  }

  async function verify(instanceId: string) {
    return service.recordInstanceVerification(admin(), {
      fixtureInstanceId: instanceId,
      verificationFingerprint: `verified-${randomUUID()}`,
    });
  }

  /** Drives an operation to the point where disposal metadata has committed. */
  async function seedDisposedOriginal() {
    const { template } = await seedTemplate();
    const { business, instance } = await seedInstance(template.id);
    await verify(instance.id);
    const operationId = randomUUID();
    await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "pilot attempt complete",
    });
    await service.confirmResetExport(admin(), {
      resetOperationId: operationId,
      exportReference: `s3://baslon-pilot-exports/${operationId}.json`,
      exportChecksum: `sha256-${randomUUID()}`,
    });
    await service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "DISPOSING",
      preDisposalFingerprint: `pre-${randomUUID()}`,
    });
    // The disposal METADATA contract. Step D calls this inside the same transaction as the
    // real deletion; here it is a labelled schema simulation, not proof of disposal.
    await service.applyDisposalMetadata(admin(), {
      resetOperationId: operationId,
      fixtureInstanceId: instance.id,
      reason: "pilot attempt complete",
    });
    return { template, business, instance, operationId };
  }

  // =========================================================================
  // Classification
  // =========================================================================

  it("round-trips all four usage values and keeps lifecycle status independent", async () => {
    const created = await businessService.create({ name: `Usage default ${randomUUID()}` });
    expect(created.businessUsage).toBe("LIVE");

    const synthetic = await businessService.create({
      name: `Usage synthetic ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    expect(synthetic.businessUsage).toBe("SYNTHETIC_TEST");

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
    await expectDatabaseRefusal(
      database.execute(sql`
        update businesses set business_usage = 'NOT_A_USAGE' where id = ${synthetic.id}
      `),
      /invalid input value for enum business_usage/,
    );

    // Lifecycle and usage are orthogonal.
    await businessService.archive(synthetic.id);
    const [archived] = await database.select().from(businesses)
      .where(eq(businesses.id, synthetic.id));
    expect(archived.status).toBe("archived");
    expect(archived.businessUsage).toBe("SYNTHETIC_TEST");
    await businessService.restore(synthetic.id);
  });

  it("defaults every ordinary Business to LIVE and leaves no row unclassified", async () => {
    await businessService.create({ name: `Default classification ${randomUUID()}` });
    const [unclassified] = await database.select({ value: sql<number>`count(*)::int` })
      .from(businesses).where(sql`business_usage is null`);
    expect(unclassified.value).toBe(0);
    const [live] = await database.select({ value: sql<number>`count(*)::int` })
      .from(businesses).where(eq(businesses.businessUsage, "LIVE"));
    expect(live.value).toBeGreaterThan(0);
  });

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
    await expectDatabaseRefusal(database.execute(sql`
      update businesses set business_usage = 'PILOT_FIXTURE_TEMPLATE' where id = ${ordinary.id}
    `), /guarded fixture pathway/);
    await expectDatabaseRefusal(database.execute(sql`
      insert into businesses (name, business_usage)
      values (${`Direct insert ${randomUUID()}`}, 'PILOT_FIXTURE_INSTANCE')
    `), /guarded fixture pathway/);

    const { template } = await seedTemplate();
    const { business: instanceBusiness } = await seedInstance(template.id);
    await expectDatabaseRefusal(database.execute(sql`
      update businesses set business_usage = 'LIVE' where id = ${instanceBusiness.id}
    `), /guarded fixture pathway/);

    // The setting is scoped to one Business id, so a stolen setting cannot cover another
    // row in the same transaction.
    const other = await businessService.create({ name: `Scoped setting ${randomUUID()}` });
    await expectDatabaseRefusal(database.transaction(async (tx) => {
      // The setting names a DIFFERENT Business, so it cannot cover this row.
      await tx.execute(sql`select set_config('baslon.fixture_usage_change', ${ordinary.id}, true)`);
      await tx.execute(sql`
        update businesses set business_usage = 'PILOT_FIXTURE_TEMPLATE' where id = ${other.id}
      `);
    }), /guarded fixture pathway/);
  });

  // =========================================================================
  // R1 / R2 — authority and audit attribution
  // =========================================================================

  it("refuses fixture administration without the matching capability", async () => {
    const { source, template } = await seedTemplate();
    const resetOnly = testFixtureAuthority("fixture_reset_administrator", "reset-only");
    const templateBusiness = await businessService.create({
      name: `Unauthorised template ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });

    await expect(service.registerTemplate(resetOnly, {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 99,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      templateContentFingerprint: "fp",
    })).rejects.toThrow(/template_admin capability/);

    await expect(service.registerInstance(resetOnly, {
      businessId: templateBusiness.id,
      fixtureTemplateId: template.id,
    })).rejects.toThrow(/instance_admin capability/);

    const forged = {
      actorType: "human" as const,
      actorId: "forged",
      capabilities: ["template_admin", "instance_admin", "reset_admin"] as const,
    };
    await expect(service.retireTemplate(forged, { fixtureTemplateId: template.id }))
      .rejects.toThrow(/server-derived administrative authority/);
  });

  it("records the executing actor from authority and cannot be impersonated", async () => {
    const alice = testFixtureAuthority("fixture_administrator", "alice");
    const source = await seedSyntheticSource();
    const templateBusiness = await businessService.create({
      name: `Attributed template ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    const fingerprint = `fp-${randomUUID()}`;
    const registered = await service.registerTemplate(alice, {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      templateContentFingerprint: fingerprint,
      // An impersonation attempt: the contract has no actor field at all, so a stray key
      // is rejected outright by the strict schema rather than silently ignored.
      // @ts-expect-error there is deliberately no caller-supplied actor
      createdBy: { actorType: "human", actorId: "bob" },
    }).catch((error: unknown) => error);
    expect(registered).toBeInstanceOf(Error);

    const clean = await service.registerTemplate(alice, {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      templateContentFingerprint: fingerprint,
    });
    // Execution attribution comes from the authority.
    expect(clean.createdByActorId).toBe("alice");
    // Historical source approval is copied from the stored Diagnosis, not invented.
    expect(clean.sourceApprovalActorId).toBe(source.diagnosis.approvedBy);
    expect(clean.sourceApprovedAt?.toISOString())
      .toBe(source.diagnosis.approvedAt.toISOString());
    // And the template itself is NOT approved merely because its source was.
    expect(clean.templateApprovedAt).toBeNull();

    const approved = await service.approveTemplate(
      testFixtureAuthority("fixture_template_administrator", "carol"),
      { fixtureTemplateId: clean.id, templateContentFingerprint: fingerprint },
    );
    expect(approved.templateApprovedByActorId).toBe("carol");
    expect(approved.createdByActorId).toBe("alice");
    expect(approved.sourceApprovalActorId).toBe(source.diagnosis.approvedBy);
  });

  it("refuses an unapproved template version for instance creation", async () => {
    const source = await seedSyntheticSource();
    const templateBusiness = await businessService.create({
      name: `Unapproved ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    const registered = await service.registerTemplate(admin(), {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      templateContentFingerprint: `fp-${randomUUID()}`,
    });
    const instanceBusiness = await businessService.create({
      name: `Unapproved instance ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    await expect(service.registerInstance(admin(), {
      businessId: instanceBusiness.id,
      fixtureTemplateId: registered.id,
    })).rejects.toThrow(/unapproved template version/);

    // Approval binds to the content the approver saw.
    await expect(service.approveTemplate(admin(), {
      fixtureTemplateId: registered.id,
      templateContentFingerprint: "different-content",
    })).rejects.toThrow(/does not match the registered template content/);
  });

  it("persists failure attribution instead of discarding it", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    const failed = await service.markInstanceFailedCreation(
      testFixtureAuthority("fixture_instance_administrator", "dave"),
      { fixtureInstanceId: instance.id, failureReason: "clone aborted during seeding" },
    );
    expect(failed.status).toBe("FAILED_CREATION");
    expect(failed.failureRecordedByActorId).toBe("dave");
    expect(failed.failureRecordedByActorType).toBe("human");
    expect(failed.failureRecordedAt).not.toBeNull();
  });

  it("refuses a system actor for disposal confirmation but allows orchestration", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await verify(instance.id);
    const operationId = randomUUID();
    const systemAuthority = testFixtureAuthority(
      "fixture_reset_administrator", "scheduler", "system",
    );
    // A system actor may request a reset.
    await service.createResetRequest(systemAuthority, {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "scheduled",
    });
    // It may not invent the human confirmation §9.5 requires.
    await expect(service.confirmResetExport(systemAuthority, {
      resetOperationId: operationId,
      exportReference: "s3://x",
      exportChecksum: "sha256-x",
    })).rejects.toThrow(/requires an explicit human actor/);

    const confirmed = await service.confirmResetExport(admin(), {
      resetOperationId: operationId,
      exportReference: "s3://baslon-pilot-exports/human.json",
      exportChecksum: "sha256-human",
    });
    expect(confirmed.disposalConfirmedByActorType).toBe("human");
    expect(confirmed.disposalConfirmedByActorId).toBe("fixture-admin");
  });

  // =========================================================================
  // R6 — provenance consistency
  // =========================================================================

  it("requires the approved Diagnosis to be bound to the supplied Snapshot", async () => {
    const source = await seedSyntheticSource();
    // A second Snapshot of the SAME source Business that the Diagnosis is not bound to.
    const otherSnapshot = await foundation.createSnapshot(source.business.id);
    const templateBusiness = await businessService.create({
      name: `Snapshot binding ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: otherSnapshot.id,
      sourceSnapshotVersion: otherSnapshot.version,
      templateContentFingerprint: "fp",
    })).rejects.toThrow(/not bound to the supplied Snapshot/);
  });

  it("derives the source Snapshot hash and refuses a false one", async () => {
    const source = await seedSyntheticSource();
    const [stored] = await database.select().from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.id, source.snapshot.id));
    const expectedHash = stableSha256(stored.snapshotData);

    const templateBusiness = await businessService.create({
      name: `Derived hash ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      expectedSourceSnapshotContentHash: "not-the-real-hash",
      templateContentFingerprint: "fp",
    })).rejects.toThrow(/does not match the stored Snapshot/);

    const ok = await service.registerTemplate(admin(), {
      templateBusinessId: templateBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      expectedSourceSnapshotContentHash: expectedHash,
      templateContentFingerprint: "fp",
    });
    // Stored value is the derived one, whether or not a cross-check was supplied.
    expect(ok.sourceSnapshotContentHash).toBe(expectedHash);
  });

  it("rejects source/template collisions and cross-Business provenance", async () => {
    const source = await seedSyntheticSource();
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: source.business.id,
      sourceBusinessId: source.business.id,
      templateVersion: 1,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      templateContentFingerprint: "fp",
    })).rejects.toThrow(/distinct from its source/);

    const other = await seedSyntheticSource();
    const templateBusiness = await businessService.create({
      name: `Mismatch ${randomUUID()}`,
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
      templateContentFingerprint: "fp",
    })).rejects.toThrow(PilotFixtureRuleError);

    const liveBusiness = await businessService.create({ name: `Live ${randomUUID()}` });
    await expect(service.registerTemplate(admin(), {
      templateBusinessId: liveBusiness.id,
      sourceBusinessId: source.business.id,
      templateVersion: 2,
      sourceApprovedDiagnosisId: source.diagnosis.id,
      sourceApprovedDiagnosisVersion: source.diagnosis.version,
      sourceSnapshotId: source.snapshot.id,
      sourceSnapshotVersion: source.snapshot.version,
      templateContentFingerprint: "fp",
    })).rejects.toThrow(/LIVE Business cannot be registered/);
  });

  it("rejects invalid predecessor and template linkage on instances", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    const replacementBusiness = await businessService.create({
      name: `Bad generation ${randomUUID()}`,
      businessUsage: "SYNTHETIC_TEST",
    });
    await expect(service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: template.id,
      generation: 0,
      predecessorInstanceId: instance.id,
    })).rejects.toThrow(/first-generation instance has no predecessor/);
    await expect(service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: template.id,
      generation: 1,
    })).rejects.toThrow(/requires a predecessor/);
    await expect(service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: template.id,
      generation: 5,
      predecessorInstanceId: instance.id,
    })).rejects.toThrow(/exactly one greater/);

    const { template: otherTemplate } = await seedTemplate();
    await expect(service.registerInstance(admin(), {
      businessId: replacementBusiness.id,
      fixtureTemplateId: otherTemplate.id,
      generation: 1,
      predecessorInstanceId: instance.id,
    })).rejects.toThrow(/derive from the predecessor's template/);
  });

  // =========================================================================
  // R5 — retained metadata guards
  // =========================================================================

  it("freezes an approved template baseline, its approval and its retirement", async () => {
    const { template } = await seedTemplate();
    for (const mutation of [
      sql`update fixture_templates set source_snapshot_content_hash = 'tampered' where id = ${template.id}`,
      sql`update fixture_templates set template_content_fingerprint = 'tampered' where id = ${template.id}`,
      sql`update fixture_templates set source_business_id = ${randomUUID()} where id = ${template.id}`,
      sql`update fixture_templates set template_version = 42 where id = ${template.id}`,
      sql`update fixture_templates set source_approval_actor_id = 'someone-else' where id = ${template.id}`,
      sql`update fixture_templates set template_approved_by_actor_id = 'someone-else' where id = ${template.id}`,
    ]) {
      await expectDatabaseRefusal(database.execute(mutation), /immutable|cannot be changed/);
    }

    const retired = await service.retireTemplate(
      testFixtureAuthority("fixture_template_administrator", "erin"),
      { fixtureTemplateId: template.id },
    );
    expect(retired.status).toBe("RETIRED");
    expect(retired.retiredByActorId).toBe("erin");
    expect(retired.sourceSnapshotContentHash).toBe(template.sourceSnapshotContentHash);
    expect(retired.templateApprovedByActorId).toBe(template.templateApprovedByActorId);

    // Retirement attribution is frozen afterwards (R5).
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_templates set retired_by_actor_id = 'rewritten' where id = ${template.id}
    `), /retirement attribution cannot be changed/);
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_templates set status = 'ACTIVE' where id = ${template.id}
    `), /ACTIVE to RETIRED/);
    await expect(service.retireTemplate(admin(), { fixtureTemplateId: template.id }))
      .rejects.toThrow(/cannot be retired/);
  });

  it("freezes instance identity, verification and provenance, and refuses deletion", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    const verified = await verify(instance.id);

    for (const mutation of [
      sql`update fixture_instances set historical_business_id = ${randomUUID()} where id = ${instance.id}`,
      sql`update fixture_instances set fixture_template_id = ${randomUUID()} where id = ${instance.id}`,
      sql`update fixture_instances set generation = 7 where id = ${instance.id}`,
      sql`update fixture_instances set created_by_actor_id = 'rewritten' where id = ${instance.id}`,
    ]) {
      await expectDatabaseRefusal(database.execute(mutation), /identity and provenance are immutable/);
    }
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_instances set verification_fingerprint = 'tampered' where id = ${instance.id}
    `), /recorded clone verification cannot be changed/);
    await expectDatabaseRefusal(database.execute(sql`
      delete from fixture_instances where id = ${instance.id}
    `), /retained provenance and cannot be deleted/);
    expect(verified.verificationPassed).toBe(true);
  });

  it("refuses an unguarded detach, a reattach and a terminal resurrection", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);

    // Actor, time and reason alone are not a disposal: detaching without becoming DISPOSED
    // is refused (amendment §4).
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_instances set business_id = null, business_usage_binding = null
      where id = ${instance.id}
    `), /only be detached as part of a complete disposal/);

    const disposed = await seedDisposedOriginal();
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_instances set business_id = ${disposed.business.id},
        business_usage_binding = 'PILOT_FIXTURE_INSTANCE'
      where id = ${disposed.instance.id}
    `), /cannot be reattached/);
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_instances set status = 'ACTIVE' where id = ${disposed.instance.id}
    `), /terminal and cannot change status/);
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_instances set disposal_reason = 'rewritten' where id = ${disposed.instance.id}
    `), /disposal attribution cannot be changed/);
  });

  it("ties the disposal metadata transition to its authorised operation", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await verify(instance.id);
    const { instance: unrelated } = await seedInstance(template.id);

    const operationId = randomUUID();
    await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "context check",
    });

    // Not confirmed, not DISPOSING: refused.
    await expect(service.applyDisposalMetadata(admin(), {
      resetOperationId: operationId,
      fixtureInstanceId: instance.id,
      reason: "r",
    })).rejects.toThrow(/requires a DISPOSING operation/);

    await service.confirmResetExport(admin(), {
      resetOperationId: operationId,
      exportReference: "s3://x",
      exportChecksum: "sha256-x",
    });
    await service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "DISPOSING",
    });

    // Wrong target for this operation.
    await expect(service.applyDisposalMetadata(admin(), {
      resetOperationId: operationId,
      fixtureInstanceId: unrelated.id,
      reason: "r",
    })).rejects.toThrow(/does not match this reset operation's original instance/);

    const applied = await service.applyDisposalMetadata(admin(), {
      resetOperationId: operationId,
      fixtureInstanceId: instance.id,
      reason: "context check",
    });
    expect(applied.instance.businessId).toBeNull();
    expect(applied.instance.historicalBusinessId).toBe(instance.historicalBusinessId);
    expect(applied.operation.disposalCommittedAt).not.toBeNull();

    // Write-once checkpoint.
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_reset_operations set disposal_committed_at = now() where id = ${operationId}
    `), /disposal checkpoint cannot be changed/);
  });

  it("refuses deletion of retained run provenance", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    const recorded = await service.recordRunProvenance(admin(), {
      fixtureInstanceId: instance.id,
      entries: [{
        clonedAnalysisRunId: randomUUID(),
        sourceAnalysisRunId: randomUUID(),
        sourceAnalysisModule: "phase1_diagnosis",
        sourceInputHash: "source-input-hash-abc",
        sourceSnapshotContentHash: "source-snapshot-hash-def",
      }],
    });
    expect(recorded[0].sourceInputHash).toBe("source-input-hash-abc");
    await expectDatabaseRefusal(database.execute(sql`
      update fixture_instance_run_provenance set source_input_hash = 'tampered'
      where id = ${recorded[0].id}
    `), /immutable retained provenance/);
    await expectDatabaseRefusal(database.execute(sql`
      delete from fixture_instance_run_provenance where id = ${recorded[0].id}
    `), /immutable retained provenance/);
  });

  // =========================================================================
  // R4 — success requires a verified replacement
  // =========================================================================

  it("binds an unverified replacement and enters VERIFYING, then refuses premature success",
    async () => {
      const disposed = await seedDisposedOriginal();
      const replacementBusiness = await businessService.create({
        name: `Replacement ${randomUUID()}`,
        businessUsage: "SYNTHETIC_TEST",
      });
      const replacement = await service.registerInstance(admin(), {
        businessId: replacementBusiness.id,
        fixtureTemplateId: disposed.template.id,
        generation: 1,
        predecessorInstanceId: disposed.instance.id,
      });
      expect(replacement.verificationPassed).toBe(false);

      // Amendment §2: an UNVERIFIED replacement may be bound and reach VERIFYING.
      const recreating = await service.advanceResetState(admin(), {
        resetOperationId: disposed.operationId,
        toState: "RECREATING",
        replacementInstanceId: replacement.id,
      });
      expect(recreating.replacementInstanceId).toBe(replacement.id);
      await service.advanceResetState(admin(), {
        resetOperationId: disposed.operationId, toState: "VERIFYING",
      });

      // Success is refused while verification has not been recorded.
      await expect(service.advanceResetState(admin(), {
        resetOperationId: disposed.operationId, toState: "SUCCEEDED",
      })).rejects.toThrow(/requires a verified replacement/);

      const verifiedReplacement = await verify(replacement.id);
      // The omitted replacement id is still loaded and validated.
      const succeeded = await service.advanceResetState(admin(), {
        resetOperationId: disposed.operationId, toState: "SUCCEEDED",
      });
      expect(succeeded.state).toBe("SUCCEEDED");
      // Success evidence is the replacement's OWN recorded fingerprint.
      expect(succeeded.replacementVerificationFingerprint)
        .toBe(verifiedReplacement.verificationFingerprint);
      expect(succeeded.replacementBusinessId).toBe(replacement.historicalBusinessId);
      expect(succeeded.completedAt).not.toBeNull();

      // A SUCCEEDED operation is frozen entirely.
      await expectDatabaseRefusal(database.execute(sql`
        update fixture_reset_operations set completed_at = now() where id = ${disposed.operationId}
      `), /terminal and its evidence is frozen/);
    });

  it("refuses a mismatched, failed or detached replacement", async () => {
    const disposed = await seedDisposedOriginal();
    // Wrong predecessor.
    const strayBusiness = await businessService.create({
      name: `Stray ${randomUUID()}`, businessUsage: "SYNTHETIC_TEST",
    });
    const stray = await service.registerInstance(admin(), {
      businessId: strayBusiness.id,
      fixtureTemplateId: disposed.template.id,
    });
    await expect(service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId,
      toState: "RECREATING",
      replacementInstanceId: stray.id,
    })).rejects.toThrow(/must record the original instance as its predecessor/);

    await expect(service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId,
      toState: "RECREATING",
      replacementInstanceId: randomUUID(),
    })).rejects.toThrow(/Replacement instance does not exist/);

    // A FAILED_CREATION replacement cannot complete a reset.
    const failedBusiness = await businessService.create({
      name: `Failed replacement ${randomUUID()}`, businessUsage: "SYNTHETIC_TEST",
    });
    const failedReplacement = await service.registerInstance(admin(), {
      businessId: failedBusiness.id,
      fixtureTemplateId: disposed.template.id,
      generation: 1,
      predecessorInstanceId: disposed.instance.id,
    });
    await service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId,
      toState: "RECREATING",
      replacementInstanceId: failedReplacement.id,
    });
    await service.markInstanceFailedCreation(admin(), {
      fixtureInstanceId: failedReplacement.id,
      failureReason: "verification impossible",
    });
    // The bound replacement cannot be swapped for another, checked while the operation is
    // still RECREATING so the transition itself is legal and only the swap is refused.
    await expect(service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId,
      toState: "VERIFYING",
      replacementInstanceId: stray.id,
    })).rejects.toThrow(/cannot be replaced by a different one/);

    await service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId, toState: "VERIFYING",
    });
    await expect(service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId, toState: "SUCCEEDED",
    })).rejects.toThrow(/requires a verified replacement/);
  });

  it("refuses SUCCEEDED without durable disposal evidence", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await verify(instance.id);
    const operationId = randomUUID();
    await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "no disposal",
    });
    await service.confirmResetExport(admin(), {
      resetOperationId: operationId, exportReference: "s3://x", exportChecksum: "sha256-x",
    });
    await service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "DISPOSING",
    });
    // Disposal metadata never applied, so RECREATING is blocked by the progress CHECK.
    await expect(service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "RECREATING",
    })).rejects.toThrow();
  });

  // =========================================================================
  // R3 — same-operation recovery
  // =========================================================================

  it("retries under the same operation id before disposal", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await verify(instance.id);
    const operationId = randomUUID();
    await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "pre-disposal retry",
    });
    await service.confirmResetExport(admin(), {
      resetOperationId: operationId, exportReference: "s3://x", exportChecksum: "sha256-x",
    });
    const failed = await service.advanceResetState(admin(), {
      resetOperationId: operationId,
      toState: "FAILED",
      failureCode: "clone_setup_failed",
      failureDetail: "first attempt",
    });
    expect(failed.state).toBe("FAILED");

    // Same operation id resumes at DISPOSING, because disposal never committed.
    const resumed = await service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "DISPOSING",
    });
    expect(resumed.state).toBe("DISPOSING");
    expect(resumed.originalInstanceId).toBe(instance.id);
    expect(resumed.attemptCount).toBe(1);
    // Live failure fields cleared, history retained.
    expect(resumed.failureCode).toBeNull();
    const history = await service.listResetFailures(operationId);
    expect(history).toHaveLength(1);
    expect(history[0].failureCode).toBe("clone_setup_failed");
    expect(history[0].stateAtFailure).toBe("REQUESTED");
    expect(history[0].attemptNumber).toBe(0);

    // Post-disposal resume is refused while disposal has not committed.
    await service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "FAILED", failureCode: "second",
    });
    await expect(service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "RECREATING",
    })).rejects.toThrow(/may only resume at DISPOSING/);
    const twoFailures = await service.listResetFailures(operationId);
    expect(twoFailures).toHaveLength(2);
    expect(twoFailures.map((row) => row.attemptNumber).sort()).toEqual([0, 1]);
  });

  it("resumes at RECREATING only, after disposal has committed", async () => {
    const disposed = await seedDisposedOriginal();
    await service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId,
      toState: "FAILED",
      failureCode: "recreate_failed",
    });
    // Never re-dispose a graph that is already gone.
    await expect(service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId, toState: "DISPOSING",
    })).rejects.toThrow(/may only resume at RECREATING/);

    const resumed = await service.advanceResetState(admin(), {
      resetOperationId: disposed.operationId, toState: "RECREATING",
    });
    expect(resumed.state).toBe("RECREATING");
    expect(resumed.disposalCommittedAt).not.toBeNull();
    expect(resumed.originalInstanceId).toBe(disposed.instance.id);
  });

  it("refuses to act on contradictory disposal evidence", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await verify(instance.id);
    const operationId = randomUUID();
    await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "contradiction",
    });
    await service.confirmResetExport(admin(), {
      resetOperationId: operationId, exportReference: "s3://x", exportChecksum: "sha256-x",
    });
    await service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "DISPOSING",
    });
    // Checkpoint says disposed; the instance row says otherwise.
    await database.execute(sql`
      update fixture_reset_operations set disposal_committed_at = now() where id = ${operationId}
    `);
    await expect(service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "RECREATING",
    })).rejects.toThrow(/evidence is contradictory/);
  });

  it("recovers a crash-left REQUESTED operation under the same id", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await verify(instance.id);
    const operationId = randomUUID();
    // The durable request survives a crash; nothing else was written.
    const request = await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "crash recovery",
    });
    expect(request.state).toBe("REQUESTED");
    expect(request.attemptCount).toBe(0);

    // Replaying the same id returns the same row rather than creating a second.
    const replay = await service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "crash recovery",
    });
    expect(replay.id).toBe(request.id);
    await service.confirmResetExport(admin(), {
      resetOperationId: operationId, exportReference: "s3://x", exportChecksum: "sha256-x",
    });
    const resumed = await service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "DISPOSING",
    });
    expect(resumed.state).toBe("DISPOSING");
  });

  it("refuses a replay that changes any identity field", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await verify(instance.id);
    const { instance: other } = await seedInstance(template.id);
    const { template: otherTemplate } = await seedTemplate(1);
    const operationId = randomUUID();
    const base = {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "strict replay",
    };
    await service.createResetRequest(admin(), base);

    await expect(service.createResetRequest(admin(), { ...base, originalInstanceId: other.id }))
      .rejects.toThrow(/different original instance/);
    await expect(service.createResetRequest(admin(), { ...base, resetGeneration: 2 }))
      .rejects.toThrow(/different generation/);
    await expect(service.createResetRequest(admin(), {
      ...base, fixtureTemplateId: otherTemplate.id,
    })).rejects.toThrow(/different template/);
  });

  it("produces one consistent operation from two simultaneous first requests", async () => {
    const { template } = await seedTemplate();
    const { instance } = await seedInstance(template.id);
    await verify(instance.id);
    const operationId = randomUUID();
    const request = () => service.createResetRequest(admin(), {
      resetOperationId: operationId,
      originalInstanceId: instance.id,
      fixtureTemplateId: template.id,
      templateVersion: template.templateVersion,
      resetGeneration: 1,
      reason: "concurrent first request",
    });

    // Amendment §3: locking a nonexistent row prevents nothing, so both calls race to
    // INSERT. Both must succeed with one consistent row and no uniqueness error.
    const results = await Promise.allSettled([request(), request(), request()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(3);
    const ids = new Set(fulfilled.map((r) =>
      (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids).toEqual(new Set([operationId]));

    const [count] = await database.select({ value: sql<number>`count(*)::int` })
      .from(fixtureResetOperations).where(eq(fixtureResetOperations.id, operationId));
    expect(count.value).toBe(1);
    const stored = await service.getResetOperation(operationId);
    expect(stored!.originalInstanceId).toBe(instance.id);
    expect(stored!.attemptCount).toBe(0);
  });

  // =========================================================================
  // Template graph protection (focused verification item)
  // =========================================================================

  it("refuses ordinary strategic writes to a protected template Business", async () => {
    const { templateBusiness } = await seedTemplate();

    // Five distinct guarded write paths across three repositories.
    await expect(foundation.updateBusinessProfile({
      businessId: templateBusiness.id, profileData: { tampered: true },
    })).rejects.toThrow(ProtectedFixtureTemplateError);

    await expect(foundation.addClaim({
      businessId: templateBusiness.id,
      statement: "Injected claim",
      subjectArea: "market",
      claimType: "observation",
      confidenceLevel: "medium",
      confidenceBasis: { basis: "test" },
      sourceType: "business_intake",
    })).rejects.toThrow(ProtectedFixtureTemplateError);

    await expect(foundation.addEvidence({
      businessId: templateBusiness.id,
      evidenceType: "management_record",
      statement: "Injected evidence",
      sourceType: "business_intake",
      reliabilityLevel: "medium",
      directnessLevel: "direct",
      recencyLevel: "recent",
      materiality: "high",
    })).rejects.toThrow(ProtectedFixtureTemplateError);

    await expect(foundation.createSnapshot(templateBusiness.id))
      .rejects.toThrow(ProtectedFixtureTemplateError);

    await expect(foundation.assertBusinessActive(templateBusiness.id))
      .rejects.toThrow(ProtectedFixtureTemplateError);

    // Nothing was partially written by the refused attempts.
    const [claims] = await database.select({ value: sql<number>`count(*)::int` })
      .from(schema.claims).where(eq(schema.claims.businessId, templateBusiness.id));
    expect(claims.value).toBe(0);
    const [evidence] = await database.select({ value: sql<number>`count(*)::int` })
      .from(schema.evidence).where(eq(schema.evidence.businessId, templateBusiness.id));
    expect(evidence.value).toBe(0);
  });

  it("keeps ordinary writes available to fixture instances", async () => {
    const { template } = await seedTemplate();
    const { business } = await seedInstance(template.id);
    // Instances exist to receive work, so they are deliberately not blocked.
    await expect(foundation.assertBusinessActive(business.id)).resolves.toBeUndefined();
    const claim = await foundation.addClaim({
      businessId: business.id,
      statement: "Instance work is permitted",
      subjectArea: "market",
      claimType: "observation",
      confidenceLevel: "medium",
      confidenceBasis: { basis: "test" },
      sourceType: "business_intake",
    });
    expect(claim.businessId).toBe(business.id);
  });

  it("still permits administrative archive and restore of a template Business", async () => {
    const { templateBusiness } = await seedTemplate();
    // Archive/restore deliberately bypass the strategic-write guard: they are lifecycle
    // administration, not graph mutation.
    const archived = await businessService.archive(templateBusiness.id);
    expect(archived.status).toBe("archived");
    expect(archived.businessUsage).toBe("PILOT_FIXTURE_TEMPLATE");
    const restored = await businessService.restore(templateBusiness.id);
    expect(restored.status).toBe("active");
    expect(restored.businessUsage).toBe("PILOT_FIXTURE_TEMPLATE");
  });

  // =========================================================================
  // Eligibility, audit survival, guard and fail-closed engines
  // =========================================================================

  it("keeps unverified, failed and detached instances ineligible", async () => {
    const { template } = await seedTemplate();
    const { business, instance } = await seedInstance(template.id);
    expect(instance.verificationPassed).toBe(false);
    let eligibility = await service.evaluateEligibility(business.id);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain("clone_verification_not_passed");

    await verify(instance.id);
    eligibility = await service.evaluateEligibility(business.id);
    expect(eligibility.eligible).toBe(true);

    const { business: b2, instance: i2 } = await seedInstance(template.id);
    await expectDatabaseRefusal(
      database.execute(sql`
        update fixture_instances set verification_passed = true where id = ${i2.id}
      `),
      /fixture_instances_verification_check|recorded clone verification/,
    );
    expect((await service.evaluateEligibility(b2.id)).eligible).toBe(false);

    const { business: b3, instance: i3 } = await seedInstance(template.id);
    await service.markInstanceFailedCreation(admin(), {
      fixtureInstanceId: i3.id, failureReason: "clone aborted",
    });
    const failed = await service.evaluateEligibility(b3.id);
    expect(failed.eligible).toBe(false);
    expect(failed.reasons).toContain("fixture_instance_not_active");

    const plain = await businessService.create({ name: `Plain ${randomUUID()}` });
    const plainEligibility = await service.evaluateEligibility(plain.id);
    expect(plainEligibility.reasons).toContain("business_usage_not_pilot_fixture_instance");
    expect(plainEligibility.reasons).toContain("fixture_instance_metadata_missing");
  });

  it("keeps audit and retained identity after the fixture Business is deleted", async () => {
    const { template } = await seedTemplate();
    const { business, instance } = await seedInstance(template.id);
    await verify(instance.id);
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
    });
    await service.confirmResetExport(admin(), {
      resetOperationId: operationId, exportReference: "s3://x", exportChecksum: "sha256-x",
    });
    await service.advanceResetState(admin(), {
      resetOperationId: operationId, toState: "DISPOSING",
    });

    // While attached, the Business is protected from deletion by the restrict FK.
    await businessService.archive(business.id);
    const confirmation = await businessService.getPermanentDeleteConfirmation(business.id);
    await expect(businessService.permanentlyDelete({
      businessId: business.id, confirmation: confirmation.phrase,
    })).rejects.toThrow();

    // The guarded metadata transition detaches it. Step D would wrap this around the real
    // deletion; here the deletion is performed separately, so this is a schema simulation.
    await service.applyDisposalMetadata(admin(), {
      resetOperationId: operationId,
      fixtureInstanceId: instance.id,
      reason: "disposal persistence check",
    });
    const deleted = await businessService.permanentlyDelete({
      businessId: business.id, confirmation: confirmation.phrase,
    });
    expect(deleted.businessId).toBe(business.id);

    const survivingInstance = await service.getInstance(instance.id);
    expect(survivingInstance!.businessId).toBeNull();
    expect(survivingInstance!.historicalBusinessId).toBe(business.id);
    expect(survivingInstance!.status).toBe("DISPOSED");
    // Verification evidence survived too, so the disposal is interpretable.
    expect(survivingInstance!.verificationPassed).toBe(true);

    const provenance = await service.listRunProvenance(instance.id);
    expect(provenance).toHaveLength(1);
    expect(provenance[0].sourceInputHash).toBe("retained-source-hash");

    const audit = await service.listResetOperationsForBusiness(business.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].id).toBe(operationId);
    await expectDatabaseRefusal(database.execute(sql`
      delete from fixture_reset_operations where id = ${operationId}
    `), /retained audit trail/);
  });

  it("protects a template Business from deletion while its template exists", async () => {
    const { templateBusiness } = await seedTemplate();
    await businessService.archive(templateBusiness.id);
    const confirmation = await businessService.getPermanentDeleteConfirmation(templateBusiness.id);
    await expect(businessService.permanentlyDelete({
      businessId: templateBusiness.id, confirmation: confirmation.phrase,
    })).rejects.toThrow();
  });

  it("rejects a non-test target before any mutation", async () => {
    expect(() => requirePostgresTestDatabaseUrl(
      "postgresql://baslon:secret@localhost:5432/baslon_os",
    )).toThrow(/baslon_os_test/);
    expect(() => requirePostgresTestDatabaseUrl("")).toThrow(/TEST_DATABASE_URL/);
    expect(() => requirePostgresTestDatabaseUrl("not-a-url")).toThrow(/valid TEST_DATABASE_URL/);
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

    const [provenanceRows] = await database.select({ value: sql<number>`count(*)::int` })
      .from(fixtureInstanceRunProvenance);
    expect(provenanceRows.value).toBeGreaterThan(0);
  });
});
