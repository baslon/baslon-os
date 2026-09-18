import "server-only";
import OpenAI from "openai";
import {
  evidenceCoherenceJsonSchema,
  type EvidenceCoherenceModelInput,
} from "@/ai/evidence-coherence/contracts";
import type {
  EvidenceCoherenceModel,
  EvidenceCoherenceModelConfiguration,
  EvidenceCoherenceModelResult,
} from "@/ai/evidence-coherence/model";
import {
  EVIDENCE_COHERENCE_PROMPT_VERSION,
  evidenceCoherencePrompt,
} from "@/ai/evidence-coherence/prompt";

export class OpenAIEvidenceCoherenceModel implements EvidenceCoherenceModel {
  getConfiguration(): EvidenceCoherenceModelConfiguration {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "not_configured",
      metadata: {
        api: "responses",
        promptVersion: EVIDENCE_COHERENCE_PROMPT_VERSION,
        structuredOutput: "json_schema_strict",
        store: false,
      },
    };
  }

  async analyse(input: EvidenceCoherenceModelInput): Promise<EvidenceCoherenceModelResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;
    if (!apiKey || !model) throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required to run Evidence Coherence analysis");
    const response = await new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 }).responses.create({
      model,
      instructions: evidenceCoherencePrompt,
      input: JSON.stringify(input),
      store: false,
      text: { format: {
        type: "json_schema",
        name: EVIDENCE_COHERENCE_PROMPT_VERSION,
        schema: evidenceCoherenceJsonSchema,
        strict: true,
      } },
    });
    const rawOutput = response.output_text;
    let output: unknown = rawOutput;
    try { output = JSON.parse(rawOutput); } catch { /* audited by application validation */ }
    return { output, rawOutput };
  }
}
