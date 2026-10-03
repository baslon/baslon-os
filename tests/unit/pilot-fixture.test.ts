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
  legalResetRecoveryTargets,
  resetStateAcceptsReplacementBinding,
  resetStateRequiresVerifiedReplacement,
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

  it("allows FAILED from every progress state", () => {
    // FAILED itself is excluded: a failed operation re-enters the machine towards
    // disposal or recreation, it does not fail again in place.
    for (const state of fixtureResetStates) {
      if (isTerminalResetState(state) || state === "FAILED") continue;
      expect(isLegalResetStateTransition(state, "FAILED")).toBe(true);
    }
  });

  it("freezes SUCCEEDED but leaves FAILED recoverable", () => {
    // Review finding R3: this test previously asserted that FAILED was terminal, which is
    // the defect itself -- architecture section 16 requires retry under the same operation
    // id once the cause is resolved. SUCCEEDED remains terminal.
    expect(isTerminalResetState("SUCCEEDED")).toBe(true);
    expect(isTerminalResetState("FAILED")).toBe(false);
    expect(isTerminalResetState("REQUESTED")).toBe(false);
    for (const to of fixtureResetStates) {
      expect(isLegalResetStateTransition("SUCCEEDED", to)).toBe(false);
    }
    expect(isLegalResetStateTransition("FAILED", "DISPOSING")).toBe(true);
    expect(isLegalResetStateTransition("FAILED", "RECREATING")).toBe(true);
    // But never straight to success, and never back to the start.
    expect(isLegalResetStateTransition("FAILED", "SUCCEEDED")).toBe(false);
    expect(isLegalResetStateTransition("FAILED", "REQUESTED")).toBe(false);
    expect(isLegalResetStateTransition("FAILED", "VERIFYING")).toBe(false);
  });

  it("routes recovery by whether disposal committed", () => {
    // Pre-disposal failure retries the whole operation; post-disposal failure may only
    // recreate, so a graph that is already gone is never disposed twice.
    expect([...legalResetRecoveryTargets(false)]).toEqual(["DISPOSING"]);
    expect([...legalResetRecoveryTargets(true)]).toEqual(["RECREATING"]);
  });

  it("requires verification before SUCCEEDED, not before VERIFYING", () => {
    // Amendment section 2: a replacement is bound before it is verified, because
    // verification happens during VERIFYING.
    expect(resetStateRequiresVerifiedReplacement("SUCCEEDED")).toBe(true);
    expect(resetStateRequiresVerifiedReplacement("VERIFYING")).toBe(false);
    expect(resetStateRequiresVerifiedReplacement("RECREATING")).toBe(false);
    expect(resetStateAcceptsReplacementBinding("RECREATING")).toBe(true);
    expect(resetStateAcceptsReplacementBinding("VERIFYING")).toBe(true);
    expect(resetStateAcceptsReplacementBinding("REQUESTED")).toBe(false);
    expect(resetStateAcceptsReplacementBinding("DISPOSING")).toBe(false);
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
    templateContentFingerprint: "fingerprint",
  };

  it("accepts a well-formed registration without any actor input", () => {
    // Review finding R2: the contract no longer carries createdBy/approvedBy. The
    // executing actor is derived from the verified authority, and the historical source
    // approval is read from the stored Diagnosis.
    expect(registerFixtureTemplateSchema.parse(valid).templateVersion).toBe(1);
  });

  it("rejects a caller-supplied actor outright rather than ignoring it", () => {
    expect(() => registerFixtureTemplateSchema.parse({
      ...valid, createdBy: { actorType: "human", actorId: "bob" },
    })).toThrow();
    expect(() => registerFixtureTemplateSchema.parse({
      ...valid, approvedBy: { actorType: "human", actorId: "bob" },
    })).toThrow();
  });

  it("treats the source Snapshot hash as an optional cross-check only", () => {
    // Review finding R6: the stored hash is always derived from the Snapshot, so the
    // contract cannot require one and must not treat a supplied value as authoritative.
    expect(registerFixtureTemplateSchema.parse(valid).expectedSourceSnapshotContentHash)
      .toBeUndefined();
    expect(registerFixtureTemplateSchema.parse({
      ...valid, expectedSourceSnapshotContentHash: "sha256-abc",
    }).expectedSourceSnapshotContentHash).toBe("sha256-abc");
  });

  it("refuses a non-positive version and blank provenance", () => {
    expect(() => registerFixtureTemplateSchema.parse({ ...valid, templateVersion: 0 })).toThrow();
    expect(() => registerFixtureTemplateSchema.parse({
      ...valid, templateContentFingerprint: "",
    })).toThrow();
  });
});
