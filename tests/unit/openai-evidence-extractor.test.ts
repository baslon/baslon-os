import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIEvidenceExtractionModel } from "@/ai/evidence-extractor/openai-adapter";
import { baslonMessyIntake } from "../fixtures/baslon-business";

describe("OpenAI Evidence Extractor configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails clearly at execution time when live configuration is absent", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
    const model = new OpenAIEvidenceExtractionModel();

    expect(model.getConfiguration()).toMatchObject({
      provider: "openai",
      model: "not_configured",
      promptVersion: "evidence_extractor_v4",
    });
    expect(model.getConfiguration({
      rawIntakeText: "25 active clients",
      sourceMetadata: {},
      interpretiveContext: {
        kind: "analysis_question",
        questionId: "11111111-1111-4111-8111-111111111111",
        questionText: "How many active clients are there?",
      },
    })).toMatchObject({ promptVersion: "evidence_extractor_v5" });
    await expect(model.extract({
      rawIntakeText: baslonMessyIntake,
      sourceMetadata: {},
    })).rejects.toThrow(
      "OPENAI_API_KEY and OPENAI_MODEL are required",
    );
  });
});
