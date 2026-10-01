import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  approvedDiagnoses,
  businesses,
  businessStateSnapshots,
  fixtureInstanceRunProvenance,
  fixtureInstances,
  fixtureResetOperations,
  fixtureTemplates,
} from "@/db/schema";
import {
  advanceResetStateSchema,
  confirmResetExportSchema,
  createResetRequestSchema,
  evaluateFixtureInstanceEligibility,
  isLegalInstanceStatusTransition,
  isLegalResetStateTransition,
  isLegalTemplateStatusTransition,
  markInstanceFailedCreationSchema,
  PilotFixtureRuleError,
  recordInstanceVerificationSchema,
  recordRunProvenanceSchema,
  registerFixtureInstanceSchema,
  registerFixtureTemplateSchema,
  retireFixtureTemplateSchema,
  type AdvanceResetStateInput,
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
 * Every mutating method here is a *registration primitive*: it records provenance that
 * some other component produced. None of them copies a Phase 1 graph, verifies a clone
 * or deletes anything — those are Steps B and D. The primitives are intentionally not
 * reachable through generic Business CRUD, and the protected classification writes are
 * wrapped in the transaction-local setting the database guard requires.
 */
export class PilotFixtureRepository {
  constructor(private readonly database: Database) {}

  /**
   * Opens the transaction-local window in which `businesses.business_usage` may be set
   * to or cleared from a protected fixture value. The database trigger rejects such a
   * change otherwise, so no ordinary update path can promote or demote a fixture.
   */
  private async allowProtectedUsageChange(tx: {
    execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
  }): Promise<void> {
    await tx.execute(sql`select set_config('baslon.fixture_usage_change', 'on', true)`);
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  /**
   * Register an approved template over an existing template Business.
   *
   * This validates the provenance it is given; it does not build the baseline. A row
   * created here describes a template whose content Step B must still copy, which is
   * why the caller must supply a content fingerprint rather than having one derived.
   */
  async registerTemplate(input: RegisterFixtureTemplateInput) {
    const parsed = registerFixtureTemplateSchema.parse(input);
    return this.database.transaction(async (tx) => {
      const [templateBusiness] = await tx.select({
        id: businesses.id,
        usage: businesses.businessUsage,
        status: businesses.status,
      }).from(businesses).where(eq(businesses.id, parsed.templateBusinessId)).for("update");
      if (!templateBusiness) throw new PilotFixtureRuleError("Template Business does not exist");

      const [sourceBusiness] = await tx.select({
        id: businesses.id,
        usage: businesses.businessUsage,
      }).from(businesses).where(eq(businesses.id, parsed.sourceBusinessId)).for("update");
      if (!sourceBusiness) throw new PilotFixtureRuleError("Source Business does not exist");

      // The source is never reclassified or converted (architecture 5.2). A template may
      // only ever be built from a non-fixture Business.
      if (sourceBusiness.usage === "PILOT_FIXTURE_TEMPLATE"
        || sourceBusiness.usage === "PILOT_FIXTURE_INSTANCE") {
        throw new PilotFixtureRuleError(
          "A fixture template or instance cannot itself be a template source",
        );
      }

      // The template Business must be a fresh, empty-purpose Business, not the source
      // relabelled. Requiring SYNTHETIC_TEST here means the caller had to create a
      // distinct Business first; LIVE is refused outright.
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

      // Provenance must belong to the source Business. The composite FKs enforce this
      // too; checking here produces a domain error instead of a constraint violation.
      const [diagnosis] = await tx.select({
        id: approvedDiagnoses.id,
        version: approvedDiagnoses.version,
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

      // Promote the template Business into the protected classification inside the
      // guarded window, then record provenance in the same transaction.
      await this.allowProtectedUsageChange(tx);
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
        sourceSnapshotContentHash: parsed.sourceSnapshotContentHash,
        templateContentFingerprint: parsed.templateContentFingerprint,
        createdByActorType: parsed.createdBy.actorType,
        createdByActorId: parsed.createdBy.actorId,
        approvedByActorType: parsed.approvedBy.actorType,
        approvedByActorId: parsed.approvedBy.actorId,
      }).returning();
      return template;
    });
  }

  /**
   * Retire a template. This is the only supported template lifecycle change: an
   * approved baseline is never edited, it is superseded by a new version.
   */
  async retireTemplate(input: RetireFixtureTemplateInput) {
    const parsed = retireFixtureTemplateSchema.parse(input);
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureTemplates)
        .where(eq(fixtureTemplates.id, parsed.fixtureTemplateId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Fixture template does not exist");
      if (!isLegalTemplateStatusTransition(existing.status, "RETIRED")) {
        throw new PilotFixtureRuleError(
          `A ${existing.status} template cannot be retired`,
        );
      }
      const [updated] = await tx.update(fixtureTemplates).set({
        status: "RETIRED",
        retiredAt: new Date(),
        retiredByActorType: parsed.retiredBy.actorType,
        retiredByActorId: parsed.retiredBy.actorId,
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
   * The instance is created unverified, and stays ineligible until a real clone
   * verification records a fingerprint. Step A has no verifier, so nothing here can
   * present the instance as pilot-ready.
   */
  async registerInstance(input: RegisterFixtureInstanceInput) {
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

      await this.allowProtectedUsageChange(tx);
      await tx.update(businesses)
        .set({ businessUsage: "PILOT_FIXTURE_INSTANCE", updatedAt: new Date() })
        .where(eq(businesses.id, parsed.businessId));

      const [instance] = await tx.insert(fixtureInstances).values({
        businessId: parsed.businessId,
        businessUsageBinding: "PILOT_FIXTURE_INSTANCE",
        historicalBusinessId: parsed.businessId,
        fixtureTemplateId: parsed.fixtureTemplateId,
        templateVersion: template.templateVersion,
        createdByActorType: parsed.createdBy.actorType,
        createdByActorId: parsed.createdBy.actorId,
        generation,
        predecessorInstanceId: predecessorId,
      }).returning();
      return instance;
    });
  }

  /**
   * Record a passed clone verification. Step B owns the actual comparison; this only
   * persists its outcome, and refuses to mark a non-ACTIVE instance verified.
   */
  async recordInstanceVerification(input: RecordInstanceVerificationInput) {
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
      if (existing.verificationPassed) {
        throw new PilotFixtureRuleError("Instance verification has already been recorded");
      }
      const [updated] = await tx.update(fixtureInstances).set({
        verificationPassed: true,
        verificationFingerprint: parsed.verificationFingerprint,
        verifiedByActorType: parsed.verifiedBy.actorType,
        verifiedByActorId: parsed.verifiedBy.actorId,
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
  async markInstanceFailedCreation(input: MarkInstanceFailedCreationInput) {
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
  async recordRunProvenance(input: RecordRunProvenanceInput) {
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
   * Step C adds the workflow, approved-Diagnosis and Snapshot-binding checks. Until
   * then a true result here is necessary but not sufficient, and callers must not treat
   * it as the gate.
   */
  async evaluateEligibility(businessId: string): Promise<FixtureEligibility> {
    const [business] = await this.database.select({
      usage: businesses.businessUsage,
      status: businesses.status,
    }).from(businesses).where(eq(businesses.id, businessId));
    if (!business) return { eligible: false, reasons: ["business_not_found"] };

    const instance = await this.getInstanceByBusiness(businessId);
    const template = instance
      ? await this.getTemplate(instance.fixtureTemplateId)
      : null;

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
      template: template ? { status: template.status, templateVersion: template.templateVersion } : null,
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
   * operation id is the idempotency key: a repeat with the same id returns the existing
   * record, and a repeat that names a different original target is refused rather than
   * silently rebound.
   */
  async createResetRequest(input: CreateResetRequestInput) {
    const parsed = createResetRequestSchema.parse(input);
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureResetOperations)
        .where(eq(fixtureResetOperations.id, parsed.resetOperationId)).for("update");
      const [instance] = await tx.select().from(fixtureInstances)
        .where(eq(fixtureInstances.id, parsed.originalInstanceId)).for("update");
      if (!instance) throw new PilotFixtureRuleError("Original fixture instance does not exist");

      if (existing) {
        // Idempotent replay. Rebinding an operation to a different target would let a
        // retry destroy the wrong graph, so it is refused outright.
        if (existing.originalInstanceId !== parsed.originalInstanceId) {
          throw new PilotFixtureRuleError(
            "A reset operation cannot be rebound to a different original instance",
          );
        }
        if (existing.resetGeneration !== parsed.resetGeneration) {
          throw new PilotFixtureRuleError(
            "A reset operation cannot be rebound to a different generation",
          );
        }
        return existing;
      }

      if (instance.status !== "ACTIVE") {
        throw new PilotFixtureRuleError(
          `A ${instance.status} instance cannot be the target of a new reset`,
        );
      }
      if (instance.fixtureTemplateId !== parsed.fixtureTemplateId) {
        throw new PilotFixtureRuleError(
          "Reset template does not match the instance's template",
        );
      }
      if (parsed.resetGeneration !== instance.generation + 1) {
        throw new PilotFixtureRuleError(
          "Reset generation must be exactly one greater than the instance generation",
        );
      }

      const [created] = await tx.insert(fixtureResetOperations).values({
        id: parsed.resetOperationId,
        originalInstanceId: parsed.originalInstanceId,
        originalBusinessId: instance.historicalBusinessId,
        fixtureTemplateId: parsed.fixtureTemplateId,
        templateVersion: parsed.templateVersion,
        resetGeneration: parsed.resetGeneration,
        requestedByActorType: parsed.requestedBy.actorType,
        requestedByActorId: parsed.requestedBy.actorId,
        reason: parsed.reason,
      }).returning();
      return created;
    });
  }

  /**
   * Record the reviewed export and the explicit disposal confirmation (architecture
   * 9.5). Reset must fail closed without these, so they are stored before any
   * destructive state is entered.
   */
  async confirmResetExport(input: ConfirmResetExportInput) {
    const parsed = confirmResetExportSchema.parse(input);
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureResetOperations)
        .where(eq(fixtureResetOperations.id, parsed.resetOperationId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Reset operation does not exist");
      if (existing.state !== "REQUESTED") {
        throw new PilotFixtureRuleError(
          `Export confirmation requires a REQUESTED operation, found ${existing.state}`,
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
        disposalConfirmedByActorType: parsed.disposalConfirmedBy.actorType,
        disposalConfirmedByActorId: parsed.disposalConfirmedBy.actorId,
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
   * Step A persists the states; Step D drives them around real disposal. Leaving
   * `REQUESTED` towards disposal requires the confirmed export, and a replacement
   * identity, once recorded, cannot be swapped for another.
   */
  async advanceResetState(input: AdvanceResetStateInput) {
    const parsed = advanceResetStateSchema.parse(input);
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(fixtureResetOperations)
        .where(eq(fixtureResetOperations.id, parsed.resetOperationId)).for("update");
      if (!existing) throw new PilotFixtureRuleError("Reset operation does not exist");
      if (!isLegalResetStateTransition(existing.state, parsed.toState)) {
        throw new PilotFixtureRuleError(
          `Reset state cannot move from ${existing.state} to ${parsed.toState}`,
        );
      }
      if (parsed.toState === "DISPOSING" && existing.disposalConfirmedAt === null) {
        throw new PilotFixtureRuleError(
          "Disposal requires a verified reviewed export and an explicit confirmation",
        );
      }
      if (parsed.toState === "FAILED" && !parsed.failureCode) {
        throw new PilotFixtureRuleError("A FAILED reset requires a failure code");
      }

      let replacementInstanceId = existing.replacementInstanceId;
      let replacementBusinessId = existing.replacementBusinessId;
      if (parsed.replacementInstanceId) {
        if (existing.replacementInstanceId !== null
          && existing.replacementInstanceId !== parsed.replacementInstanceId) {
          throw new PilotFixtureRuleError(
            "A recorded replacement instance cannot be replaced by a different one",
          );
        }
        const [replacement] = await tx.select().from(fixtureInstances)
          .where(eq(fixtureInstances.id, parsed.replacementInstanceId)).for("update");
        if (!replacement) throw new PilotFixtureRuleError("Replacement instance does not exist");
        if (replacement.id === existing.originalInstanceId) {
          throw new PilotFixtureRuleError(
            "A reset replacement cannot be the original instance",
          );
        }
        if (replacement.predecessorInstanceId !== existing.originalInstanceId) {
          throw new PilotFixtureRuleError(
            "A reset replacement must record the original instance as its predecessor",
          );
        }
        replacementInstanceId = replacement.id;
        replacementBusinessId = replacement.historicalBusinessId;
      }

      if (parsed.toState === "SUCCEEDED" && replacementInstanceId === null) {
        throw new PilotFixtureRuleError("A SUCCEEDED reset requires a replacement instance");
      }

      const terminal = parsed.toState === "SUCCEEDED" || parsed.toState === "FAILED";
      const [updated] = await tx.update(fixtureResetOperations).set({
        state: parsed.toState,
        failureCode: parsed.toState === "FAILED" ? parsed.failureCode : existing.failureCode,
        failureDetail: parsed.toState === "FAILED"
          ? (parsed.failureDetail ?? null)
          : existing.failureDetail,
        replacementInstanceId,
        replacementBusinessId,
        preDisposalFingerprint: parsed.preDisposalFingerprint ?? existing.preDisposalFingerprint,
        replacementVerificationFingerprint: parsed.replacementVerificationFingerprint
          ?? existing.replacementVerificationFingerprint,
        completedAt: terminal ? new Date() : existing.completedAt,
      }).where(and(
        eq(fixtureResetOperations.id, parsed.resetOperationId),
        eq(fixtureResetOperations.state, existing.state),
      )).returning();
      if (!updated) throw new PilotFixtureRuleError("Reset transition lost a concurrent race");
      return updated;
    });
  }

  getResetOperation(resetOperationId: string) {
    return this.database.select().from(fixtureResetOperations)
      .where(eq(fixtureResetOperations.id, resetOperationId)).then((rows) => rows[0] ?? null);
  }

  /**
   * Read the audit trail by retained Business identity.
   *
   * Deliberately keyed on `original_business_id`, which is a retained identity rather
   * than a foreign key, so the audit remains readable after the Business row is gone.
   */
  listResetOperationsForBusiness(businessId: string) {
    return this.database.select().from(fixtureResetOperations)
      .where(eq(fixtureResetOperations.originalBusinessId, businessId));
  }
}
