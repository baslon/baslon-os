import { describe, expect, it } from "vitest";
import { authorizeFactAdmission } from "@/domain/fact-admission";
import {
  deriveHumanAuthority,
  type HumanAuthority,
} from "@/domain/server-authority";

const claim = {
  businessId: "550e8400-e29b-41d4-a716-446655440000",
  statement: "A fact requiring human admission.",
  subjectArea: "economics",
  confidenceLevel: "high",
  sourceType: "accounting_record",
};

describe("fact admission authority", () => {
  it.each(["ai", "system"] as const)("rejects a %s actor", (actorType) => {
    expect(() => deriveHumanAuthority({ actorType, actorId: `${actorType}-1` }))
      .toThrow("server-derived human authority");
  });

  it("rejects a forged human authority object", () => {
    expect(() => authorizeFactAdmission({
      operation: "create",
      claim,
      supportingEvidenceIds: ["550e8400-e29b-41d4-a716-446655440001"],
      authority: { actorId: "forged" } as HumanAuthority,
    })).toThrow("server-derived human authority");
  });

  it("requires supporting Evidence", () => {
    const authority = deriveHumanAuthority({ actorType: "human", actorId: "owner-1" });
    expect(() => authorizeFactAdmission({
      operation: "create",
      claim,
      supportingEvidenceIds: [],
      authority,
    })).toThrow("at least one supporting Evidence");
  });
});
