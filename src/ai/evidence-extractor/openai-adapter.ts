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
  EVIDENCE_EXTRACTOR_CONTEXT_PROMPT_VERSION,
  EVIDENCE_EXTRACTOR_PROMPT_VERSION,
  evidenceExtractorContextPrompt,
  evidenceExtractorPrompt,
} from "@/ai/evidence-extractor/prompt";

export class OpenAIEvidenceExtractionModel implements EvidenceExtractionModel {
  getConfiguration(input?: EvidenceExtractionModelInput): EvidenceExtractionModelConfiguration {
    const promptVersion = input?.interpretiveContext
      ? EVIDENCE_EXTRACTOR_CONTEXT_PROMPT_VERSION
      : EVIDENCE_EXTRACTOR_PROMPT_VERSION;
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "not_configured",
      promptVersion,
      metadata: {
        api: "responses",
        promptVersion,
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
    const contextual = Boolean(input.interpretiveContext);
    const promptVersion = contextual
      ? EVIDENCE_EXTRACTOR_CONTEXT_PROMPT_VERSION
      : EVIDENCE_EXTRACTOR_PROMPT_VERSION;
    const response = await client.responses.create({
      model,
      instructions: contextual ? evidenceExtractorContextPrompt : evidenceExtractorPrompt,
      input: JSON.stringify(input),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: promptVersion,
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
