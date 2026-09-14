import { z } from "zod";
import {
  evidenceExtractionInputSchema,
  type EvidenceExtractionOutput,
} from "@/ai/evidence-extractor/contracts";
import type { EvidenceExtractionModel } from "@/ai/evidence-extractor/model";
import { EVIDENCE_EXTRACTOR_PROMPT_VERSION } from "@/ai/evidence-extractor/prompt";
import {
  EvidenceExtractionBusinessRuleError,
  validateEvidenceExtractionOutput,
} from "@/ai/evidence-extractor/validation";
import type {
  EvidenceExtractionRepository,
  ExtractionProposalRecord,
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

  async extract(input: unknown) {
    const parsed = evidenceExtractionInputSchema.parse(input);
    const configuration = this.model.getConfiguration();
    const run = await this.repository.createRun({
      businessId: parsed.businessId,
      rawIntakeText: parsed.rawIntakeText,
      sourceType: parsed.sourceType,
      sourceReference: parsed.sourceReference,
      sourceMetadata: parsed.sourceMetadata,
      promptVersion: EVIDENCE_EXTRACTOR_PROMPT_VERSION,
      provider: configuration.provider,
      model: configuration.model,
      modelConfiguration: configuration.metadata,
    });

    let rawModelOutput: unknown = null;
    try {
      const result = await this.model.extract({
        rawIntakeText: parsed.rawIntakeText,
        sourceType: parsed.sourceType,
        sourceReference: parsed.sourceReference,
        sourceMetadata: parsed.sourceMetadata,
      });
      rawModelOutput = asJsonValue(result.rawOutput);
      const output = validateEvidenceExtractionOutput(
        result.output,
        parsed.rawIntakeText,
      );
      const completedRun = await this.repository.completeRun({
        runId: run.id,
        businessId: parsed.businessId,
        rawModelOutput,
        proposals: toProposalRecords(output),
      });
      return {
        run: completedRun,
        output,
        proposals: await this.repository.getProposals(run.id, parsed.businessId),
      };
    } catch (error) {
      await this.repository.failRun({
        runId: run.id,
        businessId: parsed.businessId,
        rawModelOutput,
        validationErrors: serializeError(error),
      });
      throw new EvidenceExtractionFailedError(run.id, error);
    }
  }

  getRun(runId: string, businessId: string) {
    return this.repository.getRun(runId, businessId);
  }
}
