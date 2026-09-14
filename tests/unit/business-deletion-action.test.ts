import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permanentlyDelete: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/foundation", () => ({
  getBusinessService: () => ({ permanentlyDelete: mocks.permanentlyDelete }),
  getEvidenceExtractionService: vi.fn(),
  getEvidenceReviewService: vi.fn(),
  getFactAdmissionService: vi.fn(),
  getStrategyOrchestrator: vi.fn(),
}));

import { permanentlyDeleteBusinessAction } from "../../app/actions";

describe("Permanent Delete server action", () => {
  beforeEach(() => {
    mocks.permanentlyDelete.mockReset();
    mocks.redirect.mockClear();
  });

  it("submits only Business ID and typed confirmation, then redirects to archived Businesses", async () => {
    mocks.permanentlyDelete.mockResolvedValue({ businessId: "7f3a9100-0000-4000-8000-000000000001" });
    const form = new FormData();
    form.set("businessId", "7f3a9100-0000-4000-8000-000000000001");
    form.set("confirmation", "  ABC Consulting  ");

    await expect(permanentlyDeleteBusinessAction(form))
      .rejects.toThrow("REDIRECT:/businesses/archived?deleted=1");
    expect(mocks.permanentlyDelete).toHaveBeenCalledWith({
      businessId: "7f3a9100-0000-4000-8000-000000000001",
      confirmation: "ABC Consulting",
    });
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });
});
