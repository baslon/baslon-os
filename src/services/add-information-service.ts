import { z } from "zod";
import type { SourceSubmissionService } from "./source-submission-service";
import type { EvidenceExtractionService } from "./evidence-extraction-service";
import type { EvidenceReviewService } from "./evidence-review-service";
import type { StrategyOrchestrator } from "@/strategy/orchestrator";

const submissionSchema = z.object({
  businessId: z.uuid(),
  rawText: z.string().trim().min(1, "Enter information to analyse."),
  sourceReference: z.string().trim().min(1).optional(),
}).strict();
const retrySchema = z.object({ businessId: z.uuid(), runId: z.uuid() }).strict();

export class AddInformationService {
  constructor(
    private readonly sources: SourceSubmissionService,
    private readonly extraction: EvidenceExtractionService,
    private readonly reviews: EvidenceReviewService,
    private readonly orchestrator: StrategyOrchestrator,
  ) {}

  async submit(input: unknown) {
    const parsed = submissionSchema.parse(input);
    if (await this.reviews.getWorkflowState(parsed.businessId) !== "EVIDENCE_READY") {
      throw new Error("Complete the current Evidence Review before adding information.");
    }
    const source = await this.sources.create({ ...parsed, sourceType: "additional_text" });
    await this.orchestrator.transition({
      businessId: parsed.businessId, event: "ADD_EVIDENCE", actorType: "human",
      actorId: "business-user", metadata: { sourceSubmissionId: source.id },
    });
    return this.extractSource(source);
  }

  async retry(input: unknown) {
    const parsed = retrySchema.parse(input);
    const run = await this.extraction.getRun(parsed.runId, parsed.businessId);
    const latest = await this.extraction.getLatestRun(parsed.businessId);
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
    return this.extractSource(source);
  }

  private extractSource(source: NonNullable<Awaited<ReturnType<SourceSubmissionService["getById"]>>>) {
    return this.extraction.extract({
      businessId: source.businessId, sourceSubmissionId: source.id,
      rawIntakeText: source.rawText!, sourceType: source.sourceType,
      sourceReference: source.sourceReference ?? undefined,
      sourceMetadata: { suppliedBy: "human_ui" },
    });
  }
}
