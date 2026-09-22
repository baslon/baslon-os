import "server-only";
import OpenAI from "openai";
import {
  phase1DiagnosisJsonSchemaV2,
  type Phase1DiagnosisModelInput,
} from "@/ai/phase1-diagnosis/contracts";
import type {
  Phase1DiagnosisModel,
  Phase1DiagnosisModelConfiguration,
  Phase1DiagnosisModelResult,
} from "@/ai/phase1-diagnosis/model";
import {
  PHASE1_DIAGNOSIS_PROMPT_V2,
  phase1DiagnosisPromptV2,
} from "@/ai/phase1-diagnosis/prompt";

/** New diagnoses use `phase1_diagnosis_v2`: the v2 prompt and its strict output schema. */

export class OpenAIPhase1DiagnosisModel implements Phase1DiagnosisModel {
  getConfiguration(): Phase1DiagnosisModelConfiguration {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "not_configured",
      promptVersion: PHASE1_DIAGNOSIS_PROMPT_V2,
      metadata: {
        api: "responses",
        promptVersion: PHASE1_DIAGNOSIS_PROMPT_V2,
        structuredOutput: "json_schema_strict",
        store: false,
      },
    };
  }

  async analyse(input: Phase1DiagnosisModelInput): Promise<Phase1DiagnosisModelResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;
    if (!apiKey || !model) throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required to run Phase 1 Diagnosis");
    const response = await new OpenAI({ apiKey, timeout: 120_000, maxRetries: 2 }).responses.create({
      model,
      instructions: phase1DiagnosisPromptV2,
      input: JSON.stringify(input),
      store: false,
      text: { format: {
        type: "json_schema",
        name: PHASE1_DIAGNOSIS_PROMPT_V2,
        schema: phase1DiagnosisJsonSchemaV2,
        strict: true,
      } },
    });
    const rawOutput = response.output_text;
    let output: unknown = rawOutput;
    try { output = JSON.parse(rawOutput); } catch { /* audited by application validation */ }
    return { output, rawOutput };
  }
}
