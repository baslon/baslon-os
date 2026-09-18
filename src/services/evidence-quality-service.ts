import { selectSurfacedQuestions } from "@/domain/evidence-coherence";
import type { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { isAiRunStale } from "@/domain/ai-run-recovery";

export class EvidenceQualityService {
  constructor(private readonly repository: EvidenceCoherenceRepository) {}

  async get(businessId: string) {
    const [business, latestSnapshot, workflow] = await Promise.all([
      this.repository.getBusiness(businessId),
      this.repository.getLatestSnapshot(businessId),
      this.repository.getWorkflow(businessId),
    ]);
    if (!business) throw new Error("Business not found");
    const currentRun = latestSnapshot
      ? await this.repository.getLatestRunForSnapshot(latestSnapshot.id, businessId)
      : undefined;
    const latestRun = currentRun ?? await this.repository.getLatestRunForBusiness(businessId);
    const result = latestRun ? await this.repository.getRunResult(latestRun.id, businessId) : undefined;
    const contradictions = result?.contradictions ?? [];
    const gaps = result?.gaps ?? [];
    const contradictionById = new Map(contradictions.map((item) => [item.id, item]));
    const gapById = new Map(gaps.map((item) => [item.id, item]));
    const questions = (result?.questions ?? []).flatMap((question) => {
      const finding = question.contradictionId
        ? contradictionById.get(question.contradictionId)
        : question.evidenceGapId ? gapById.get(question.evidenceGapId) : undefined;
      return finding ? [{ ...question, finding: {
        materiality: finding.materiality,
        priorityRank: finding.priorityRank,
      } }] : [];
    });
    return {
      business,
      workflow,
      latestSnapshot,
      analysis: result,
      canRecoverAnalysis: Boolean(
        latestRun?.status === "RUNNING" && isAiRunStale(latestRun.createdAt),
      ),
      isHistorical: Boolean(latestRun && latestSnapshot && latestRun.inputSnapshotId !== latestSnapshot.id),
      surfacedQuestions: selectSurfacedQuestions(questions),
    };
  }
}
