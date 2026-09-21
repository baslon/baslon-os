import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIEvidenceCoherenceModel } from "@/ai/evidence-coherence/openai-adapter";

describe("OpenAI Evidence Coherence configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes the versioned strict-output configuration and fails clearly without live credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
    const model = new OpenAIEvidenceCoherenceModel();

    expect(model.getConfiguration()).toEqual({
      provider: "openai",
      model: "not_configured",
      metadata: {
        api: "responses",
        promptVersion: "evidence_coherence_v4",
        structuredOutput: "json_schema_strict",
        store: false,
      },
    });
    await expect(model.analyse({
      projectionVersion: "evidence_coherence_input_v3",
      snapshot: {
        snapshotVersion: 1,
        profile: {},
        claims: [],
        evidence: [],
        metrics: [],
        relationships: [],
      },
    })).rejects.toThrow("OPENAI_API_KEY and OPENAI_MODEL are required");
  });
});
