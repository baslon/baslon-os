import { z } from "zod";
import type { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import type { StrategyOrchestrator } from "@/strategy/orchestrator";

const continueSchema = z.object({ businessId: z.uuid() }).strict();

export class GapResolutionService {
  constructor(
    private readonly coherence: EvidenceCoherenceRepository,
    private readonly orchestrator: StrategyOrchestrator,
  ) {}

  /**
   * Records a human decision to begin Phase 1 with the current evidence and its
   * known gaps. Findings stay immutable and are not marked resolved; the
   * workflow transition row is the durable audit of the decision.
   */
  async continueWithGaps(input: unknown) {
    const parsed = continueSchema.parse(input);
    const snapshot = await this.coherence.getLatestSnapshot(parsed.businessId);
    if (!snapshot) throw new Error("A canonical snapshot is required before continuing to Phase 1");
    const run = await this.coherence.getLatestSucceededRunForSnapshot(snapshot.id, parsed.businessId);
    if (!run) throw new Error("The latest snapshot has no successful Evidence Coherence analysis");
    return this.orchestrator.transition({
      businessId: parsed.businessId,
      event: "CONTINUE_WITH_GAPS",
      actorType: "human",
      actorId: "business-user",
      reason: "Human chose to continue to Phase 1 with the current evidence and known gaps",
      metadata: {
        snapshotId: snapshot.id,
        snapshotVersion: snapshot.version,
        analysisRunId: run.id,
        analysisPromptVersion: run.promptVersion,
      },
    });
  }
}
