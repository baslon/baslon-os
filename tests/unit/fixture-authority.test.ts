import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFixtureAdminCapability,
  assertHumanFixtureActor,
  executingActor,
  resolveFixtureAdminAuthority,
  type FixtureAdminAuthority,
} from "@/domain/fixture-authority";
import {
  FixturePrincipalInvalidError,
  FixturePrincipalUnavailableError,
  capabilitiesForPrincipal,
  registerTrustedPrincipal,
  resolveProductionPrincipal,
  type FixtureAdminPrincipal,
} from "@/domain/fixture-principal";
import { testFixtureAuthority, testFixturePrincipal } from "../helpers/fixture-admin-principal";

/**
 * Review finding R1: administrative authority used to be self-issued — any importing
 * module could supply a plain actor context and its own capability list. These tests fix
 * the corrected boundary: capabilities come from policy, principals carry runtime
 * provenance, and production issuance fails closed.
 */
describe("fixture administrative principal", () => {
  it("derives capabilities from policy, never from the caller", () => {
    expect(capabilitiesForPrincipal(testFixturePrincipal("fixture_template_administrator")))
      .toEqual(["template_admin"]);
    expect(capabilitiesForPrincipal(testFixturePrincipal("fixture_instance_administrator")))
      .toEqual(["instance_admin"]);
    expect(capabilitiesForPrincipal(testFixturePrincipal("fixture_reset_administrator")))
      .toEqual(["reset_admin"]);
    expect([...capabilitiesForPrincipal(testFixturePrincipal("fixture_administrator"))].sort())
      .toEqual(["instance_admin", "reset_admin", "template_admin"]);
  });

  it("refuses a principal that was never issued by a trusted source", () => {
    // Structurally valid and completely untrusted. A type cannot carry provenance.
    const forged = {
      actorType: "human", actorId: "attacker", role: "fixture_administrator",
    } as FixtureAdminPrincipal;
    expect(() => capabilitiesForPrincipal(forged)).toThrow(FixturePrincipalInvalidError);
    expect(() => resolveFixtureAdminAuthority(forged)).toThrow(/not issued by a trusted source/);
  });

  it("refuses an unknown role and a blank actor", () => {
    expect(() => registerTrustedPrincipal(
      { actorType: "human", actorId: "x", role: "superuser" as never },
      "test-fixture",
    )).toThrow(/unknown role/);
    expect(() => registerTrustedPrincipal(
      { actorType: "human", actorId: "   ", role: "fixture_administrator" },
      "test-fixture",
    )).toThrow(/actorId is required/);
  });

  it("refuses a registration source other than the test fixture", () => {
    expect(() => registerTrustedPrincipal(
      { actorType: "human", actorId: "x", role: "fixture_administrator" },
      "production" as never,
    )).toThrow(FixturePrincipalUnavailableError);
  });

  it("fails closed in production", () => {
    expect(() => resolveProductionPrincipal()).toThrow(FixturePrincipalUnavailableError);
    expect(() => resolveProductionPrincipal())
      .toThrow(/production fixture administration is disabled/);

    const original = process.env.NODE_ENV;
    try {
      // Reassigned deliberately to prove the guard, then restored in `finally`.
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      expect(() => registerTrustedPrincipal(
        { actorType: "human", actorId: "x", role: "fixture_administrator" },
        "test-fixture",
      )).toThrow(/refused in a production runtime/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = original;
    }
  });
});

describe("fixture administrative authority", () => {
  it("grants only the capabilities the principal's role carries", () => {
    const templateOnly = testFixtureAuthority("fixture_template_administrator");
    expect(() => assertFixtureAdminCapability(templateOnly, "template_admin")).not.toThrow();
    // Privilege escalation: the role simply does not carry these.
    expect(() => assertFixtureAdminCapability(templateOnly, "instance_admin"))
      .toThrow(/instance_admin capability/);
    expect(() => assertFixtureAdminCapability(templateOnly, "reset_admin"))
      .toThrow(/reset_admin capability/);
  });

  it("refuses a forged authority literal", () => {
    const forged = {
      actorType: "human",
      actorId: "attacker",
      capabilities: ["template_admin", "instance_admin", "reset_admin"],
    } as FixtureAdminAuthority;
    expect(() => assertFixtureAdminCapability(forged, "template_admin"))
      .toThrow(/server-derived administrative authority/);
    expect(() => executingActor(forged)).toThrow(/server-derived administrative authority/);
    expect(() => assertHumanFixtureActor(forged, "Anything"))
      .toThrow(/server-derived administrative authority/);
  });

  it("refuses an AI actor at the principal boundary", () => {
    expect(() => registerTrustedPrincipal(
      { actorType: "ai" as never, actorId: "model", role: "fixture_administrator" },
      "test-fixture",
    )).toThrow(/actorType must be human or system/);
  });

  it("reports the executing actor from the authority, not from input", () => {
    const authority = testFixtureAuthority("fixture_administrator", "alice");
    expect(executingActor(authority)).toEqual({ actorType: "human", actorId: "alice" });
  });

  it("distinguishes a human actor from a system actor", () => {
    const human = testFixtureAuthority("fixture_reset_administrator", "alice", "human");
    const system = testFixtureAuthority("fixture_reset_administrator", "scheduler", "system");
    expect(() => assertHumanFixtureActor(human, "Disposal confirmation")).not.toThrow();
    expect(() => assertHumanFixtureActor(system, "Disposal confirmation"))
      .toThrow(/requires an explicit human actor/);
  });
});

describe("test-only issuance boundary", () => {
  /**
   * Amendment §7: verify the import boundary rather than merely assert it. Application
   * code must not be able to reach the test principal factory.
   */
  it("is never imported by application code", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const source = readFileSync(full, "utf8");
        if (source.includes("tests/helpers/fixture-admin-principal")
          || source.includes("fixture-admin-principal")) {
          offenders.push(full);
        }
      }
    };
    for (const root of ["src", "app"]) walk(root);
    expect(offenders).toEqual([]);
  });

  it("keeps registerTrustedPrincipal the only issuance path", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (full.replace(/\\/g, "/").endsWith("src/domain/fixture-principal.ts")) continue;
        if (readFileSync(full, "utf8").includes("registerTrustedPrincipal")) offenders.push(full);
      }
    };
    for (const root of ["src", "app"]) walk(root);
    expect(offenders).toEqual([]);
  });
});
