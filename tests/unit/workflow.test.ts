import { describe, expect, it } from "vitest";
import { resolveTransition } from "@/domain/workflow";
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
    expect(resolveTransition("REVISION_REQUIRED", "GENERATE_PHASE1", "human"))
      .toBe("PHASE1_ANALYSING");
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
