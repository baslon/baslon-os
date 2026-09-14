import { describe, expect, it } from "vitest";
import {
  deriveBusinessDeletionConfirmation,
  displayDomain,
  type DeletionConfirmationBusiness,
} from "@/domain/business-deletion";

function business(overrides: Partial<DeletionConfirmationBusiness> = {}): DeletionConfirmationBusiness {
  return {
    id: "7f3a9100-0000-4000-8000-000000000001",
    name: "ABC Consulting",
    websiteUrl: null,
    legalName: null,
    primaryGeography: null,
    profileData: {},
    status: "archived",
    archivedAt: new Date("2026-09-14"),
    ...overrides,
  };
}

describe("Business deletion confirmation", () => {
  it("uses the exact Business name when it is unique", () => {
    const target = business();
    expect(deriveBusinessDeletionConfirmation(target, [target])).toEqual({
      phrase: "ABC Consulting",
      duplicateName: false,
      disambiguator: null,
      reference: null,
    });
  });

  it("uses the shortest preferred unique duplicate-name disambiguator", () => {
    const target = business({ websiteUrl: "https://www.abcconsulting.co.uk/about", legalName: "ABC One Ltd" });
    const other = business({ id: "8f3a9100-0000-4000-8000-000000000002", websiteUrl: "https://abc.com", legalName: "ABC Two Ltd" });
    const result = deriveBusinessDeletionConfirmation(target, [target, other]);
    expect(result.phrase).toBe("ABC Consulting — abcconsulting.co.uk");
    expect(result.duplicateName).toBe(true);
    expect(displayDomain(target.websiteUrl)).toBe("abcconsulting.co.uk");
  });

  it("falls through legal name, geography, and stable profile data", () => {
    const other = business({ id: "8f3a9100-0000-4000-8000-000000000002" });
    expect(deriveBusinessDeletionConfirmation(
      business({ legalName: "ABC Holdings Ltd" }),
      [business({ legalName: "ABC Holdings Ltd" }), other],
    ).phrase).toBe("ABC Consulting — ABC Holdings Ltd");
    expect(deriveBusinessDeletionConfirmation(
      business({ primaryGeography: "London, UK" }),
      [business({ primaryGeography: "London, UK" }), other],
    ).phrase).toBe("ABC Consulting — London, UK");
    expect(deriveBusinessDeletionConfirmation(
      business({ profileData: { company_number: "12345678" } }),
      [business({ profileData: { company_number: "12345678" } }), other],
    ).phrase).toBe("ABC Consulting — 12345678");
  });

  it("generates deterministic collision-aware fallback references without a full UUID", () => {
    const target = business();
    const other = business({ id: "7f3a9100-9999-4000-8000-000000000002" });
    const result = deriveBusinessDeletionConfirmation(target, [target, other]);
    expect(result.reference).toBe("7F3A91000");
    expect(result.phrase).toBe("ABC Consulting — Ref 7F3A91000");
    expect(result.phrase).not.toContain(target.id);
    expect(deriveBusinessDeletionConfirmation(target, [target, other])).toEqual(result);
  });
});
