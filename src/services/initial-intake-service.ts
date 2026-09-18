import { z } from "zod";
import type { EvidenceExtractionService } from "./evidence-extraction-service";
import type { InitialIntakeRepository } from "@/repositories/initial-intake-repository";

const submissionSchema = z.object({
  businessId: z.uuid(),
  rawIntakeText: z.string().trim().min(1, "Enter business information to analyse."),
  sourceReference: z.string().trim().min(1).optional(),
}).strict();

export class InitialIntakeService {
  constructor(
    private readonly repository: InitialIntakeRepository,
    private readonly extraction: EvidenceExtractionService,
  ) {}

  getAvailability(businessId: string) {
    return this.repository.getAvailability(businessId);
  }

  async submit(input: unknown) {
    const parsed = submissionSchema.parse(input);
    const prepared = this.extraction.prepare({
      businessId: parsed.businessId,
      rawIntakeText: parsed.rawIntakeText,
      sourceType: "business_intake",
      sourceReference: parsed.sourceReference,
      sourceMetadata: { suppliedBy: "human_ui" },
    });
    const run = await this.repository.prepare({
      businessId: parsed.businessId,
      runStart: prepared.runStart,
    });
    return this.extraction.executePrepared(run, prepared);
  }
}
