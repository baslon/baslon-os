import { z } from "zod";
import type { DiagnosisHeadlineModel } from "@/ai/diagnosis-headlines/model";
import { staleRunCutoff, staleRunValidationErrors } from "@/domain/ai-run-recovery";
import { duplicateHeadlineIssues, validateHeadline } from "@/domain/diagnosis-headline";
import {
  DIAGNOSIS_HEADLINES_INPUT_VERSION,
  DIAGNOSIS_HEADLINES_RUN_TYPE,
  DiagnosisHeadlineContractError,
  buildHeadlineProposalInput,
  diagnosisHeadlineReviewDecisions,
  effectiveApprovedItems,
  effectiveHeadline,
  hashHeadlineProposalInput,
  validateHeadlineProposalOutput,
  type EffectiveApprovedItem,
} from "@/domain/diagnosis-headlines";
import { diagnosisContractForArtifact } from "@/domain/phase1-diagnosis-versions";
import type { DiagnosisHeadlineRepository } from "@/repositories/diagnosis-headline-repository";

const businessSchema = z.object({ businessId: z.uuid() }).strict();
const proposeSchema = z.object({
  businessId: z.uuid(),
  approvedDiagnosisId: z.uuid(),
  /** Explicit Product Owner approval to retry exactly one failed proposal run. */
  retryOfFailedRunId: z.uuid().optional(),
}).strict();
const startReviewSchema = z.object({
  businessId: z.uuid(),
  approvedDiagnosisId: z.uuid(),
  proposalRunId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
}).strict();
const reviewSchema = z.object({
  businessId: z.uuid(),
  reviewSessionId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
  diagnosisItemId: z.uuid(),
  decision: z.enum(diagnosisHeadlineReviewDecisions),
  correctedHeadline: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).max(2000).optional(),
}).strict();
const approveSchema = z.object({
  businessId: z.uuid(),
  reviewSessionId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
}).strict();

export const HEADLINE_RETRY_REQUIRES_APPROVAL_MESSAGE =
  "The last headline proposal run failed. A retry needs explicit Product Owner approval, and only one retry is allowed.";
export const NATIVE_HEADLINES_MESSAGE =
  "This approved diagnosis already carries reviewed headlines, so it needs no companion headline set.";

export class DiagnosisHeadlineAnalysisError extends Error {
  constructor(readonly runId: string, readonly cause: unknown) {
    super("Diagnosis headline proposal failed");
    this.name = "DiagnosisHeadlineAnalysisError";
  }
}

function asJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function serializeError(error: unknown): unknown[] {
  if (error instanceof z.ZodError) return error.issues.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message }));
  if (error instanceof DiagnosisHeadlineContractError) return error.issues.map((message) => ({ code: "contract_rule", message }));
  return [{ code: "analysis_error", message: error instanceof Error ? error.message : "Unknown analysis error" }];
}

/**
 * Companion headlines over an already-approved Phase 1 Diagnosis: AI proposes a
 * label for each approved statement, software validates it, and a human accepts
 * or corrects every one before an immutable headline set is approved. Nothing
 * here writes the approved diagnosis, the diagnosis review, canonical records
 * or the workflow, and no headline is generated at render time.
 */
export class DiagnosisHeadlineService {
  constructor(
    private readonly repository: DiagnosisHeadlineRepository,
    private readonly model: DiagnosisHeadlineModel,
  ) {}

  /** The current approved diagnosis, with its effective items, or an explicit refusal. */
  private async currentTarget(businessId: string, approvedDiagnosisId?: string) {
    const workflow = await this.repository.getWorkflow(businessId);
    if (workflow?.state !== "PHASE1_APPROVED") {
      throw new Error("Diagnosis headlines require the workflow to be PHASE1_APPROVED");
    }
    const approved = await this.repository.getCurrentApprovedDiagnosis(businessId);
    if (!approved) throw new Error("This Business has no approved Phase 1 Diagnosis");
    if (approvedDiagnosisId && approved.id !== approvedDiagnosisId) {
      throw new Error("Headlines can only be written for the current approved diagnosis");
    }
    const contract = diagnosisContractForArtifact(approved.artifactVersion);
    return { approved, contract, items: effectiveApprovedItems(approved.approvedContent) };
  }

  /**
   * Human-initiated: proposes one headline for every effective approved item.
   * A failed run is never silently replaced; one retry needs explicit approval.
   */
  async propose(input: unknown) {
    const parsed = proposeSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const { approved, contract, items } = await this.currentTarget(parsed.businessId, parsed.approvedDiagnosisId);
    if (contract.hasHeadline) throw new Error(NATIVE_HEADLINES_MESSAGE);

    const runs = await this.repository.getRuns(approved.id, parsed.businessId);
    const succeeded = runs.find((run) => run.status === "SUCCEEDED");
    if (succeeded) return { run: succeeded, reused: true };
    let running = runs.find((run) => run.status === "RUNNING");
    if (running) {
      const recovered = await this.repository.failStaleRun({
        runId: running.id,
        businessId: parsed.businessId,
        staleBefore: staleRunCutoff(),
        validationErrors: staleRunValidationErrors,
      });
      if (recovered) running = undefined;
      else return { run: running, reused: true };
    }
    const failed = runs.filter((run) => run.status === "FAILED");
    if (failed.length) {
      if (failed.length > 1 || parsed.retryOfFailedRunId !== failed[0].id) {
        throw new Error(HEADLINE_RETRY_REQUIRES_APPROVAL_MESSAGE);
      }
    }

    const modelInput = buildHeadlineProposalInput(items);
    const configuration = this.model.getConfiguration();
    const created = await this.repository.createRun({
      businessId: parsed.businessId,
      inputSnapshotId: approved.snapshotId,
      inputProjectionVersion: DIAGNOSIS_HEADLINES_INPUT_VERSION,
      promptVersion: configuration.promptVersion,
      runType: DIAGNOSIS_HEADLINES_RUN_TYPE,
      inputPayload: modelInput as unknown as Record<string, unknown>,
      inputHash: hashHeadlineProposalInput(modelInput),
      provider: configuration.provider,
      modelIdentifier: configuration.model,
      modelConfiguration: {
        ...configuration.metadata,
        approvedDiagnosisId: approved.id,
        approvedDiagnosisVersion: approved.version,
        diagnosisRunId: approved.analysisRunId,
        diagnosisArtifactVersion: approved.artifactVersion,
        snapshotId: approved.snapshotId,
        retryOfFailedRunId: parsed.retryOfFailedRunId ?? null,
      },
    });

    let rawModelOutput: unknown = null;
    try {
      const result = await this.model.propose(modelInput);
      rawModelOutput = asJsonValue(result.rawOutput);
      const proposals = validateHeadlineProposalOutput(result.output, items);
      const run = await this.repository.completeRun({
        runId: created.id,
        businessId: parsed.businessId,
        approvedDiagnosisId: approved.id,
        diagnosisRunId: approved.analysisRunId,
        rawModelOutput,
        proposals,
      });
      return { run, reused: false };
    } catch (error) {
      const active = await this.repository.getRun(created.id, parsed.businessId);
      if (active?.status === "RUNNING") {
        await this.repository.failRun({
          runId: created.id,
          businessId: parsed.businessId,
          rawModelOutput,
          validationErrors: serializeError(error),
        });
      }
      // No review session is created for a failed run.
      throw new DiagnosisHeadlineAnalysisError(created.id, error);
    }
  }

  async startReview(input: unknown) {
    const parsed = startReviewSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const run = await this.repository.getRun(parsed.proposalRunId, parsed.businessId);
    if (run?.status !== "SUCCEEDED") throw new Error("A successful headline proposal run is required before review");
    return this.repository.startReviewSession(parsed);
  }

  /** Records one headline decision. A correction passes the same checks as a proposal. */
  async reviewHeadline(input: unknown) {
    const parsed = reviewSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const session = await this.repository.getSession(parsed.reviewSessionId, parsed.businessId);
    if (!session) throw new Error("Headline review session not found");
    const { items } = await this.currentTarget(parsed.businessId, session.approvedDiagnosisId);
    const item = items.find((candidate) => candidate.diagnosisItemId === parsed.diagnosisItemId);
    if (!item) throw new Error("That diagnosis item is not part of the approved diagnosis");
    let correctedHeadline: string | null = null;
    if (parsed.decision === "CORRECTED") {
      if (!parsed.correctedHeadline) throw new Error("A corrected headline is required");
      const issues = validateHeadline(parsed.correctedHeadline, item.statement, `${item.itemRef} headline`);
      if (issues.length) throw new DiagnosisHeadlineContractError(issues);
      correctedHeadline = parsed.correctedHeadline;
    } else if (parsed.correctedHeadline !== undefined) {
      throw new Error("Only a CORRECTED decision may carry a corrected headline");
    }
    return this.repository.recordDecision({
      businessId: parsed.businessId,
      reviewSessionId: parsed.reviewSessionId,
      reviewerId: parsed.reviewerId,
      diagnosisItemId: parsed.diagnosisItemId,
      decision: parsed.decision,
      correctedHeadline,
      reason: parsed.reason ?? null,
    });
  }

  /** Explicit human approval of the reviewed headline set. It creates no workflow transition. */
  async approve(input: unknown) {
    const parsed = approveSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const session = await this.repository.getSession(parsed.reviewSessionId, parsed.businessId);
    if (!session) throw new Error("Headline review session not found");
    if (session.status === "OPEN") {
      const proposals = await this.repository.getProposals(session.proposalRunId, parsed.businessId);
      const reviews = await this.repository.getReviews(session.id, parsed.businessId);
      const reviewByItem = new Map(reviews.map((review) => [review.diagnosisItemId, review]));
      const finals = proposals.map((proposal) => {
        const review = reviewByItem.get(proposal.diagnosisItemId);
        if (!review) throw new Error("Every headline requires exactly one decision before the set is approved");
        return { label: `${proposal.itemRef} headline`, headline: effectiveHeadline(proposal, review) };
      });
      const duplicates = duplicateHeadlineIssues(finals);
      if (duplicates.length) throw new DiagnosisHeadlineContractError(duplicates);
    }
    const result = await this.repository.approveSet(parsed);
    if (!result.headlineSet) throw new Error("Approved headline set not found");
    return result.headlineSet;
  }

  /** Read model for the headline review surface. Read-only. */
  async get(businessId: string): Promise<DiagnosisHeadlineViewModel | undefined> {
    const parsed = businessSchema.parse({ businessId });
    const business = await this.repository.getBusiness(parsed.businessId);
    const workflow = await this.repository.getWorkflow(parsed.businessId);
    if (!business || !workflow) return undefined;
    const approved = await this.repository.getCurrentApprovedDiagnosis(parsed.businessId);
    const model: DiagnosisHeadlineViewModel = {
      business: { id: business.id, name: business.name, status: business.status },
      workflowState: workflow.state,
      approved: null,
      native: false,
      items: [],
      run: null,
      failedRuns: [],
      session: null,
      approvedSet: null,
      setHistory: [],
    };
    if (!approved) return model;
    const contract = diagnosisContractForArtifact(approved.artifactVersion);
    model.approved = {
      id: approved.id,
      version: approved.version,
      artifactVersion: approved.artifactVersion,
      approvedBy: approved.approvedBy,
      approvedAt: approved.approvedAt.toISOString(),
    };
    model.native = contract.hasHeadline;
    const items: EffectiveApprovedItem[] = contract.hasHeadline ? [] : effectiveApprovedItems(approved.approvedContent);

    const runs = await this.repository.getRuns(approved.id, parsed.businessId);
    const run = runs.find((candidate) => candidate.status === "SUCCEEDED") ?? runs.find((candidate) => candidate.status === "RUNNING");
    model.failedRuns = runs.filter((candidate) => candidate.status === "FAILED")
      .map((candidate) => ({ id: candidate.id, completedAt: candidate.completedAt?.toISOString() ?? null }));
    if (run) {
      model.run = {
        id: run.id,
        status: run.status,
        promptVersion: run.promptVersion,
        inputProjectionVersion: run.inputProjectionVersion,
        inputHash: run.inputHash,
        provider: run.provider,
        modelIdentifier: run.modelIdentifier,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      };
    }
    const session = await this.repository.getOpenSession(approved.id, parsed.businessId);
    const reviews = session ? await this.repository.getReviews(session.id, parsed.businessId) : [];
    const proposals = run?.status === "SUCCEEDED" ? await this.repository.getProposals(run.id, parsed.businessId) : [];
    const proposalByItem = new Map(proposals.map((proposal) => [proposal.diagnosisItemId, proposal]));
    const reviewByItem = new Map(reviews.map((review) => [review.diagnosisItemId, review]));
    model.items = items.map((item) => {
      const proposal = proposalByItem.get(item.diagnosisItemId);
      const review = reviewByItem.get(item.diagnosisItemId);
      return {
        itemRef: item.itemRef,
        diagnosisItemId: item.diagnosisItemId,
        itemType: item.itemType,
        statement: item.statement,
        proposed: proposal?.headline ?? null,
        decision: review ? { decision: review.decision, correctedHeadline: review.correctedHeadline, reason: review.reason } : null,
        finalHeadline: proposal && review ? effectiveHeadline(proposal, review) : null,
      };
    });
    model.session = session
      ? { id: session.id, reviewerId: session.reviewerId, status: session.status, setVersion: session.setVersion }
      : null;
    const approvedSet = await this.repository.getLatestApprovedSet(approved.id, parsed.businessId);
    model.approvedSet = approvedSet
      ? {
        id: approvedSet.id,
        version: approvedSet.version,
        approvedBy: approvedSet.approvedBy,
        approvedAt: approvedSet.approvedAt.toISOString(),
        proposalRunId: approvedSet.proposalRunId,
        reviewSessionId: approvedSet.reviewSessionId,
        headlines: approvedSet.headlines.map(({ itemRef, headline }) => ({ itemRef, headline })),
      }
      : null;
    model.setHistory = (await this.repository.getApprovedSets(approved.id, parsed.businessId))
      .map((entry) => ({ id: entry.id, version: entry.version, approvedBy: entry.approvedBy, approvedAt: entry.approvedAt.toISOString() }));
    return model;
  }
}

export type DiagnosisHeadlineViewModel = {
  business: { id: string; name: string; status: string };
  workflowState: string;
  approved: { id: string; version: number; artifactVersion: string; approvedBy: string; approvedAt: string } | null;
  /** True when the approved diagnosis carries its own reviewed headlines (v2). */
  native: boolean;
  items: Array<{
    itemRef: string;
    diagnosisItemId: string;
    itemType: string;
    statement: string;
    proposed: string | null;
    decision: { decision: string; correctedHeadline: string | null; reason: string | null } | null;
    finalHeadline: string | null;
  }>;
  run: {
    id: string;
    status: "RUNNING" | "SUCCEEDED" | "FAILED";
    promptVersion: string;
    inputProjectionVersion: string;
    inputHash: string;
    provider: string;
    modelIdentifier: string;
    createdAt: string;
    completedAt: string | null;
  } | null;
  failedRuns: Array<{ id: string; completedAt: string | null }>;
  session: { id: string; reviewerId: string; status: string; setVersion: number } | null;
  approvedSet: {
    id: string; version: number; approvedBy: string; approvedAt: string;
    proposalRunId: string; reviewSessionId: string;
    headlines: Array<{ itemRef: string; headline: string }>;
  } | null;
  setHistory: Array<{ id: string; version: number; approvedBy: string; approvedAt: string }>;
};
