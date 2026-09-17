import type {
  EvidenceExtractionModelInput,
} from "@/ai/evidence-extractor/contracts";

export type EvidenceExtractionModelConfiguration = {
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  promptVersion?: string;
};

export type EvidenceExtractionModelResult = {
  output: unknown;
  rawOutput: unknown;
};

export interface EvidenceExtractionModel {
  getConfiguration(input?: EvidenceExtractionModelInput): EvidenceExtractionModelConfiguration;
  extract(input: EvidenceExtractionModelInput): Promise<EvidenceExtractionModelResult>;
}
