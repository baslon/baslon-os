import {
  registerTrustedPrincipal,
  type FixtureAdminPrincipal,
  type FixtureAdminRole,
} from "@/domain/fixture-principal";
import {
  resolveFixtureAdminAuthority,
  type FixtureAdminAuthority,
} from "@/domain/fixture-authority";

/**
 * Test-only principal factory.
 *
 * Deliberately under `tests/` rather than `src/`, so application code cannot reach it:
 * nothing in `src/` or `app/` imports from `tests/`, and the boundary is asserted by a
 * test rather than merely assumed (R1, amendment §7).
 *
 * `registerTrustedPrincipal` additionally refuses to run outside the repository's own test
 * runner, so an accidental production import would be inert rather than dangerous.
 */
export function testFixturePrincipal(
  role: FixtureAdminRole,
  actorId = "test-fixture-admin",
  actorType: "human" | "system" = "human",
): FixtureAdminPrincipal {
  return registerTrustedPrincipal({ actorType, actorId, role }, "test-fixture");
}

/** Convenience: a trusted principal resolved straight to its authority. */
export function testFixtureAuthority(
  role: FixtureAdminRole,
  actorId = "test-fixture-admin",
  actorType: "human" | "system" = "human",
): FixtureAdminAuthority {
  return resolveFixtureAdminAuthority(testFixturePrincipal(role, actorId, actorType));
}
