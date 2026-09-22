import type { Phase1DiagnosisModelInput } from "@/ai/phase1-diagnosis/contracts";

export type Phase1DiagnosisModelConfiguration = {
  provider: string;
  model: string;
  /** The prompt and output contract this model is actually called with; recorded on the run. */
  promptVersion: string;
  metadata: Record<string, unknown>;
};

export type Phase1DiagnosisModelResult = { output: unknown; rawOutput: unknown };

export interface Phase1DiagnosisModel {
  getConfiguration(): Phase1DiagnosisModelConfiguration;
  analyse(input: Phase1DiagnosisModelInput): Promise<Phase1DiagnosisModelResult>;
}
