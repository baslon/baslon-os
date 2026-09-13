import "server-only";
import OpenAI from "openai";
import {
  evidenceExtractionJsonSchema,
  type EvidenceExtractionModelInput,
} from "@/ai/evidence-extractor/contracts";
import type {
  EvidenceExtractionModel,
  EvidenceExtractionModelConfiguration,
  EvidenceExtractionModelResult,
} from "@/ai/evidence-extractor/model";
import {
  EVIDENCE_EXTRACTOR_PROMPT_VERSION,
  evidenceExtractorPrompt,
} from "@/ai/evidence-extractor/prompt";

export class OpenAIEvidenceExtractionModel implements EvidenceExtractionModel {
  getConfiguration(): EvidenceExtractionModelConfiguration {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "not_configured",
      metadata: {
        api: "responses",
        promptVersion: EVIDENCE_EXTRACTOR_PROMPT_VERSION,
        structuredOutput: "json_schema_strict",
        store: false,
      },
    };
  }

  async extract(
    input: EvidenceExtractionModelInput,
  ): Promise<EvidenceExtractionModelResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;
    if (!apiKey || !model) {
      throw new Error(
        "OPENAI_API_KEY and OPENAI_MODEL are required to run evidence extraction",
      );
    }

    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model,
      instructions: evidenceExtractorPrompt,
      input: JSON.stringify(input),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: EVIDENCE_EXTRACTOR_PROMPT_VERSION,
          schema: evidenceExtractionJsonSchema,
          strict: true,
        },
      },
    });
    const rawOutput = response.output_text;
    let output: unknown = rawOutput;
    try {
      output = JSON.parse(rawOutput);
    } catch {
      // The application validator will reject and audit non-JSON output.
    }
    return { output, rawOutput };
  }
}
