import { describe, expect, it } from "vitest";
import { resolveTransition } from "@/domain/workflow";

describe("workflow rules", () => {
  it("advances through valid early states", () => {
    expect(resolveTransition("NEW", "START_INTAKE", "human")).toBe("INTAKE_IN_PROGRESS");
    expect(resolveTransition("INTAKE_READY", "PROCESS_EVIDENCE", "system"))
      .toBe("EVIDENCE_PROCESSING");
  });

  it("rejects invalid transitions", () => {
    expect(() => resolveTransition("NEW", "APPROVE_PHASE1", "human"))
      .toThrow("Invalid workflow transition");
  });

  it("requires human approval and prevents AI authority events", () => {
    expect(() => resolveTransition("PHASE1_AWAITING_REVIEW", "APPROVE_PHASE1", "ai"))
      .toThrow("requires a human actor");
    expect(() => resolveTransition("INTAKE_IN_PROGRESS", "SUBMIT_INTAKE", "ai"))
      .toThrow("requires a human actor");
  });

  it("supports gap and revision loops", () => {
    expect(resolveTransition("GAP_RESOLUTION_REQUIRED", "ADD_EVIDENCE", "human"))
      .toBe("EVIDENCE_PROCESSING");
    expect(resolveTransition("PHASE1_AWAITING_REVIEW", "REQUEST_REVISION", "human"))
      .toBe("REVISION_REQUIRED");
    expect(resolveTransition("REVISION_REQUIRED", "GENERATE_PHASE1", "human"))
      .toBe("PHASE1_ANALYSING");
  });
});
