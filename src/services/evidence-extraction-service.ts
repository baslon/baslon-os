import { z } from "zod";
import {
  evidenceExtractionInputSchema,
  type EvidenceExtractionOutput,
} from "@/ai/evidence-extractor/contracts";
import type { EvidenceExtractionModel } from "@/ai/evidence-extractor/model";
import { evidenceExtractorPromptVersion } from "@/ai/evidence-extractor/prompt";
import {
  EvidenceExtractionBusinessRuleError,
  validateEvidenceExtractionOutput,
} from "@/ai/evidence-extractor/validation";
import type {
  EvidenceExtractionRepository,
  ExtractionProposalRecord,
  ExtractionRunStart,
} from "@/repositories/evidence-extraction-repository";
import { EvidenceExtractionFailedError } from "@/domain/evidence-extraction-error";

function serializeError(error: unknown): unknown[] {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message,
    }));
  }
  if (error instanceof EvidenceExtractionBusinessRuleError) {
    return error.issues.map((message) => ({ code: "business_rule", message }));
  }
  return [{
    code: "extraction_error",
    message: error instanceof Error ? error.message : "Unknown extraction error",
  }];
}

function asJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function toProposalRecords(output: EvidenceExtractionOutput): ExtractionProposalRecord[] {
  return [
    ...output.claims.map((item) => ({
      proposalRef: item.proposalRef,
      proposalType: "claim" as const,
      structuredPayload: item,
    })),
    ...output.evidence.map((item) => ({
      proposalRef: item.proposalRef,
      proposalType: "evidence" as const,
      structuredPayload: item,
    })),
    ...output.metrics.map((item) => ({
      proposalRef: item.proposalRef,
      proposalType: "metric" as const,
      structuredPayload: item,
    })),
    ...output.relationships.map((item) => ({
      proposalRef: item.proposalRef,
      proposalType: "claim_evidence" as const,
      structuredPayload: item,
    })),
  ];
}

export class EvidenceExtractionService {
  constructor(
    private readonly repository: EvidenceExtractionRepository,
    private readonly model: EvidenceExtractionModel,
  ) {}

  prepare(input: unknown) {
    const parsed = evidenceExtractionInputSchema.parse(input);
    const modelInput = {
      rawIntakeText: parsed.rawIntakeText,
      sourceType: parsed.sourceType,
      sourceReference: parsed.sourceReference,
      sourceMetadata: parsed.sourceMetadata,
      interpretiveContext: parsed.interpretiveContext,
    };
    const configuration = this.model.getConfiguration(modelInput);
    const promptVersion = configuration.promptVersion
      ?? evidenceExtractorPromptVersion(Boolean(parsed.interpretiveContext));
    const sourceMetadata = parsed.interpretiveContext
      ? { ...parsed.sourceMetadata, interpretiveContext: parsed.interpretiveContext }
      : parsed.sourceMetadata;
    const runStart: ExtractionRunStart = {
      businessId: parsed.businessId,
      sourceSubmissionId: parsed.sourceSubmissionId,
      rawIntakeText: parsed.rawIntakeText,
      sourceType: parsed.sourceType,
      sourceReference: parsed.sourceReference,
      sourceMetadata,
      promptVersion,
      provider: configuration.provider,
      model: configuration.model,
      modelConfiguration: configuration.metadata,
    };
    return { parsed, modelInput, runStart };
  }

  async extract(input: unknown) {
    const prepared = this.prepare(input);
    await this.repository.assertBusinessActive(prepared.parsed.businessId);
    const run = await this.repository.createRun(prepared.runStart);
    return this.executePrepared(run, prepared);
  }

  async executePrepared(
    run: Awaited<ReturnType<EvidenceExtractionRepository["createRun"]>>,
    prepared: ReturnType<EvidenceExtractionService["prepare"]>,
  ) {
    let rawModelOutput: unknown = null;
    let output: ReturnType<typeof validateEvidenceExtractionOutput>;
    let completedRun: Awaited<ReturnType<EvidenceExtractionRepository["completeRun"]>>;
    try {
      const result = await this.model.extract(prepared.modelInput);
      rawModelOutput = asJsonValue(result.rawOutput);
      output = validateEvidenceExtractionOutput(
        result.output,
        prepared.parsed.rawIntakeText,
      );
      completedRun = await this.repository.completeRun({
        runId: run.id,
        businessId: prepared.parsed.businessId,
        rawModelOutput,
        proposals: toProposalRecords(output),
      });
    } catch (error) {
      await this.repository.failRun({
        runId: run.id,
        businessId: prepared.parsed.businessId,
        rawModelOutput,
        validationErrors: serializeError(error),
      });
      throw new EvidenceExtractionFailedError(run.id, error);
    }
    return {
      run: completedRun,
      output,
      proposals: await this.repository.getProposals(run.id, prepared.parsed.businessId),
    };
  }

  getRun(runId: string, businessId: string) {
    return this.repository.getRun(runId, businessId);
  }

  getLatestRun(businessId: string) {
    return this.repository.getLatestRun(businessId);
  }

  failStaleRun(runId: string, businessId: string, staleBefore: Date, validationErrors: unknown[]) {
    return this.repository.failStaleRun({ runId, businessId, staleBefore, validationErrors });
  }
}
