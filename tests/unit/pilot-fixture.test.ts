import { describe, expect, it } from "vitest";
import {
  businessUsages,
  DEFAULT_BUSINESS_USAGE,
  evaluateFixtureInstanceEligibility,
  fixtureInstanceStatuses,
  fixtureResetStates,
  fixtureTemplateStatuses,
  isLegalInstanceStatusTransition,
  isLegalResetStateTransition,
  isLegalTemplateStatusTransition,
  isProtectedBusinessUsage,
  isTerminalResetState,
  protectedBusinessUsages,
  registerFixtureTemplateSchema,
  selfAssignableBusinessUsages,
  type FixtureEligibilityInput,
} from "@/domain/pilot-fixture";

describe("business usage classification", () => {
  it("defines exactly the four approved values with a safe default", () => {
    expect([...businessUsages]).toEqual([
      "LIVE", "SYNTHETIC_TEST", "PILOT_FIXTURE_TEMPLATE", "PILOT_FIXTURE_INSTANCE",
    ]);
    expect(DEFAULT_BUSINESS_USAGE).toBe("LIVE");
    // The default must itself be assignable by an ordinary create.
    expect(selfAssignableBusinessUsages).toContain(DEFAULT_BUSINESS_USAGE);
  });

  it("separates the self-assignable values from the protected ones exhaustively", () => {
    expect([...selfAssignableBusinessUsages]).toEqual(["LIVE", "SYNTHETIC_TEST"]);
    expect([...protectedBusinessUsages]).toEqual([
      "PILOT_FIXTURE_TEMPLATE", "PILOT_FIXTURE_INSTANCE",
    ]);
    // Every usage is in exactly one of the two sets: a new value cannot be silently
    // self-assignable just because nobody classified it.
    for (const usage of businessUsages) {
      const selfAssignable = (selfAssignableBusinessUsages as readonly string[]).includes(usage);
      expect(selfAssignable).toBe(!isProtectedBusinessUsage(usage));
    }
  });
});

describe("template lifecycle", () => {
  it("permits only ACTIVE to RETIRED", () => {
    expect(isLegalTemplateStatusTransition("ACTIVE", "RETIRED")).toBe(true);
    expect(isLegalTemplateStatusTransition("RETIRED", "ACTIVE")).toBe(false);
    expect(isLegalTemplateStatusTransition("ACTIVE", "ACTIVE")).toBe(false);
    expect(isLegalTemplateStatusTransition("RETIRED", "RETIRED")).toBe(false);
  });

  it("leaves RETIRED terminal for every declared status", () => {
    for (const to of fixtureTemplateStatuses) {
      expect(isLegalTemplateStatusTransition("RETIRED", to)).toBe(false);
    }
  });
});

describe("instance lifecycle", () => {
  it("treats DISPOSED and FAILED_CREATION as terminal", () => {
    expect(isLegalInstanceStatusTransition("ACTIVE", "DISPOSED")).toBe(true);
    expect(isLegalInstanceStatusTransition("ACTIVE", "FAILED_CREATION")).toBe(true);
    for (const from of ["DISPOSED", "FAILED_CREATION"] as const) {
      for (const to of fixtureInstanceStatuses) {
        expect(isLegalInstanceStatusTransition(from, to)).toBe(false);
      }
    }
  });
});

describe("reset state machine", () => {
  it("walks the happy path one step at a time", () => {
    const path = ["REQUESTED", "DISPOSING", "RECREATING", "VERIFYING", "SUCCEEDED"] as const;
    for (let index = 0; index < path.length - 1; index += 1) {
      expect(isLegalResetStateTransition(path[index], path[index + 1])).toBe(true);
    }
    // No skipping: a reset cannot jump straight to success.
    expect(isLegalResetStateTransition("REQUESTED", "SUCCEEDED")).toBe(false);
    expect(isLegalResetStateTransition("REQUESTED", "RECREATING")).toBe(false);
    expect(isLegalResetStateTransition("DISPOSING", "VERIFYING")).toBe(false);
  });

  it("allows FAILED from every non-terminal state", () => {
    for (const state of fixtureResetStates) {
      if (isTerminalResetState(state)) continue;
      expect(isLegalResetStateTransition(state, "FAILED")).toBe(true);
    }
  });

  it("freezes terminal states", () => {
    expect(isTerminalResetState("SUCCEEDED")).toBe(true);
    expect(isTerminalResetState("FAILED")).toBe(true);
    expect(isTerminalResetState("REQUESTED")).toBe(false);
    for (const from of ["SUCCEEDED", "FAILED"] as const) {
      for (const to of fixtureResetStates) {
        expect(isLegalResetStateTransition(from, to)).toBe(false);
      }
    }
  });

  it("never allows a reset to move backwards", () => {
    const order = ["REQUESTED", "DISPOSING", "RECREATING", "VERIFYING", "SUCCEEDED"] as const;
    for (let to = 0; to < order.length; to += 1) {
      for (let from = to; from < order.length; from += 1) {
        expect(isLegalResetStateTransition(order[from], order[to])).toBe(false);
      }
    }
  });
});

describe("fixture eligibility", () => {
  const eligible: FixtureEligibilityInput = {
    businessUsage: "PILOT_FIXTURE_INSTANCE",
    businessStatus: "active",
    instance: { status: "ACTIVE", verificationPassed: true, businessId: "business-1" },
    template: { status: "ACTIVE", templateVersion: 3 },
    instanceTemplateVersion: 3,
  };

  it("accepts a verified active instance of a recognised template version", () => {
    const result = evaluateFixtureInstanceEligibility(eligible);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("requires the classification, not merely the structure", () => {
    for (const usage of ["LIVE", "SYNTHETIC_TEST", "PILOT_FIXTURE_TEMPLATE"] as const) {
      const result = evaluateFixtureInstanceEligibility({ ...eligible, businessUsage: usage });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain("business_usage_not_pilot_fixture_instance");
    }
  });

  it("requires the structure, not merely the classification", () => {
    const noMetadata = evaluateFixtureInstanceEligibility({
      ...eligible, instance: null, template: null, instanceTemplateVersion: null,
    });
    expect(noMetadata.eligible).toBe(false);
    expect(noMetadata.reasons).toContain("fixture_instance_metadata_missing");
    expect(noMetadata.reasons).toContain("fixture_template_missing");
  });

  it("refuses an unverified instance", () => {
    const result = evaluateFixtureInstanceEligibility({
      ...eligible,
      instance: { status: "ACTIVE", verificationPassed: false, businessId: "business-1" },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("clone_verification_not_passed");
  });

  it("refuses a disposed, failed or detached instance", () => {
    for (const status of ["DISPOSED", "FAILED_CREATION"] as const) {
      const result = evaluateFixtureInstanceEligibility({
        ...eligible,
        instance: { status, verificationPassed: true, businessId: "business-1" },
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain("fixture_instance_not_active");
    }
    const detached = evaluateFixtureInstanceEligibility({
      ...eligible,
      instance: { status: "ACTIVE", verificationPassed: true, businessId: null },
    });
    expect(detached.eligible).toBe(false);
    expect(detached.reasons).toContain("fixture_instance_business_detached");
  });

  it("refuses an archived Business and an unrecognised template version", () => {
    const archived = evaluateFixtureInstanceEligibility({ ...eligible, businessStatus: "archived" });
    expect(archived.reasons).toContain("business_not_active");

    const mismatched = evaluateFixtureInstanceEligibility({
      ...eligible, instanceTemplateVersion: 2,
    });
    expect(mismatched.eligible).toBe(false);
    expect(mismatched.reasons).toContain("template_version_not_recognised");
  });

  it("reports every independent reason at once rather than stopping at the first", () => {
    const result = evaluateFixtureInstanceEligibility({
      businessUsage: "LIVE",
      businessStatus: "archived",
      instance: null,
      template: null,
      instanceTemplateVersion: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "business_usage_not_pilot_fixture_instance",
      "business_not_active",
      "fixture_instance_metadata_missing",
      "fixture_template_missing",
    ]));
  });
});

describe("template registration contract", () => {
  const valid = {
    templateBusinessId: "11111111-1111-4111-8111-111111111111",
    sourceBusinessId: "22222222-2222-4222-8222-222222222222",
    templateVersion: 1,
    sourceApprovedDiagnosisId: "33333333-3333-4333-8333-333333333333",
    sourceApprovedDiagnosisVersion: 1,
    sourceSnapshotId: "44444444-4444-4444-8444-444444444444",
    sourceSnapshotVersion: 1,
    sourceSnapshotContentHash: "hash",
    templateContentFingerprint: "fingerprint",
    createdBy: { actorType: "human" as const, actorId: "admin" },
    approvedBy: { actorType: "human" as const, actorId: "approver" },
  };

  it("accepts a well-formed registration", () => {
    expect(registerFixtureTemplateSchema.parse(valid).templateVersion).toBe(1);
  });

  it("refuses a source and template that are the same Business", () => {
    expect(() => registerFixtureTemplateSchema.parse({
      ...valid, templateBusinessId: valid.sourceBusinessId,
    })).toThrow();
  });

  it("refuses a non-positive version and an AI actor", () => {
    expect(() => registerFixtureTemplateSchema.parse({ ...valid, templateVersion: 0 })).toThrow();
    expect(() => registerFixtureTemplateSchema.parse({
      ...valid, createdBy: { actorType: "ai", actorId: "model" },
    })).toThrow();
  });

  it("refuses blank provenance", () => {
    expect(() => registerFixtureTemplateSchema.parse({
      ...valid, sourceSnapshotContentHash: "   ",
    })).toThrow();
    expect(() => registerFixtureTemplateSchema.parse({
      ...valid, templateContentFingerprint: "",
    })).toThrow();
  });
});
