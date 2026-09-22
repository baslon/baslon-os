import { z } from "zod";
import type { Phase1DiagnosisModel } from "@/ai/phase1-diagnosis/model";
import { PHASE1_DIAGNOSIS_PROMPT_VERSION } from "@/ai/phase1-diagnosis/prompt";
import { staleRunCutoff, staleRunValidationErrors } from "@/domain/ai-run-recovery";
import {
  PHASE1_DIAGNOSIS_INPUT_VERSION,
  PHASE1_DIAGNOSIS_MODULE,
  PHASE1_DIAGNOSIS_RUN_TYPE,
  REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE,
  diagnosisReviewDecisions,
} from "@/domain/phase1-diagnosis";
import { ANNUALISED_RUN_RATE_RULE } from "@/domain/phase1-diagnosis-calculations";
import {
  buildApprovedDiagnosisArtifact,
  effectiveDiagnosisItem,
  persistedReferenceTarget,
} from "@/domain/phase1-diagnosis-artifact";
import {
  buildPhase1DiagnosisInput,
  hashPhase1DiagnosisInput,
  withCalculationReferences,
} from "@/domain/phase1-diagnosis-projection";
import {
  Phase1DiagnosisContractError,
  parseDiagnosisItem,
  validateDiagnosisItem,
  validatePhase1DiagnosisOutput,
} from "@/domain/phase1-diagnosis-validation";
import type { Phase1DiagnosisRepository } from "@/repositories/phase1-diagnosis-repository";
import type { StrategyOrchestrator } from "@/strategy/orchestrator";

const businessSchema = z.object({ businessId: z.uuid() }).strict();
const startReviewSchema = z.object({
  businessId: z.uuid(),
  runId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
}).strict();
const reviewItemSchema = z.object({
  businessId: z.uuid(),
  reviewSessionId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
  diagnosisItemId: z.uuid(),
  decision: z.enum(diagnosisReviewDecisions),
  correctedPayload: z.unknown().optional(),
  reason: z.string().trim().min(1).max(2000).optional(),
}).strict();
const approveSchema = z.object({
  businessId: z.uuid(),
  reviewSessionId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
}).strict();
const revisionSchema = z.object({
  businessId: z.uuid(),
  reason: z.string().trim().min(1).max(2000).optional(),
}).strict();

function asJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function serializeError(error: unknown): unknown[] {
  if (error instanceof z.ZodError) return error.issues.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message }));
  if (error instanceof Phase1DiagnosisContractError) return error.issues.map((message) => ({ code: "contract_rule", message }));
  return [{ code: "analysis_error", message: error instanceof Error ? error.message : "Unknown analysis error" }];
}

export class Phase1DiagnosisAnalysisError extends Error {
  constructor(readonly runId: string, readonly cause: unknown) {
    super("Phase 1 Diagnosis failed");
    this.name = "Phase1DiagnosisAnalysisError";
  }
}

export class RevisionRequiresNewSnapshotError extends Error {
  constructor() {
    super(REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE);
    this.name = "RevisionRequiresNewSnapshotError";
  }
}

type Run = NonNullable<Awaited<ReturnType<Phase1DiagnosisRepository["getRun"]>>>;

/**
 * Phase 1 Diagnosis: AI analyses one immutable snapshot, software enforces the
 * contract, and a human approves. A successful run stops at
 * PHASE1_AWAITING_REVIEW; only an explicit human approval of a server-built
 * artifact reaches PHASE1_APPROVED. Nothing here writes canonical state.
 */
export class Phase1DiagnosisService {
  constructor(
    private readonly repository: Phase1DiagnosisRepository,
    private readonly model: Phase1DiagnosisModel,
    private readonly orchestrator: StrategyOrchestrator,
  ) {}

  /** Human-initiated: runs one diagnosis of the latest snapshot. */
  async generate(input: unknown) {
    const { businessId } = businessSchema.parse(input);
    await this.repository.assertBusinessActive(businessId);
    // Checked before any run lookup, so a revision can never reuse the
    // diagnosis it sent back. REVISION_REQUIRED only leaves through new evidence.
    if ((await this.repository.getWorkflow(businessId))?.state === "REVISION_REQUIRED") {
      throw new RevisionRequiresNewSnapshotError();
    }
    const snapshot = await this.repository.getLatestSnapshot(businessId);
    if (!snapshot) throw new Error("A canonical snapshot is required before Phase 1 Diagnosis");
    const basis = await this.repository.getContinuationBasis(businessId);
    if (!basis || basis.snapshotId !== snapshot.id) {
      throw new Error("Continue with the latest snapshot's known gaps before Phase 1 Diagnosis");
    }
    const gaps = await this.repository.getCarriedForwardGaps(basis.analysisRunId, businessId);
    const built = buildPhase1DiagnosisInput({
      snapshot: { ...snapshot, snapshotData: snapshot.snapshotData as Record<string, unknown> },
      gaps,
    });
    const inputHash = hashPhase1DiagnosisInput(built.modelInput);
    const identity = {
      businessId,
      inputSnapshotId: snapshot.id,
      module: PHASE1_DIAGNOSIS_MODULE,
      inputProjectionVersion: PHASE1_DIAGNOSIS_INPUT_VERSION,
      promptVersion: PHASE1_DIAGNOSIS_PROMPT_VERSION,
    };

    let existing: Run | undefined = await this.repository.findEquivalentActive(identity);
    if (existing?.status === "RUNNING") {
      const recovered = await this.repository.failStaleRun({
        runId: existing.id,
        businessId,
        staleBefore: staleRunCutoff(),
        validationErrors: staleRunValidationErrors,
      });
      if (recovered) existing = undefined;
    }
    if (existing) {
      await this.reconcile(existing, businessId);
      return { run: existing, reused: true };
    }

    const workflow = await this.repository.getWorkflow(businessId);
    if (workflow?.state === "PHASE1_READY") {
      await this.orchestrator.transition({
        businessId,
        event: "GENERATE_PHASE1",
        actorType: "human",
        actorId: "business-user",
        reason: "Human requested Phase 1 Diagnosis",
        metadata: {
          snapshotId: snapshot.id,
          snapshotVersion: snapshot.version,
          coherenceRunId: basis.analysisRunId,
          inputProjectionVersion: PHASE1_DIAGNOSIS_INPUT_VERSION,
          promptVersion: PHASE1_DIAGNOSIS_PROMPT_VERSION,
        },
      });
    } else if (workflow?.state !== "PHASE1_ANALYSING") {
      throw new Error(`Phase 1 Diagnosis cannot start while workflow is ${workflow?.state ?? "missing"}`);
    }

    const configuration = this.model.getConfiguration();
    const created = await this.repository.createRun({
      ...identity,
      runType: PHASE1_DIAGNOSIS_RUN_TYPE,
      inputPayload: built.modelInput,
      inputHash,
      provider: configuration.provider,
      modelIdentifier: configuration.model,
      modelConfiguration: {
        ...configuration.metadata,
        snapshotContentHash: built.snapshotContentHash,
        gapSourceRunId: basis.analysisRunId,
        calculationRules: [ANNUALISED_RUN_RATE_RULE],
      },
      calculations: built.calculations,
    });
    if (!created.created) {
      await this.reconcile(created.run, businessId);
      return { run: created.run, reused: true };
    }
    const references = withCalculationReferences(built.references, created.calculations.map((row) => ({
      handle: row.calculationRef,
      id: row.id,
      label: row.label,
      valuePrecision: row.valuePrecision,
      valueNumeric: row.valueNumeric,
      valueLower: row.valueLower,
      valueUpper: row.valueUpper,
    })));

    let rawModelOutput: unknown = null;
    try {
      const result = await this.model.analyse(built.modelInput);
      rawModelOutput = asJsonValue(result.rawOutput);
      const items = validatePhase1DiagnosisOutput(result.output, references);
      const run = await this.repository.completeRun({ runId: created.run.id, businessId, rawModelOutput, items });
      await this.reconcile(run, businessId);
      return { run, reused: false };
    } catch (error) {
      const active = await this.repository.getRun(created.run.id, businessId);
      if (active?.status === "RUNNING") {
        await this.repository.failRun({
          runId: created.run.id,
          businessId,
          rawModelOutput,
          validationErrors: serializeError(error),
        });
      }
      // The workflow stays PHASE1_ANALYSING; a retry may run there.
      throw new Phase1DiagnosisAnalysisError(created.run.id, error);
    }
  }

  /** A successful diagnosis of the latest snapshot stops at the human review checkpoint. */
  private async reconcile(run: Run, businessId: string) {
    if (run.status !== "SUCCEEDED") return;
    const latest = await this.repository.getLatestSnapshot(businessId);
    if (latest?.id !== run.inputSnapshotId) return;
    const workflow = await this.repository.getWorkflow(businessId);
    if (workflow?.state !== "PHASE1_ANALYSING") return;
    try {
      await this.orchestrator.transition({
        businessId,
        event: "MARK_ANALYSIS_COMPLETE",
        actorType: "system",
        actorId: "phase1-diagnosis-service",
        reason: "Phase 1 Diagnosis passed contract validation and awaits human review",
        metadata: { analysisRunId: run.id, snapshotId: run.inputSnapshotId },
      });
    } catch (error) {
      if ((await this.repository.getWorkflow(businessId))?.state !== "PHASE1_AWAITING_REVIEW") throw error;
    }
  }

  /**
   * Rebuilds a run's handle map from its immutable inputs and proves it still
   * reproduces the recorded input hash before any decision relies on it.
   */
  async rebuildRunInput(run: Run, businessId: string) {
    const snapshot = await this.repository.getSnapshot(run.inputSnapshotId, businessId);
    const gapSourceRunId = run.modelConfiguration.gapSourceRunId;
    if (!snapshot || typeof gapSourceRunId !== "string") throw new Error("Diagnosis inputs are incomplete");
    const gaps = await this.repository.getCarriedForwardGaps(gapSourceRunId, businessId);
    const built = buildPhase1DiagnosisInput({
      snapshot: { ...snapshot, snapshotData: snapshot.snapshotData as Record<string, unknown> },
      gaps,
    });
    if (hashPhase1DiagnosisInput(built.modelInput) !== run.inputHash) {
      throw new Error("Diagnosis input no longer reproduces its recorded input hash");
    }
    const calculations = await this.repository.getCalculations(run.id, businessId);
    const sources = await this.repository.getCalculationSources(calculations.map((row) => row.id), businessId);
    const references = withCalculationReferences(built.references, calculations.map((row) => ({
      handle: row.calculationRef,
      id: row.id,
      label: row.label,
      valuePrecision: row.valuePrecision,
      valueNumeric: row.valueNumeric,
      valueLower: row.valueLower,
      valueUpper: row.valueUpper,
    })));
    return {
      snapshot,
      built,
      references,
      calculations: calculations.map((row) => ({
        ...row,
        sources: sources.filter((source) => source.diagnosisCalculationId === row.id),
      })),
    };
  }

  async startReview(input: unknown) {
    const parsed = startReviewSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    return this.repository.startReviewSession(parsed);
  }

  /** Records one explicit decision. A correction must pass the same contract as model output. */
  async reviewItem(input: unknown) {
    const parsed = reviewItemSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    let correctedPayload: Record<string, unknown> | null = null;
    if (parsed.decision === "CORRECTED") {
      const session = await this.repository.getReviewSessionById(parsed.reviewSessionId, parsed.businessId);
      const run = session && await this.repository.getRun(session.analysisRunId, parsed.businessId);
      if (!run) throw new Error("Diagnosis review session not found");
      const { references } = await this.rebuildRunInput(run, parsed.businessId);
      const draft = parseDiagnosisItem(parsed.correctedPayload);
      const { issues } = validateDiagnosisItem(draft, references, "correction");
      if (issues.length) throw new Phase1DiagnosisContractError(issues);
      correctedPayload = draft as unknown as Record<string, unknown>;
    } else if (parsed.correctedPayload !== undefined) {
      throw new Error("Only a CORRECTED decision may carry corrected values");
    }
    return this.repository.recordItemDecision({
      businessId: parsed.businessId,
      reviewSessionId: parsed.reviewSessionId,
      reviewerId: parsed.reviewerId,
      diagnosisItemId: parsed.diagnosisItemId,
      decision: parsed.decision,
      correctedPayload,
      reason: parsed.reason ?? null,
    });
  }

  /** Explicit human approval: builds the immutable artifact server-side, then advances. */
  async approve(input: unknown) {
    const parsed = approveSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const session = await this.repository.getReviewSessionById(parsed.reviewSessionId, parsed.businessId);
    const run = session && await this.repository.getRun(session.analysisRunId, parsed.businessId);
    if (!session || !run) throw new Error("Diagnosis review session not found");
    const rebuilt = await this.rebuildRunInput(run, parsed.businessId);
    const result = await this.repository.approve({
      ...parsed,
      buildArtifact: async ({ run: lockedRun, session: lockedSession, items, reviews, approvedAt }) => buildApprovedDiagnosisArtifact({
        businessId: parsed.businessId,
        run: lockedRun,
        snapshotVersion: rebuilt.snapshot.version,
        reviewSessionId: lockedSession.id,
        reviewer: lockedSession.reviewerId,
        approvedAt,
        items,
        reviews,
        calculations: rebuilt.calculations,
        gaps: rebuilt.built.gaps,
        references: rebuilt.references,
      }),
    });
    if (!result.approved) throw new Error("Approved diagnosis not found");
    try {
      await this.orchestrator.transition({
        businessId: parsed.businessId,
        event: "APPROVE_PHASE1",
        actorType: "human",
        actorId: parsed.reviewerId,
        reason: "Human approved the Phase 1 Diagnosis as the analytical basis for the next strategic phase",
        metadata: {
          approvedDiagnosisId: result.approved.id,
          approvedDiagnosisVersion: result.approved.version,
          analysisRunId: result.approved.analysisRunId,
          snapshotId: result.approved.snapshotId,
          reviewSessionId: result.approved.reviewSessionId,
        },
      });
    } catch (error) {
      if ((await this.repository.getWorkflow(parsed.businessId))?.state !== "PHASE1_APPROVED") throw error;
    }
    return result.approved;
  }

  /** Human sends the whole diagnosis back for revision. No artifact is created. */
  async requestRevision(input: unknown) {
    const parsed = revisionSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const snapshot = await this.repository.getLatestSnapshot(parsed.businessId);
    const run = snapshot && await this.repository.getLatestRunForSnapshot(snapshot.id, parsed.businessId);
    return this.orchestrator.transition({
      businessId: parsed.businessId,
      event: "REQUEST_REVISION",
      actorType: "human",
      actorId: "business-user",
      reason: parsed.reason ?? "Human requested a revised Phase 1 Diagnosis",
      metadata: { analysisRunId: run?.id ?? null, snapshotId: snapshot?.id ?? null },
    });
  }

  /** Read model for the diagnosis page: every material persisted field, resolved for display. */
  async get(businessId: string): Promise<DiagnosisViewModel | undefined> {
    const parsed = businessSchema.parse({ businessId });
    const business = await this.repository.getBusiness(parsed.businessId);
    const workflow = await this.repository.getWorkflow(parsed.businessId);
    if (!business || !workflow) return undefined;
    const snapshot = await this.repository.getLatestSnapshot(parsed.businessId);
    const run = snapshot && await this.repository.getLatestRunForSnapshot(snapshot.id, parsed.businessId);
    const model: DiagnosisViewModel = {
      business: { id: business.id, name: business.name, status: business.status },
      workflowState: workflow.state,
      snapshot: snapshot ? { id: snapshot.id, version: snapshot.version } : null,
      run: run ? {
        id: run.id,
        status: run.status,
        inputProjectionVersion: run.inputProjectionVersion,
        promptVersion: run.promptVersion,
        inputHash: run.inputHash,
        provider: run.provider,
        modelIdentifier: run.modelIdentifier,
        snapshotContentHash: typeof run.modelConfiguration.snapshotContentHash === "string" ? run.modelConfiguration.snapshotContentHash : null,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      } : null,
      gaps: [],
      calculations: [],
      items: [],
      session: null,
      approved: null,
    };
    if (!run || run.status !== "SUCCEEDED") return model;
    const rebuilt = await this.rebuildRunInput(run, parsed.businessId);
    const handleOf = (entityType: string, id: string) => [...rebuilt.references]
      .find(([, reference]) => reference.entityType === entityType && reference.id === id);
    const items = await this.repository.getItems(run.id, parsed.businessId);
    const session = await this.repository.getReviewSession(run.id, parsed.businessId);
    const reviews = session ? await this.repository.getItemReviews(session.id, parsed.businessId) : [];
    const approved = await this.repository.getApprovedDiagnosis(run.id, parsed.businessId);
    model.gaps = rebuilt.built.gaps.map((gap) => ({
      handle: gap.handle, area: gap.area, materiality: gap.materiality,
      missingInformation: gap.missingInformation, decisionImpact: gap.decisionImpact,
    }));
    model.calculations = rebuilt.calculations.map((row) => ({
      handle: row.calculationRef, label: row.label, formula: row.formula, ruleKey: row.ruleKey, ruleVersion: row.ruleVersion,
      valueNumeric: row.valueNumeric, valuePrecision: row.valuePrecision, valueLower: row.valueLower, valueUpper: row.valueUpper,
      unit: row.unit,
      sources: row.sources.map((source) => handleOf(source.metricId ? "metric" : "evidence", (source.metricId ?? source.evidenceId)!)?.[0] ?? "unknown"),
    }));
    model.items = items.map((item) => {
      const review = reviews.find((entry) => entry.diagnosisItemId === item.id);
      // The same effective-item function the approved artifact uses (M4-13).
      const effective = review ? effectiveDiagnosisItem(item, review, rebuilt.references) : null;
      return {
        id: item.id,
        itemRef: item.itemRef,
        itemType: item.itemType,
        statement: item.statement,
        rationale: item.rationale,
        grounding: item.grounding,
        materiality: item.materiality,
        interpretationConfidence: item.interpretationConfidence,
        limitations: item.limitations,
        references: item.references.map((reference) => {
          const target = persistedReferenceTarget(reference);
          const entry = handleOf(target.entityType, target.id);
          return { handle: entry?.[0] ?? "unknown", entityType: target.entityType, role: reference.role, label: entry?.[1].label ?? "" };
        }),
        decision: review ? { decision: review.decision, reason: review.reason, correctedPayload: review.correctedPayload } : null,
        effective: effective ? {
          ...effective,
          references: effective.references.map(({ handle, entityType, role, label }) => ({ handle, entityType, role, label })),
        } : null,
      };
    });
    model.session = session ? { id: session.id, reviewerId: session.reviewerId, status: session.status } : null;
    model.approved = approved ? {
      id: approved.id, version: approved.version, approvedBy: approved.approvedBy,
      approvedAt: approved.approvedAt.toISOString(), content: approved.approvedContent,
    } : null;
    return model;
  }
}

/** The eight material fields of a diagnosis item, with references resolved for display. */
export type DiagnosisDisplayItem = {
  itemType: string;
  statement: string;
  rationale: string;
  grounding: string;
  materiality: string;
  interpretationConfidence: string | null;
  limitations: string | null;
  references: Array<{ handle: string; entityType: string; role: string; label: string }>;
};

export type DiagnosisViewModel = {
  business: { id: string; name: string; status: string };
  workflowState: string;
  snapshot: { id: string; version: number } | null;
  run: {
    id: string;
    status: "RUNNING" | "SUCCEEDED" | "FAILED";
    inputProjectionVersion: string;
    promptVersion: string;
    inputHash: string;
    provider: string;
    modelIdentifier: string;
    snapshotContentHash: string | null;
    createdAt: string;
    completedAt: string | null;
  } | null;
  gaps: Array<{ handle: string; area: string; materiality: string; missingInformation: string; decisionImpact: string }>;
  calculations: Array<{
    handle: string; label: string; formula: string; ruleKey: string; ruleVersion: string;
    valueNumeric: string | null; valuePrecision: string; valueLower: string | null; valueUpper: string | null;
    unit: string; sources: string[];
  }>;
  items: Array<{
    id: string;
    itemRef: string;
    itemType: string;
    statement: string;
    rationale: string;
    grounding: string;
    materiality: string;
    interpretationConfidence: string | null;
    limitations: string | null;
    references: Array<{ handle: string; entityType: string; role: string; label: string }>;
    decision: { decision: string; reason: string | null; correctedPayload: Record<string, unknown> | null } | null;
    /** What approval will persist for this item; null while undecided or when REJECTED. */
    effective: DiagnosisDisplayItem | null;
  }>;
  session: { id: string; reviewerId: string; status: string } | null;
  approved: { id: string; version: number; approvedBy: string; approvedAt: string; content: Record<string, unknown> } | null;
};
