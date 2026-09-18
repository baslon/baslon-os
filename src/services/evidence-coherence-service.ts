import { z } from "zod";
import type { EvidenceCoherenceModel } from "@/ai/evidence-coherence/model";
import { EVIDENCE_COHERENCE_PROMPT_VERSION } from "@/ai/evidence-coherence/prompt";
import {
  EvidenceCoherenceBusinessRuleError,
  validateEvidenceCoherenceOutput,
} from "@/ai/evidence-coherence/validation";
import {
  EVIDENCE_COHERENCE_INPUT_VERSION,
  EVIDENCE_COHERENCE_MODULE,
  EVIDENCE_COHERENCE_RUN_TYPE,
} from "@/domain/evidence-coherence";
import {
  buildEvidenceCoherenceProjection,
  evidenceCoherenceModelInput,
  hashEvidenceCoherenceProjection,
} from "@/domain/evidence-coherence-projection";
import type { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import type { StrategyOrchestrator } from "@/strategy/orchestrator";
import { staleRunCutoff, staleRunValidationErrors } from "@/domain/ai-run-recovery";

const inputSchema = z.object({ businessId: z.uuid() }).strict();

function asJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function serializeError(error: unknown): unknown[] {
  if (error instanceof z.ZodError) return error.issues.map((issue) => ({
    code: issue.code, path: issue.path, message: issue.message,
  }));
  if (error instanceof EvidenceCoherenceBusinessRuleError) {
    return error.issues.map((message) => ({ code: "business_rule", message }));
  }
  return [{ code: "analysis_error", message: error instanceof Error ? error.message : "Unknown analysis error" }];
}

export class EvidenceCoherenceAnalysisError extends Error {
  constructor(readonly runId: string, readonly cause: unknown) {
    super("Evidence Coherence analysis failed");
    this.name = "EvidenceCoherenceAnalysisError";
  }
}

export class EvidenceCoherenceService {
  constructor(
    private readonly repository: EvidenceCoherenceRepository,
    private readonly model: EvidenceCoherenceModel,
    private readonly orchestrator: StrategyOrchestrator,
  ) {}

  async analyseCurrentSnapshot(input: unknown) {
    const parsed = inputSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const snapshot = await this.repository.getLatestSnapshot(parsed.businessId);
    if (!snapshot) throw new Error("A canonical Evidence State snapshot is required before analysis");
    const projection = buildEvidenceCoherenceProjection({
      ...snapshot,
      snapshotData: snapshot.snapshotData as Record<string, unknown>,
    });
    const modelInput = evidenceCoherenceModelInput(projection);
    const inputHash = hashEvidenceCoherenceProjection(projection);
    const identity = {
      businessId: parsed.businessId,
      inputSnapshotId: snapshot.id,
      module: EVIDENCE_COHERENCE_MODULE,
      inputProjectionVersion: EVIDENCE_COHERENCE_INPUT_VERSION,
      promptVersion: EVIDENCE_COHERENCE_PROMPT_VERSION,
    };
    let existing: Awaited<ReturnType<EvidenceCoherenceRepository["findEquivalentActive"]>> | undefined
      = await this.repository.findEquivalentActive(identity);
    if (existing?.status === "RUNNING") {
      const recovered = await this.repository.failStaleRun({
        runId: existing.id,
        businessId: parsed.businessId,
        staleBefore: staleRunCutoff(),
        validationErrors: staleRunValidationErrors,
      });
      if (recovered) {
        existing = undefined;
      } else {
        const current = await this.repository.getRun(existing.id, parsed.businessId);
        if (current?.status !== "RUNNING") existing = undefined;
      }
    }
    if (existing) {
      await this.reconcileWorkflow(existing.id, parsed.businessId, snapshot.id, existing.status);
      return { run: existing, reused: true };
    }

    const workflow = await this.repository.getWorkflow(parsed.businessId);
    if (!workflow || !["EVIDENCE_READY", "GAP_ANALYSIS"].includes(workflow.state)) {
      throw new Error(`Evidence Coherence cannot start while workflow is ${workflow?.state ?? "missing"}`);
    }
    const configuration = this.model.getConfiguration();
    const created = await this.repository.createRun({
      ...identity,
      runType: EVIDENCE_COHERENCE_RUN_TYPE,
      inputPayload: modelInput,
      inputHash,
      provider: configuration.provider,
      modelIdentifier: configuration.model,
      modelConfiguration: configuration.metadata,
    });
    if (!created.created) {
      await this.reconcileWorkflow(created.run.id, parsed.businessId, snapshot.id, created.run.status);
      return { run: created.run, reused: true };
    }
    let rawModelOutput: unknown = null;
    try {
      await this.reconcileWorkflow(created.run.id, parsed.businessId, snapshot.id, created.run.status);
      const result = await this.model.analyse(modelInput);
      rawModelOutput = asJsonValue(result.rawOutput);
      const output = validateEvidenceCoherenceOutput(result.output, projection);
      const run = await this.repository.completeRun({
        runId: created.run.id,
        businessId: parsed.businessId,
        rawModelOutput,
        output,
      });
      await this.reconcileWorkflow(run.id, parsed.businessId, snapshot.id, run.status);
      return { run, reused: false, output };
    } catch (error) {
      const active = await this.repository.getRun(created.run.id, parsed.businessId);
      if (active?.status === "RUNNING") {
        await this.repository.failRun({
          runId: created.run.id,
          businessId: parsed.businessId,
          rawModelOutput,
          validationErrors: serializeError(error),
        });
      }
      throw new EvidenceCoherenceAnalysisError(created.run.id, error);
    }
  }

  private async reconcileWorkflow(
    runId: string,
    businessId: string,
    snapshotId: string,
    status: "RUNNING" | "SUCCEEDED" | "FAILED",
  ) {
    const latestSnapshot = await this.repository.getLatestSnapshot(businessId);
    if (latestSnapshot?.id !== snapshotId) return;
    let workflow = await this.repository.getWorkflow(businessId);
    if (workflow?.state === "EVIDENCE_READY") {
      try {
        await this.orchestrator.transition({
          businessId,
          event: "RUN_GAP_ANALYSIS",
          actorType: "system",
          actorId: "evidence-coherence-service",
          metadata: { analysisRunId: runId, snapshotId },
        });
      } catch (error) {
        workflow = await this.repository.getWorkflow(businessId);
        if (workflow?.state !== "GAP_ANALYSIS" && workflow?.state !== "GAP_RESOLUTION_REQUIRED") {
          throw error;
        }
      }
      workflow = await this.repository.getWorkflow(businessId);
    }
    if (status === "SUCCEEDED" && workflow?.state === "GAP_ANALYSIS") {
      try {
        await this.orchestrator.transition({
          businessId,
          event: "MARK_ANALYSIS_COMPLETE",
          actorType: "system",
          actorId: "evidence-coherence-service",
          metadata: { analysisRunId: runId, snapshotId },
        });
      } catch (error) {
        workflow = await this.repository.getWorkflow(businessId);
        if (workflow?.state !== "GAP_RESOLUTION_REQUIRED") throw error;
      }
    }
  }
}
