import type {
  EvidenceExtractionModelInput,
} from "@/ai/evidence-extractor/contracts";

export type EvidenceExtractionModelConfiguration = {
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
};

export type EvidenceExtractionModelResult = {
  output: unknown;
  rawOutput: unknown;
};

export interface EvidenceExtractionModel {
  getConfiguration(): EvidenceExtractionModelConfiguration;
  extract(input: EvidenceExtractionModelInput): Promise<EvidenceExtractionModelResult>;
}
