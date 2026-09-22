import { describe, expect, it } from "vitest";
import { acceptsAddInformation, resolveTransition, transitionRules } from "@/domain/workflow";
import {
  continueWithGapsPrecondition,
  defaultWorkflowTransitionPreconditions,
} from "@/repositories/workflow-preconditions";
import { StrategyOrchestrator, type WorkflowPersistence } from "@/strategy/orchestrator";

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
  });

  it("returns a revision to the evidence loop, never straight to a same-snapshot diagnosis (v1)", () => {
    expect(() => resolveTransition("REVISION_REQUIRED", "GENERATE_PHASE1", "human"))
      .toThrow("Invalid workflow transition: REVISION_REQUIRED + GENERATE_PHASE1");
    expect(resolveTransition("REVISION_REQUIRED", "ADD_EVIDENCE", "human")).toBe("EVIDENCE_PROCESSING");
    expect(acceptsAddInformation("REVISION_REQUIRED")).toBe(true);
    // A fresh diagnosis starts only from PHASE1_READY.
    expect(transitionRules.filter((rule) => rule.event === "GENERATE_PHASE1").map((rule) => rule.from))
      .toEqual(["PHASE1_READY"]);
  });

  it("lets only a human continue with known gaps into PHASE1_READY", () => {
    expect(resolveTransition("GAP_RESOLUTION_REQUIRED", "CONTINUE_WITH_GAPS", "human"))
      .toBe("PHASE1_READY");
    for (const actor of ["system", "ai"] as const) {
      expect(() => resolveTransition("GAP_RESOLUTION_REQUIRED", "CONTINUE_WITH_GAPS", actor))
        .toThrow("requires a human actor");
    }
    for (const state of [
      "NEW", "EVIDENCE_PROCESSING", "EVIDENCE_READY", "GAP_ANALYSIS", "PHASE1_READY",
    ] as const) {
      expect(() => resolveTransition(state, "CONTINUE_WITH_GAPS", "human"))
        .toThrow("Invalid workflow transition");
    }
  });

  it("lets a human add evidence from PHASE1_READY before diagnosis exists", () => {
    expect(resolveTransition("PHASE1_READY", "ADD_EVIDENCE", "human")).toBe("EVIDENCE_PROCESSING");
    for (const actor of ["system", "ai"] as const) {
      expect(() => resolveTransition("PHASE1_READY", "ADD_EVIDENCE", actor))
        .toThrow("requires a human actor");
    }
    expect(acceptsAddInformation("PHASE1_READY")).toBe(true);
  });

  it("defines the Phase 1 entry precondition as an orchestrator default", () => {
    expect(defaultWorkflowTransitionPreconditions.CONTINUE_WITH_GAPS).toBe(continueWithGapsPrecondition);
  });

  it("supports event-specific artifact preconditions without weakening authority", async () => {
    const commits: unknown[] = [];
    const workflow = {
      id: "00000000-0000-4000-8000-000000000001",
      businessId: "00000000-0000-4000-8000-000000000002",
      state: "PHASE1_READY" as const,
      version: 7,
    };
    const repository: WorkflowPersistence = {
      assertBusinessActive: async () => undefined,
      getWorkflow: async () => workflow,
      commit: async (command, precondition) => {
        await precondition?.({
          businessId: command.businessId,
          event: command.event,
          actorType: command.actorType,
          workflow,
          metadata: command.metadata,
          database: {} as never,
        });
        commits.push(command);
        return command;
      },
    };
    let artifactExists = false;
    const orchestrator = new StrategyOrchestrator(repository, {
      GENERATE_PHASE1: () => {
        if (!artifactExists) throw new Error("Required current snapshot artifact is missing");
      },
    });
    const input = {
      businessId: "00000000-0000-4000-8000-000000000002",
      event: "GENERATE_PHASE1",
      actorType: "human",
    } as const;
    await expect(orchestrator.transition(input)).rejects.toThrow("artifact is missing");
    expect(commits).toHaveLength(0);
    artifactExists = true;
    await expect(orchestrator.transition(input)).resolves.toMatchObject({
      fromState: "PHASE1_READY",
      toState: "PHASE1_ANALYSING",
      expectedVersion: 7,
    });
    await expect(orchestrator.transition({ ...input, actorType: "ai" }))
      .rejects.toThrow("requires a human actor");
  });
});
