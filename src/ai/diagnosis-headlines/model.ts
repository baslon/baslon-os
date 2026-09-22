import type { DiagnosisHeadlineModelInput } from "@/ai/diagnosis-headlines/contracts";

export type DiagnosisHeadlineModelConfiguration = {
  provider: string;
  model: string;
  promptVersion: string;
  metadata: Record<string, unknown>;
};

export type DiagnosisHeadlineModelResult = { output: unknown; rawOutput: unknown };

export interface DiagnosisHeadlineModel {
  getConfiguration(): DiagnosisHeadlineModelConfiguration;
  propose(input: DiagnosisHeadlineModelInput): Promise<DiagnosisHeadlineModelResult>;
}
