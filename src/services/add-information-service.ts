import { z } from "zod";
import type { SourceSubmissionService } from "./source-submission-service";
import type { EvidenceExtractionService } from "./evidence-extraction-service";
import type { EvidenceReviewService } from "./evidence-review-service";
import type { AddInformationRepository } from "@/repositories/add-information-repository";
import { staleRunCutoff, staleRunValidationErrors } from "@/domain/ai-run-recovery";

const submissionSchema = z.object({
  businessId: z.uuid(),
  rawText: z.string().trim().min(1, "Enter information to analyse."),
  sourceReference: z.string().trim().min(1).optional(),
  questionId: z.uuid().optional(),
}).strict();
const retrySchema = z.object({ businessId: z.uuid(), runId: z.uuid() }).strict();

export class AddInformationService {
  constructor(
    private readonly repository: AddInformationRepository,
    private readonly sources: SourceSubmissionService,
    private readonly extraction: EvidenceExtractionService,
    private readonly reviews: EvidenceReviewService,
  ) {}

  async submit(input: unknown) {
    const parsed = submissionSchema.parse(input);
    const context = parsed.questionId
      ? await this.sources.getQuestionContext(parsed.businessId, parsed.questionId)
      : undefined;
    if (parsed.questionId && !context) {
      throw new Error("Evidence Quality question not found.");
    }
    const prepared = this.extraction.prepare({
      businessId: parsed.businessId,
      rawIntakeText: parsed.rawText,
      sourceType: "additional_text",
      sourceReference: parsed.sourceReference,
      sourceMetadata: { suppliedBy: "human_ui" },
      interpretiveContext: context ? {
        kind: context.kind,
        questionId: context.questionId,
        questionText: context.questionText,
      } : undefined,
    });
    const result = await this.repository.prepare({
      businessId: parsed.businessId,
      rawText: parsed.rawText,
      sourceReference: parsed.sourceReference,
      questionId: parsed.questionId,
      expectedQuestionContext: context,
      runStart: prepared.runStart,
    });
    return this.extraction.executePrepared(result.run, prepared);
  }

  async retry(input: unknown) {
    const parsed = retrySchema.parse(input);
    let run = await this.extraction.getRun(parsed.runId, parsed.businessId);
    const latest = await this.extraction.getLatestRun(parsed.businessId);
    if (run?.status === "RUNNING" && latest?.id === run.id) {
      const recovered = await this.extraction.failStaleRun(
        run.id,
        parsed.businessId,
        staleRunCutoff(),
        staleRunValidationErrors,
      );
      if (!recovered) throw new Error("This analysis is still running and cannot be retried yet.");
      run = recovered;
    }
    if (!run || run.status !== "FAILED" || !run.sourceSubmissionId || latest?.id !== run.id) {
      throw new Error("Only the latest failed Add Information analysis can be retried.");
    }
    if (await this.reviews.getWorkflowState(parsed.businessId) !== "EVIDENCE_PROCESSING") {
      throw new Error("This information is no longer awaiting analysis.");
    }
    const source = await this.sources.getById(parsed.businessId, run.sourceSubmissionId);
    if (!source || source.sourceType !== "additional_text" || !source.rawText?.trim()) {
      throw new Error("Add Information source not found.");
    }
    const context = await this.sources.getQuestionContextForSource(parsed.businessId, source.id);
    return this.extractSource(source, context);
  }

  private extractSource(
    source: NonNullable<Awaited<ReturnType<SourceSubmissionService["getById"]>>>,
    context?: Awaited<ReturnType<SourceSubmissionService["getQuestionContextForSource"]>>,
  ) {
    return this.extraction.extract({
      businessId: source.businessId, sourceSubmissionId: source.id,
      rawIntakeText: source.rawText!, sourceType: source.sourceType,
      sourceReference: source.sourceReference ?? undefined,
      sourceMetadata: { suppliedBy: "human_ui" },
      interpretiveContext: context ? {
        kind: context.kind,
        questionId: context.questionId,
        questionText: context.questionText,
      } : undefined,
    });
  }
}
