import "server-only";
import OpenAI from "openai";
import {
  diagnosisHeadlinesJsonSchema,
  type DiagnosisHeadlineModelInput,
} from "@/ai/diagnosis-headlines/contracts";
import type {
  DiagnosisHeadlineModel,
  DiagnosisHeadlineModelConfiguration,
  DiagnosisHeadlineModelResult,
} from "@/ai/diagnosis-headlines/model";
import {
  DIAGNOSIS_HEADLINES_PROMPT_VERSION,
  diagnosisHeadlinesPrompt,
} from "@/ai/diagnosis-headlines/prompt";

export class OpenAIDiagnosisHeadlineModel implements DiagnosisHeadlineModel {
  getConfiguration(): DiagnosisHeadlineModelConfiguration {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "not_configured",
      promptVersion: DIAGNOSIS_HEADLINES_PROMPT_VERSION,
      metadata: {
        api: "responses",
        promptVersion: DIAGNOSIS_HEADLINES_PROMPT_VERSION,
        structuredOutput: "json_schema_strict",
        store: false,
      },
    };
  }

  async propose(input: DiagnosisHeadlineModelInput): Promise<DiagnosisHeadlineModelResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;
    if (!apiKey || !model) throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required to propose diagnosis headlines");
    const response = await new OpenAI({ apiKey, timeout: 120_000, maxRetries: 2 }).responses.create({
      model,
      instructions: diagnosisHeadlinesPrompt,
      input: JSON.stringify(input),
      store: false,
      text: { format: {
        type: "json_schema",
        name: DIAGNOSIS_HEADLINES_PROMPT_VERSION,
        schema: diagnosisHeadlinesJsonSchema,
        strict: true,
      } },
    });
    const rawOutput = response.output_text;
    let output: unknown = rawOutput;
    try { output = JSON.parse(rawOutput); } catch { /* audited by application validation */ }
    return { output, rawOutput };
  }
}
