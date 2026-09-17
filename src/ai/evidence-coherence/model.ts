import type { EvidenceCoherenceModelInput } from "@/ai/evidence-coherence/contracts";

export type EvidenceCoherenceModelConfiguration = {
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
};

export type EvidenceCoherenceModelResult = { output: unknown; rawOutput: unknown };

export interface EvidenceCoherenceModel {
  getConfiguration(): EvidenceCoherenceModelConfiguration;
  analyse(input: EvidenceCoherenceModelInput): Promise<EvidenceCoherenceModelResult>;
}
