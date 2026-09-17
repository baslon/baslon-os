import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InformationForm } from "../../app/information-form";
import { resolveTransition } from "@/domain/workflow";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), retry: vi.fn() }));
vi.mock("@/foundation", () => ({ getAddInformationService: () => mocks }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
import { addInformationAction } from "../../app/actions";

describe("Add Information UI and action", () => {
  it("renders required text and explicit analysis; retry preserves a read-only source", () => {
    const html = renderToStaticMarkup(createElement(InformationForm, { businessId: "business", action: async () => {} }));
    expect(html).toContain('name="rawText"');
    expect(html).toContain("required");
    expect(html).toContain("Analyse Information");
    const retry = renderToStaticMarkup(createElement(InformationForm, { businessId: "business", action: async () => {}, retry: { id: "run", rawIntakeText: "Original source", sourceReference: "Meeting" } }));
    expect(retry).toContain("Original source");
    expect(retry).toContain("readOnly");
    expect(retry).toContain('name="runId"');
    expect(retry).not.toContain('name="rawText"');
  });

  it("shows a generated question as read-only context and keeps the human answer blank", () => {
    const html = renderToStaticMarkup(createElement(InformationForm, {
      businessId: "business", action: async () => {},
      question: { id: "question", questionText: "How many active clients are there?" },
    }));
    expect(html).toContain("Question Baslon OS is asking");
    expect(html).toContain("How many active clients are there?");
    expect(html).toContain("The question provides context only");
    expect(html).toContain('name="questionId" value="question"');
    expect(html).toContain("Your information");
    expect(html).not.toContain("How many active clients are there?</textarea>");
  });

  it("routes fresh submissions and retries to distinct service operations", async () => {
    mocks.submit.mockResolvedValue({ run: { id: "new-run" } });
    mocks.retry.mockResolvedValue({ run: { id: "retry-run" } });
    const form = new FormData();
    form.set("businessId", "business");
    form.set("rawText", "New notes");
    await expect(addInformationAction(form)).rejects.toThrow("/businesses/business/reviews/new-run");
    expect(mocks.submit).toHaveBeenCalledWith({ businessId: "business", rawText: "New notes", sourceReference: undefined, questionId: undefined });
    form.set("questionId", "11111111-1111-4111-8111-111111111111");
    await expect(addInformationAction(form)).rejects.toThrow("/businesses/business/reviews/new-run");
    expect(mocks.submit).toHaveBeenLastCalledWith({
      businessId: "business", rawText: "New notes", sourceReference: undefined,
      questionId: "11111111-1111-4111-8111-111111111111",
    });
    form.set("runId", "failed-run");
    form.set("rawText", "Tampered retry text");
    await expect(addInformationAction(form)).rejects.toThrow("/businesses/business/reviews/retry-run");
    expect(mocks.retry).toHaveBeenCalledWith({ businessId: "business", runId: "failed-run" });
  });

  it("keeps the repeat transition human-only", () => {
    expect(resolveTransition("EVIDENCE_READY", "ADD_EVIDENCE", "human")).toBe("EVIDENCE_PROCESSING");
    for (const actor of ["ai", "system"] as const) {
      expect(() => resolveTransition("EVIDENCE_READY", "ADD_EVIDENCE", actor)).toThrow("requires a human");
    }
  });
});
