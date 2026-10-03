import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  approvedDiagnoses,
  businesses,
  businessStateSnapshots,
  fixtureInstanceRunProvenance,
  fixtureInstances,
  fixtureResetOperationFailures,
  fixtureResetOperations,
  fixtureTemplates,
} from "@/db/schema";
import {
  assertFixtureAdminCapability,
  assertHumanFixtureActor,
  executingActor,
  type FixtureAdminAuthority,
} from "@/domain/fixture-authority";
import { stableSha256 } from "@/domain/phase1-diagnosis-projection";
import {
  advanceResetStateSchema,
  approveFixtureTemplateSchema,
  confirmResetExportSchema,
  createResetRequestSchema,
  evaluateFixtureInstanceEligibility,
  isLegalInstanceStatusTransition,
  isLegalResetStateTransition,
  isLegalTemplateStatusTransition,
  legalResetRecoveryTargets,
  markInstanceFailedCreationSchema,
  PilotFixtureRuleError,
  recordInstanceVerificationSchema,
  recordRunProvenanceSchema,
  registerFixtureInstanceSchema,
  registerFixtureTemplateSchema,
  resetStateAcceptsReplacementBinding,
  retireFixtureTemplateSchema,
  type AdvanceResetStateInput,
  type ApproveFixtureTemplateInput,
  type ConfirmResetExportInput,
  type CreateResetRequestInput,
  type FixtureEligibility,
  type MarkInstanceFailedCreationInput,
  type RecordInstanceVerificationInput,
  type RecordRunProvenanceInput,
  type RegisterFixtureInstanceInput,
  type RegisterFixtureTemplateInput,
  type RetireFixtureTemplateInput,
} from "@/domain/pilot-fixture";

/**
 * Persistence for the pilot fixture foundation.
 *
 * Every mutating method is a *registration primitive*: it records provenance that some
 * other component produced. None copies a Phase 1 graph, verifies a clone, or deletes
 * anything — those are Steps B and D.
 *
 * Review findings applied:
 *
 *  - R2  every mutator takes the verified authority and derives the executing actor from
 *        it, so an audit label can never name someone else. Historical source approval is
 *        read from the stored Diagnosis; template-version approval is its own action.
 *  - R3  a FAILED operation resumes under the same id, routed by a durable checkpoint that
 *        is reconciled against the actual instance rows under lock.
 *  - R4  success requires a real, verified, attached replacement whose own recorded
 *        fingerprint becomes the operation's success evidence.
 *  - R6  the source Diagnosis must be bound to the source Snapshot, the Snapshot hash is
 *        derived rather than trusted, and replay compares every identity field.
 *
 * Lock ordering is **operation row first, then instance rows**, uniformly, so a concurrent
 * request and advance on the same pair cannot deadlock.
 */
export class PilotFixtureRepository {
  constructor(private readonly database: Database) {}

  /**
   * Opens the transaction-local window in which `businesses.business_usage` may be set to
   * or cleared from a protected fixture value.
   *
   * This is **application discipline, not security**: any connection able to run arbitrary
   * SQL can set the same variable. It stops ordinary application paths and accidents, and
   * it is scoped to one transaction and one specific Business so a mistake cannot reach a
   * second row.
   */
  private async allowProtectedUsageChange(
    tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
    businessId: string,
  ): Promise<void> {
    await tx.execute(sql`select set_config('baslon.fixture_usage_change', ${businessId}, true)`);
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  /**
   * Register a template over an existing template Business.
   *
   * Records provenance and creation only. It does not construct the copy (Step B) and it
   * does **not** approve the template: approval is a separate explicit action, because a
   * template is not approved merely because its source Diagnosis was.
   */
  async registerTemplate(authority: FixtureAdminAuthority, input: RegisterFixtureTemplateInput) {
    assertFixtureAdminCapability(authority, "template_admin");
    const actor = executingActor(authority);
    const parsed = registerFixtureTemplateSchema.parse(input);
    if (parsed.templateBusinessId === parsed.sourceBusinessId) {
      throw new PilotFixtureRuleError(
        "A template Business must be distinct from its source Business",
      );
    }

    return this.database.transaction(async (tx) => {
      const [templateBusiness] = await tx.select({
        id: businesses.id,
        usage: businesses.businessUsage,
      }).from(businesses).where(eq(businesses.id, parsed.templateBusinessId)).for("update");
      if (!templateBusiness) throw new PilotFixtureRuleError("Template Business does not exist");

      const [sourceBusiness] = await tx.select({
        id: businesses.id,
        usage: businesses.businessUsage,
      }).from(businesses).where(eq(businesses.id, parsed.sourceBusinessId)).for("update");
      if (!sourceBusiness) throw new PilotFixtureRuleError("Source Business does not exist");

      // The source is never reclassified or converted (§5.2).
      if (sourceBusiness.usage === "PILOT_FIXTURE_TEMPLATE"
        || sourceBusiness.usage === "PILOT_FIXTURE_INSTANCE") {
        throw new PilotFixtureRuleError(
          "A fixture template or instance cannot itself be a template source",
        );
      }
      if (templateBusiness.usage === "LIVE") {
        throw new PilotFixtureRuleError(
          "A LIVE Business cannot be registered as a pilot fixture template",
        );
      }
      if (templateBusiness.usage === "PILOT_FIXTURE_INSTANCE") {
        throw new PilotFixtureRuleError(
          "A pilot fixture instance cannot be registered as a template",
        );
      }

      // Historical source approval is READ, never supplied (R2, amendment §1).
      const [diagnosis] = await tx.select({
        id: approvedDiagnoses.id,
        version: approvedDiagnoses.version,
        snapshotId: approvedDiagnoses.snapshotId,
        snapshotVersion: approvedDiagnoses.snapshotVersion,
        approvedBy: approvedDiagnoses.approvedBy,
        approvedAt: approvedDiagnoses.approvedAt,
      }).from(approvedDiagnoses).where(and(
        eq(approvedDiagnoses.id, parsed.sourceApprovedDiagnosisId),
        eq(approvedDiagnoses.businessId, parsed.sourceBusinessId),
      ));
      if (!diagnosis) {
        throw new PilotFixtureRuleError(
          "Source approved Diagnosis does not belong to the source Business",
        );
      }
      if (diagnosis.version !== parsed.sourceApprovedDiagnosisVersion) {
        throw new PilotFixtureRuleError("Source approved Diagnosis version does not match");
      }

      const [snapshot] = await tx.select({
        id: businessStateSnapshots.id,
        version: businessStateSnapshots.version,
        snapshotData: businessStateSnapshots.snapshotData,
      }).from(businessStateSnapshots).where(and(
        eq(businessStateSnapshots.id, parsed.sourceSnapshotId),
        eq(businessStateSnapshots.businessId, parsed.sourceBusinessId),
      ));
      if (!snapshot) {
        throw new PilotFixtureRuleError("Source Snapshot does not belong to the source Business");
      }
      if (snapshot.version !== parsed.sourceSnapshotVersion) {
        throw new PilotFixtureRuleError("Source Snapshot version does not match");
      }

      // R6: the Diagnosis must be bound to THIS Snapshot, not merely to one of the source
      // Business's Snapshots. Without this a template could claim a baseline the approved
      // Diagnosis never saw.
      if (diagnosis.snapshotId !== parsed.sourceSnapshotId) {
        throw new PilotFixtureRuleError(
          "Source approved Diagnosis is not bound to the supplied Snapshot",
        );
      }
      if (diagnosis.snapshotVersion !== parsed.sourceSnapshotVersion) {
        throw new PilotFixtureRuleError(
          "Source approved Diagnosis is not bound to the supplied Snapshot version",
        );
      }

      // R6: derived under the approved hashing contract, never accepted as free text. A
      // supplied value is only a cross-check.
      const derivedHash = stableSha256(snapshot.snapshotData);
      if (parsed.expectedSourceSnapshotContentHash
        && parsed.expectedSourceSnapshotContentHash !== derivedHash) {
        throw new PilotFixtureRuleError(
          "Supplied source Snapshot content hash does not match the stored Snapshot",
        );
      }

      await this.allowProtectedUsageChange(tx, parsed.templateBusinessId);
      await tx.update(businesses)
        .set({ businessUsage: "PILOT_FIXTURE_TEMPLATE", updatedAt: new Date() })
        .where(eq(businesses.id, parsed.templateBusinessId));

      const [template] = await tx.insert(fixtureTemplates).values({
        templateVersion: parsed.templateVersion,
        templateBusinessId: parsed.templateBusinessId,
        sourceBusinessId: parsed.sourceBusinessId,
        sourceApprovedDiagnosisId: parsed.sourceApprovedDiagnosisId,
        sourceApprovedDiagnosisVersion: parsed.sourceApprovedDiagnosisVersion,
        sourceSnapshotId: parsed.sourceSnapshotId,
        sourceSnapshotVersion: parsed.sourceSnapshotVersion,
        sourceSnapshotContentHash: derivedHash,
        templateContentFingerprint: parsed.templateContentFingerprint,
        // creation execution, from authority
        createdByActorType: actor.actorType,
        createdByActorId: actor.actorId,
        // historical source approval, read from the stored Diagnosis
        sourceApprovalActorId: diagnosis.approvedBy,
        sourceApprovedAt: diagnosis.approvedAt,
      }).returning();
      return template;
    });
  }

  /**
   * Approve a registered template version — a distinct action from creating it.
   *
   * The same authorised human may have done both; the records state which action they
   * performed. Approval binds to the recorded content fingerprint, so it cannot be granted
   * to a template whose content the approver did not see.
   */
  async approveTemplate(authority: FixtureAdminAuthority, input: ApproveFixtureTemplateInput) {
    assertFixtureAdminCapability(authority, "template_admin");
    // §9.5-style reasoning: approving a protected baseline is a material human decision.
    assertHumanFixtureActor(authority, "Template version approval");
    const actor = executingActor(authority);
    const parsed = approveFixtureTemplateSchema.parse(input);

    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureTemplates)
        .where(eq(fixtureTemplates.id, parsed.fixtureTemplateId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Fixture template does not exist");
      if (existing.status !== "ACTIVE") {
        throw new PilotFixtureRuleError(`A ${existing.status} template cannot be approved`);
      }
      if (existing.templateApprovedAt !== null) {
        throw new PilotFixtureRuleError("Template version has already been approved");
      }
      if (existing.templateContentFingerprint !== parsed.templateContentFingerprint) {
        throw new PilotFixtureRuleError(
          "Approval fingerprint does not match the registered template content",
        );
      }
      const [updated] = await tx.update(fixtureTemplates).set({
        templateApprovedByActorType: actor.actorType,
        templateApprovedByActorId: actor.actorId,
        templateApprovedAt: new Date(),
      }).where(and(
        eq(fixtureTemplates.id, parsed.fixtureTemplateId),
        isNull(fixtureTemplates.templateApprovedAt),
      )).returning();
      if (!updated) throw new PilotFixtureRuleError("Template approval lost a concurrent race");
      return updated;
    });
  }

  /**
   * Retire a template. The only supported template lifecycle change: an approved baseline
   * is never edited, it is superseded by a new version.
   */
  async retireTemplate(authority: FixtureAdminAuthority, input: RetireFixtureTemplateInput) {
    assertFixtureAdminCapability(authority, "template_admin");
    const actor = executingActor(authority);
    const parsed = retireFixtureTemplateSchema.parse(input);

    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureTemplates)
        .where(eq(fixtureTemplates.id, parsed.fixtureTemplateId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Fixture template does not exist");
      if (!isLegalTemplateStatusTransition(existing.status, "RETIRED")) {
        throw new PilotFixtureRuleError(`A ${existing.status} template cannot be retired`);
      }
      const [updated] = await tx.update(fixtureTemplates).set({
        status: "RETIRED",
        retiredAt: new Date(),
        retiredByActorType: actor.actorType,
        retiredByActorId: actor.actorId,
      }).where(and(
        eq(fixtureTemplates.id, parsed.fixtureTemplateId),
        eq(fixtureTemplates.status, "ACTIVE"),
      )).returning();
      if (!updated) throw new PilotFixtureRuleError("Template retirement lost a concurrent race");
      return updated;
    });
  }

  getTemplate(fixtureTemplateId: string) {
    return this.database.select().from(fixtureTemplates)
      .where(eq(fixtureTemplates.id, fixtureTemplateId)).then((rows) => rows[0] ?? null);
  }

  listTemplates() {
    return this.database.select().from(fixtureTemplates);
  }

  // -------------------------------------------------------------------------
  // Instances
  // -------------------------------------------------------------------------

  /**
   * Register instance metadata over an existing Business.
   *
   * The instance is created unverified and stays ineligible until a real clone
   * verification records a fingerprint. Step A has no verifier.
   */
  async registerInstance(authority: FixtureAdminAuthority, input: RegisterFixtureInstanceInput) {
    assertFixtureAdminCapability(authority, "instance_admin");
    const actor = executingActor(authority);
    const parsed = registerFixtureInstanceSchema.parse(input);

    return this.database.transaction(async (tx) => {
      const [business] = await tx.select({
        id: businesses.id,
        usage: businesses.businessUsage,
      }).from(businesses).where(eq(businesses.id, parsed.businessId)).for("update");
      if (!business) throw new PilotFixtureRuleError("Instance Business does not exist");
      if (business.usage === "LIVE") {
        throw new PilotFixtureRuleError(
          "A LIVE Business cannot be registered as a pilot fixture instance",
        );
      }
      if (business.usage === "PILOT_FIXTURE_TEMPLATE") {
        throw new PilotFixtureRuleError(
          "A pilot fixture template cannot be registered as an instance",
        );
      }

      const [template] = await tx.select().from(fixtureTemplates)
        .where(eq(fixtureTemplates.id, parsed.fixtureTemplateId)).for("update");
      if (!template) throw new PilotFixtureRuleError("Fixture template does not exist");
      if (template.status !== "ACTIVE") {
        throw new PilotFixtureRuleError("A RETIRED template cannot create new instances");
      }
      // An unapproved template is not a pilot baseline (amendment §1).
      if (template.templateApprovedAt === null) {
        throw new PilotFixtureRuleError(
          "An unapproved template version cannot create fixture instances",
        );
      }
      if (template.templateBusinessId === parsed.businessId) {
        throw new PilotFixtureRuleError(
          "A template Business cannot also be its own fixture instance",
        );
      }

      const generation = parsed.generation ?? 0;
      const predecessorId = parsed.predecessorInstanceId ?? null;
      if (generation === 0 && predecessorId !== null) {
        throw new PilotFixtureRuleError("A first-generation instance has no predecessor");
      }
      if (generation > 0 && predecessorId === null) {
        throw new PilotFixtureRuleError("A reset-created instance requires a predecessor");
      }
      if (predecessorId !== null) {
        const [predecessor] = await tx.select().from(fixtureInstances)
          .where(eq(fixtureInstances.id, predecessorId)).for("update");
        if (!predecessor) throw new PilotFixtureRuleError("Predecessor instance does not exist");
        if (predecessor.fixtureTemplateId !== parsed.fixtureTemplateId) {
          throw new PilotFixtureRuleError(
            "A replacement instance must derive from the predecessor's template",
          );
        }
        if (predecessor.generation + 1 !== generation) {
          throw new PilotFixtureRuleError(
            "Instance generation must be exactly one greater than its predecessor",
          );
        }
      }

      await this.allowProtectedUsageChange(tx, parsed.businessId);
      await tx.update(businesses)
        .set({ businessUsage: "PILOT_FIXTURE_INSTANCE", updatedAt: new Date() })
        .where(eq(businesses.id, parsed.businessId));

      const [instance] = await tx.insert(fixtureInstances).values({
        businessId: parsed.businessId,
        businessUsageBinding: "PILOT_FIXTURE_INSTANCE",
        historicalBusinessId: parsed.businessId,
        fixtureTemplateId: parsed.fixtureTemplateId,
        templateVersion: template.templateVersion,
        createdByActorType: actor.actorType,
        createdByActorId: actor.actorId,
        generation,
        predecessorInstanceId: predecessorId,
      }).returning();
      return instance;
    });
  }

  /**
   * Record a passed clone verification. Step B owns the comparison; this persists its
   * outcome and refuses to mark a non-ACTIVE instance verified.
   */
  async recordInstanceVerification(
    authority: FixtureAdminAuthority,
    input: RecordInstanceVerificationInput,
  ) {
    assertFixtureAdminCapability(authority, "instance_admin");
    const actor = executingActor(authority);
    const parsed = recordInstanceVerificationSchema.parse(input);

    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureInstances)
        .where(eq(fixtureInstances.id, parsed.fixtureInstanceId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Fixture instance does not exist");
      if (existing.status !== "ACTIVE") {
        throw new PilotFixtureRuleError(
          `A ${existing.status} instance cannot record a verification result`,
        );
      }
      if (existing.businessId === null) {
        throw new PilotFixtureRuleError(
          "A detached instance cannot record a verification result",
        );
      }
      if (existing.verificationPassed) {
        throw new PilotFixtureRuleError("Instance verification has already been recorded");
      }
      const [updated] = await tx.update(fixtureInstances).set({
        verificationPassed: true,
        verificationFingerprint: parsed.verificationFingerprint,
        verifiedByActorType: actor.actorType,
        verifiedByActorId: actor.actorId,
        verifiedAt: new Date(),
      }).where(and(
        eq(fixtureInstances.id, parsed.fixtureInstanceId),
        eq(fixtureInstances.verificationPassed, false),
      )).returning();
      if (!updated) throw new PilotFixtureRuleError("Verification lost a concurrent race");
      return updated;
    });
  }

  /** Mark an instance as never having been usable. Terminal, and never eligible. */
  async markInstanceFailedCreation(
    authority: FixtureAdminAuthority,
    input: MarkInstanceFailedCreationInput,
  ) {
    assertFixtureAdminCapability(authority, "instance_admin");
    const actor = executingActor(authority);
    const parsed = markInstanceFailedCreationSchema.parse(input);

    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureInstances)
        .where(eq(fixtureInstances.id, parsed.fixtureInstanceId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Fixture instance does not exist");
      if (!isLegalInstanceStatusTransition(existing.status, "FAILED_CREATION")) {
        throw new PilotFixtureRuleError(
          `A ${existing.status} instance cannot become FAILED_CREATION`,
        );
      }
      const [updated] = await tx.update(fixtureInstances).set({
        status: "FAILED_CREATION",
        failureReason: parsed.failureReason,
        // R2: attribution is now persisted rather than parsed and discarded.
        failureRecordedByActorType: actor.actorType,
        failureRecordedByActorId: actor.actorId,
        failureRecordedAt: new Date(),
      }).where(and(
        eq(fixtureInstances.id, parsed.fixtureInstanceId),
        eq(fixtureInstances.status, "ACTIVE"),
      )).returning();
      if (!updated) throw new PilotFixtureRuleError("Failure marking lost a concurrent race");
      return updated;
    });
  }

  /**
   * Record the per-run provenance of a cloned graph.
   *
   * The hashes stored are the SOURCE run's originals. Step B recomputes the clone's own
   * hashes on the cloned rows and must not write them here, or a copy would look like a
   * fresh AI execution.
   */
  async recordRunProvenance(
    authority: FixtureAdminAuthority,
    input: RecordRunProvenanceInput,
  ) {
    assertFixtureAdminCapability(authority, "instance_admin");
    const parsed = recordRunProvenanceSchema.parse(input);

    return this.database.transaction(async (tx) => {
      const [instance] = await tx.select().from(fixtureInstances)
        .where(eq(fixtureInstances.id, parsed.fixtureInstanceId)).for("update");
      if (!instance) throw new PilotFixtureRuleError("Fixture instance does not exist");
      if (instance.status !== "ACTIVE") {
        throw new PilotFixtureRuleError(
          `A ${instance.status} instance cannot accept new run provenance`,
        );
      }
      const clonedIds = new Set(parsed.entries.map((entry) => entry.clonedAnalysisRunId));
      if (clonedIds.size !== parsed.entries.length) {
        throw new PilotFixtureRuleError("Cloned run identities must be unique within a batch");
      }
      const sourceIds = new Set(parsed.entries.map((entry) => entry.sourceAnalysisRunId));
      if (sourceIds.size !== parsed.entries.length) {
        throw new PilotFixtureRuleError("Source run identities must be unique within a batch");
      }
      for (const entry of parsed.entries) {
        if (entry.clonedAnalysisRunId === entry.sourceAnalysisRunId) {
          throw new PilotFixtureRuleError(
            "A cloned run identity must differ from its source run identity",
          );
        }
      }
      return tx.insert(fixtureInstanceRunProvenance).values(parsed.entries.map((entry) => ({
        fixtureInstanceId: parsed.fixtureInstanceId,
        clonedAnalysisRunId: entry.clonedAnalysisRunId,
        sourceAnalysisRunId: entry.sourceAnalysisRunId,
        sourceAnalysisModule: entry.sourceAnalysisModule,
        sourceInputHash: entry.sourceInputHash,
        sourceSnapshotContentHash: entry.sourceSnapshotContentHash ?? null,
      }))).returning();
    });
  }

  getInstance(fixtureInstanceId: string) {
    return this.database.select().from(fixtureInstances)
      .where(eq(fixtureInstances.id, fixtureInstanceId)).then((rows) => rows[0] ?? null);
  }

  getInstanceByBusiness(businessId: string) {
    return this.database.select().from(fixtureInstances)
      .where(eq(fixtureInstances.businessId, businessId)).then((rows) => rows[0] ?? null);
  }

  listRunProvenance(fixtureInstanceId: string) {
    return this.database.select().from(fixtureInstanceRunProvenance)
      .where(eq(fixtureInstanceRunProvenance.fixtureInstanceId, fixtureInstanceId));
  }

  /**
   * The classification/metadata half of the Phase 2 entry precondition.
   *
   * Step C adds the workflow, approved-Diagnosis and Snapshot-binding checks. A true result
   * here is necessary but not sufficient, and callers must not treat it as the gate.
   */
  async evaluateEligibility(businessId: string): Promise<FixtureEligibility> {
    const [business] = await this.database.select({
      usage: businesses.businessUsage,
      status: businesses.status,
    }).from(businesses).where(eq(businesses.id, businessId));
    if (!business) return { eligible: false, reasons: ["business_not_found"] };

    const instance = await this.getInstanceByBusiness(businessId);
    const template = instance ? await this.getTemplate(instance.fixtureTemplateId) : null;

    return evaluateFixtureInstanceEligibility({
      businessUsage: business.usage,
      businessStatus: business.status,
      instance: instance
        ? {
          status: instance.status,
          verificationPassed: instance.verificationPassed,
          businessId: instance.businessId,
        }
        : null,
      template: template
        ? { status: template.status, templateVersion: template.templateVersion }
        : null,
      instanceTemplateVersion: instance ? instance.templateVersion : null,
    });
  }

  // -------------------------------------------------------------------------
  // Reset operation metadata
  // -------------------------------------------------------------------------

  /**
   * Create, or return, the durable reset request.
   *
   * Committed before any destructive work so a crash leaves an interpretable row. The
   * operation id is the idempotency key.
   *
   * Concurrency (R3/amendment §3): two simultaneous *first* requests with the same id would
   * both find no row to lock, so the insert uses `ON CONFLICT DO NOTHING`. The loser gets no
   * row back and falls through to the same strict identity comparison as a replay, which
   * means neither a bare uniqueness error nor a silent rebinding is possible.
   */
  async createResetRequest(authority: FixtureAdminAuthority, input: CreateResetRequestInput) {
    assertFixtureAdminCapability(authority, "reset_admin");
    const actor = executingActor(authority);
    const parsed = createResetRequestSchema.parse(input);

    return this.database.transaction(async (tx) => {
      // Unlocked pre-read solely to supply the retained Business identity, which is frozen
      // for the row's lifetime. Validation below re-reads it under lock.
      const [preview] = await tx.select({
        historicalBusinessId: fixtureInstances.historicalBusinessId,
      }).from(fixtureInstances).where(eq(fixtureInstances.id, parsed.originalInstanceId));
      if (!preview) throw new PilotFixtureRuleError("Original fixture instance does not exist");

      await tx.insert(fixtureResetOperations).values({
        id: parsed.resetOperationId,
        originalInstanceId: parsed.originalInstanceId,
        originalBusinessId: preview.historicalBusinessId,
        fixtureTemplateId: parsed.fixtureTemplateId,
        templateVersion: parsed.templateVersion,
        resetGeneration: parsed.resetGeneration,
        requestedByActorType: actor.actorType,
        requestedByActorId: actor.actorId,
        reason: parsed.reason,
      }).onConflictDoNothing();

      // Lock ordering: operation first, then instance.
      const [operation] = await tx.select().from(fixtureResetOperations)
        .where(eq(fixtureResetOperations.id, parsed.resetOperationId)).for("update");
      if (!operation) throw new PilotFixtureRuleError("Reset operation could not be recorded");

      const [instance] = await tx.select().from(fixtureInstances)
        .where(eq(fixtureInstances.id, parsed.originalInstanceId)).for("update");
      if (!instance) throw new PilotFixtureRuleError("Original fixture instance does not exist");

      // R6: every identity field is compared, so a repeat cannot quietly change any of
      // them. This runs for a replay and for the loser of a concurrent first insert alike.
      if (operation.originalInstanceId !== parsed.originalInstanceId) {
        throw new PilotFixtureRuleError(
          "A reset operation cannot be rebound to a different original instance",
        );
      }
      if (operation.resetGeneration !== parsed.resetGeneration) {
        throw new PilotFixtureRuleError(
          "A reset operation cannot be rebound to a different generation",
        );
      }
      if (operation.fixtureTemplateId !== parsed.fixtureTemplateId) {
        throw new PilotFixtureRuleError(
          "A reset operation cannot be rebound to a different template",
        );
      }
      if (operation.templateVersion !== parsed.templateVersion) {
        throw new PilotFixtureRuleError(
          "A reset operation cannot be rebound to a different template version",
        );
      }
      if (operation.originalBusinessId !== instance.historicalBusinessId) {
        throw new PilotFixtureRuleError(
          "Reset operation target Business does not match the instance's retained identity",
        );
      }

      // Target agreement against the instance itself, checked on first creation and on
      // replay, so a stale request cannot be accepted later.
      if (instance.fixtureTemplateId !== parsed.fixtureTemplateId) {
        throw new PilotFixtureRuleError("Reset template does not match the instance's template");
      }
      if (instance.templateVersion !== parsed.templateVersion) {
        throw new PilotFixtureRuleError(
          "Reset template version does not match the instance's template version",
        );
      }
      if (parsed.resetGeneration !== instance.generation + 1) {
        throw new PilotFixtureRuleError(
          "Reset generation must be exactly one greater than the instance generation",
        );
      }

      // A brand-new operation additionally requires a live target. A replay must not be
      // refused merely because disposal has since progressed.
      const isNewRequest = operation.state === "REQUESTED"
        && operation.attemptCount === 0
        && operation.disposalCommittedAt === null;
      if (isNewRequest && instance.status !== "ACTIVE" && instance.businessId === null) {
        throw new PilotFixtureRuleError(
          "A detached instance cannot be the target of a new reset",
        );
      }
      if (isNewRequest && instance.status === "FAILED_CREATION") {
        throw new PilotFixtureRuleError(
          "A FAILED_CREATION instance cannot be the target of a new reset",
        );
      }

      return operation;
    });
  }

  /**
   * Record the reviewed export and the explicit disposal confirmation (§9.5).
   *
   * The confirming actor is derived from the authority and must be human: a system actor
   * may orchestrate, but cannot invent a human confirmation (R2).
   */
  async confirmResetExport(authority: FixtureAdminAuthority, input: ConfirmResetExportInput) {
    assertFixtureAdminCapability(authority, "reset_admin");
    assertHumanFixtureActor(authority, "Reviewed-export disposal confirmation");
    const actor = executingActor(authority);
    const parsed = confirmResetExportSchema.parse(input);

    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureResetOperations)
        .where(eq(fixtureResetOperations.id, parsed.resetOperationId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Reset operation does not exist");
      if (existing.state !== "REQUESTED" && existing.state !== "FAILED") {
        throw new PilotFixtureRuleError(
          `Export confirmation requires a REQUESTED or FAILED operation, found ${existing.state}`,
        );
      }
      if (existing.exportReference !== null) {
        throw new PilotFixtureRuleError("Reset export has already been confirmed");
      }
      const now = new Date();
      const [updated] = await tx.update(fixtureResetOperations).set({
        exportReference: parsed.exportReference,
        exportChecksum: parsed.exportChecksum,
        exportVerifiedAt: now,
        disposalConfirmedByActorType: actor.actorType,
        disposalConfirmedByActorId: actor.actorId,
        disposalConfirmedAt: now,
      }).where(and(
        eq(fixtureResetOperations.id, parsed.resetOperationId),
        isNull(fixtureResetOperations.exportReference),
      )).returning();
      if (!updated) throw new PilotFixtureRuleError("Export confirmation lost a concurrent race");
      return updated;
    });
  }

  /**
   * Advance the reset state machine through a guarded transition.
   *
   * Step A persists the states; Step D drives them around real disposal. Recovery from
   * FAILED runs under the same operation id and is routed by the durable checkpoint
   * reconciled against the actual instance rows (R3).
   */
  async advanceResetState(authority: FixtureAdminAuthority, input: AdvanceResetStateInput) {
    assertFixtureAdminCapability(authority, "reset_admin");
    const actor = executingActor(authority);
    const parsed = advanceResetStateSchema.parse(input);

    return this.database.transaction(async (tx) => {
      // Lock ordering: operation first, then instances.
      const [existing] = await tx.select().from(fixtureResetOperations)
        .where(eq(fixtureResetOperations.id, parsed.resetOperationId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Reset operation does not exist");
      if (!isLegalResetStateTransition(existing.state, parsed.toState)) {
        throw new PilotFixtureRuleError(
          `Reset state cannot move from ${existing.state} to ${parsed.toState}`,
        );
      }

      const [original] = await tx.select().from(fixtureInstances)
        .where(eq(fixtureInstances.id, existing.originalInstanceId)).for("update");
      if (!original) {
        throw new PilotFixtureRuleError(
          "Original instance record is missing; reset state cannot be reconciled",
        );
      }

      // --- checkpoint reconciliation (R3/amendment §3) -----------------------
      // Neither the checkpoint nor the row state is proof on its own, so they must agree.
      const checkpointSaysDisposed = existing.disposalCommittedAt !== null;
      const rowsSayDisposed = original.businessId === null && original.status === "DISPOSED";
      if (checkpointSaysDisposed !== rowsSayDisposed) {
        throw new PilotFixtureRuleError(
          "Reset evidence is contradictory: the disposal checkpoint and the original "
            + "instance state disagree, so recovery cannot proceed",
        );
      }

      if (existing.state === "FAILED") {
        const legal = legalResetRecoveryTargets(checkpointSaysDisposed);
        if (!legal.includes(parsed.toState)) {
          throw new PilotFixtureRuleError(
            `A FAILED reset with disposal ${checkpointSaysDisposed ? "committed" : "not committed"}`
              + ` may only resume at ${legal.join(" or ")}`,
          );
        }
        if (existing.disposalConfirmedAt === null) {
          throw new PilotFixtureRuleError(
            "Recovery requires a verified reviewed export and an explicit confirmation",
          );
        }
      }

      if (parsed.toState === "DISPOSING") {
        if (existing.disposalConfirmedAt === null) {
          throw new PilotFixtureRuleError(
            "Disposal requires a verified reviewed export and an explicit confirmation",
          );
        }
        if (checkpointSaysDisposed) {
          throw new PilotFixtureRuleError(
            "Disposal has already committed; this operation may only resume at RECREATING",
          );
        }
      }
      if (parsed.toState === "FAILED" && !parsed.failureCode) {
        throw new PilotFixtureRuleError("A FAILED reset requires a failure code");
      }

      // --- replacement binding (R4/amendment §2) ----------------------------
      // Bound and frozen early with linkage checks; verification is required only before
      // SUCCEEDED, because verification happens *during* VERIFYING.
      let replacementInstanceId = existing.replacementInstanceId;
      let replacementBusinessId = existing.replacementBusinessId;
      if (parsed.replacementInstanceId) {
        if (!resetStateAcceptsReplacementBinding(parsed.toState)) {
          throw new PilotFixtureRuleError(
            `A replacement cannot be bound while moving to ${parsed.toState}`,
          );
        }
        if (existing.replacementInstanceId !== null
          && existing.replacementInstanceId !== parsed.replacementInstanceId) {
          throw new PilotFixtureRuleError(
            "A recorded replacement instance cannot be replaced by a different one",
          );
        }
        const replacement = await this.loadAndValidateReplacement(
          tx,
          parsed.replacementInstanceId,
          existing,
        );
        replacementInstanceId = replacement.id;
        replacementBusinessId = replacement.historicalBusinessId;
      }

      // --- success requires consistent recorded evidence --------------------
      let successFingerprint = existing.replacementVerificationFingerprint;
      if (parsed.toState === "SUCCEEDED") {
        if (replacementInstanceId === null) {
          throw new PilotFixtureRuleError("A SUCCEEDED reset requires a replacement instance");
        }
        if (!checkpointSaysDisposed) {
          throw new PilotFixtureRuleError(
            "A SUCCEEDED reset requires durable evidence that the original was disposed",
          );
        }
        // Loaded even when the caller omitted the id, so an already-bound replacement is
        // always validated rather than trusted (R4).
        const replacement = await this.loadAndValidateReplacement(
          tx,
          replacementInstanceId,
          existing,
        );
        if (!replacement.verificationPassed || replacement.verificationFingerprint === null) {
          throw new PilotFixtureRuleError(
            "A SUCCEEDED reset requires a verified replacement instance",
          );
        }
        if (replacement.businessId === null) {
          throw new PilotFixtureRuleError(
            "A SUCCEEDED reset requires an attached replacement instance",
          );
        }
        if (replacement.status !== "ACTIVE") {
          throw new PilotFixtureRuleError(
            `A ${replacement.status} replacement cannot complete a reset`,
          );
        }
        // Success evidence is the replacement's own recorded fingerprint, never a value
        // supplied by the caller.
        successFingerprint = replacement.verificationFingerprint;
      }

      const terminal = parsed.toState === "SUCCEEDED";
      const reentering = existing.state === "FAILED";
      const [updated] = await tx.update(fixtureResetOperations).set({
        state: parsed.toState,
        // On re-entry the live failure fields clear, but the history row below preserves
        // them, so retrying never destroys audit evidence (R3).
        failureCode: parsed.toState === "FAILED" ? parsed.failureCode : null,
        failureDetail: parsed.toState === "FAILED" ? (parsed.failureDetail ?? null) : null,
        replacementInstanceId,
        replacementBusinessId,
        preDisposalFingerprint: parsed.preDisposalFingerprint ?? existing.preDisposalFingerprint,
        replacementVerificationFingerprint: successFingerprint,
        completedAt: terminal ? new Date() : existing.completedAt,
        attemptCount: reentering ? existing.attemptCount + 1 : existing.attemptCount,
      }).where(and(
        eq(fixtureResetOperations.id, parsed.resetOperationId),
        eq(fixtureResetOperations.state, existing.state),
      )).returning();
      if (!updated) throw new PilotFixtureRuleError("Reset transition lost a concurrent race");

      if (parsed.toState === "FAILED") {
        // Append-only history, written in the same transaction as the state change.
        await tx.insert(fixtureResetOperationFailures).values({
          resetOperationId: existing.id,
          attemptNumber: existing.attemptCount,
          failureCode: parsed.failureCode as string,
          failureDetail: parsed.failureDetail ?? null,
          stateAtFailure: existing.state,
          recordedByActorType: actor.actorType,
          recordedByActorId: actor.actorId,
        });
      }

      return updated;
    });
  }

  /**
   * Load a replacement instance and check it agrees with the operation.
   *
   * Verification is deliberately NOT required here: a replacement is bound before it is
   * verified. Success adds the verification requirement separately.
   */
  private async loadAndValidateReplacement(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    replacementInstanceId: string,
    operation: typeof fixtureResetOperations.$inferSelect,
  ) {
    const [replacement] = await tx.select().from(fixtureInstances)
      .where(eq(fixtureInstances.id, replacementInstanceId)).for("update");
    if (!replacement) throw new PilotFixtureRuleError("Replacement instance does not exist");
    if (replacement.id === operation.originalInstanceId) {
      throw new PilotFixtureRuleError("A reset replacement cannot be the original instance");
    }
    if (replacement.predecessorInstanceId !== operation.originalInstanceId) {
      throw new PilotFixtureRuleError(
        "A reset replacement must record the original instance as its predecessor",
      );
    }
    if (replacement.fixtureTemplateId !== operation.fixtureTemplateId) {
      throw new PilotFixtureRuleError("Replacement template does not match the operation");
    }
    if (replacement.templateVersion !== operation.templateVersion) {
      throw new PilotFixtureRuleError(
        "Replacement template version does not match the operation",
      );
    }
    if (replacement.generation !== operation.resetGeneration) {
      throw new PilotFixtureRuleError("Replacement generation does not match the operation");
    }
    return replacement;
  }

  /**
   * The disposal **metadata** contract (amendment §4).
   *
   * Step D must call this inside the same transaction as the actual graph deletion, so the
   * instance's disposal fields, the live-link detachment and the operation's disposal
   * checkpoint all commit together. Step A defines and tests the contract; it does not
   * delete anything, and no service command exposes this in production.
   *
   * The detach is tied to a specific authorised operation: an unrelated operation, a wrong
   * target, a missing export confirmation or an inappropriate state are all refused.
   */
  async applyDisposalMetadata(
    authority: FixtureAdminAuthority,
    input: { resetOperationId: string; fixtureInstanceId: string; reason: string },
  ) {
    assertFixtureAdminCapability(authority, "reset_admin");
    const actor = executingActor(authority);

    return this.database.transaction(async (tx) => {
      const [operation] = await tx.select().from(fixtureResetOperations)
        .where(eq(fixtureResetOperations.id, input.resetOperationId)).for("update");
      if (!operation) throw new PilotFixtureRuleError("Reset operation does not exist");
      if (operation.state !== "DISPOSING") {
        throw new PilotFixtureRuleError(
          `Disposal metadata requires a DISPOSING operation, found ${operation.state}`,
        );
      }
      if (operation.disposalConfirmedAt === null) {
        throw new PilotFixtureRuleError(
          "Disposal requires a verified reviewed export and an explicit confirmation",
        );
      }
      if (operation.disposalCommittedAt !== null) {
        throw new PilotFixtureRuleError("Disposal has already been recorded as committed");
      }
      if (operation.originalInstanceId !== input.fixtureInstanceId) {
        throw new PilotFixtureRuleError(
          "Disposal target does not match this reset operation's original instance",
        );
      }

      const [instance] = await tx.select().from(fixtureInstances)
        .where(eq(fixtureInstances.id, input.fixtureInstanceId)).for("update");
      if (!instance) throw new PilotFixtureRuleError("Fixture instance does not exist");
      if (instance.status !== "ACTIVE") {
        throw new PilotFixtureRuleError(`A ${instance.status} instance cannot be disposed`);
      }
      if (instance.businessId === null) {
        throw new PilotFixtureRuleError("Instance is already detached");
      }
      if (instance.historicalBusinessId !== operation.originalBusinessId) {
        throw new PilotFixtureRuleError(
          "Instance retained Business identity does not match the reset operation target",
        );
      }

      const now = new Date();
      const [detached] = await tx.update(fixtureInstances).set({
        businessId: null,
        businessUsageBinding: null,
        status: "DISPOSED",
        disposedAt: now,
        disposalByActorType: actor.actorType,
        disposalByActorId: actor.actorId,
        disposalReason: input.reason,
      }).where(and(
        eq(fixtureInstances.id, input.fixtureInstanceId),
        eq(fixtureInstances.status, "ACTIVE"),
      )).returning();
      if (!detached) throw new PilotFixtureRuleError("Disposal lost a concurrent race");

      const [checkpointed] = await tx.update(fixtureResetOperations).set({
        disposalCommittedAt: now,
      }).where(and(
        eq(fixtureResetOperations.id, input.resetOperationId),
        isNull(fixtureResetOperations.disposalCommittedAt),
      )).returning();
      if (!checkpointed) {
        throw new PilotFixtureRuleError("Disposal checkpoint lost a concurrent race");
      }

      return { instance: detached, operation: checkpointed };
    });
  }

  getResetOperation(resetOperationId: string) {
    return this.database.select().from(fixtureResetOperations)
      .where(eq(fixtureResetOperations.id, resetOperationId)).then((rows) => rows[0] ?? null);
  }

  listResetFailures(resetOperationId: string) {
    return this.database.select().from(fixtureResetOperationFailures)
      .where(eq(fixtureResetOperationFailures.resetOperationId, resetOperationId));
  }

  /**
   * Read the audit trail by retained Business identity — a retained identity rather than a
   * foreign key, so the audit remains readable after the Business row is gone.
   */
  listResetOperationsForBusiness(businessId: string) {
    return this.database.select().from(fixtureResetOperations)
      .where(eq(fixtureResetOperations.originalBusinessId, businessId));
  }
}
