import "server-only";

import type { FixtureAdminCapability } from "@/domain/fixture-authority";

/**
 * Trusted administrative principals for pilot fixture operations.
 *
 * Review finding R1: the previous design let any importing module hand in a plain actor
 * context together with its own chosen capability list, so "administrative authority" was
 * self-issued. Capabilities now come from policy keyed by a verified principal role, and a
 * principal can only be produced by a resolver registered here.
 *
 * This module does NOT implement authentication. There is no session, token or role store
 * in this repository, so the production resolver fails closed. Closing that gap is a named
 * integration dependency, not something Step A delivers.
 */

/** Roles policy is written against. Not a user-supplied value. */
export type FixtureAdminRole =
  /** May register and retire protected templates. */
  | "fixture_template_administrator"
  /** May register instances and record verification outcomes. */
  | "fixture_instance_administrator"
  /** May request, advance and confirm reset operations. */
  | "fixture_reset_administrator"
  /** Full fixture administration. */
  | "fixture_administrator";

/**
 * The capability policy. Capabilities are derived from the role and nothing else, so a
 * caller cannot request `reset_admin` and be granted it.
 */
const rolePolicy: Readonly<Record<FixtureAdminRole, readonly FixtureAdminCapability[]>> = {
  fixture_template_administrator: ["template_admin"],
  fixture_instance_administrator: ["instance_admin"],
  fixture_reset_administrator: ["reset_admin"],
  fixture_administrator: ["template_admin", "instance_admin", "reset_admin"],
};

export type FixtureAdminPrincipal = Readonly<{
  /** Who is acting. For a human this is the verified identity, never a submitted label. */
  actorType: "human" | "system";
  actorId: string;
  role: FixtureAdminRole;
}>;

/**
 * Runtime provenance. A structural type is not evidence — anything shaped like a principal
 * would satisfy the compiler — so issued principals are recorded here and checked at use.
 */
const issuedPrincipals = new WeakSet<object>();

export class FixturePrincipalUnavailableError extends Error {
  constructor(detail: string) {
    super(`No trusted administrative principal source is configured: ${detail}`);
    this.name = "FixturePrincipalUnavailableError";
  }
}

export class FixturePrincipalInvalidError extends Error {
  constructor(detail: string) {
    super(`Fixture administrative principal is not trusted: ${detail}`);
    this.name = "FixturePrincipalInvalidError";
  }
}

/** True only in a real production runtime. */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True only inside the repository's own test runner. */
function isTestRuntime(): boolean {
  return process.env.NODE_ENV !== "production"
    && (process.env.VITEST === "true" || process.env.VITEST === "1");
}

/**
 * The single registration point for principals.
 *
 * Exported for the test-only factory in `tests/helpers/`. It refuses outright in a
 * production runtime, so even an accidental import cannot mint a principal there.
 */
export function registerTrustedPrincipal(
  principal: FixtureAdminPrincipal,
  source: "test-fixture",
): FixtureAdminPrincipal {
  if (isProductionRuntime()) {
    throw new FixturePrincipalUnavailableError(
      `${source} principals are refused in a production runtime`,
    );
  }
  if (source !== "test-fixture" || !isTestRuntime()) {
    throw new FixturePrincipalUnavailableError(
      "principals may only be registered by the repository's own test runner",
    );
  }
  if (principal.actorType !== "human" && principal.actorType !== "system") {
    throw new FixturePrincipalInvalidError("actorType must be human or system");
  }
  if (!principal.actorId.trim()) {
    throw new FixturePrincipalInvalidError("actorId is required");
  }
  if (!(principal.role in rolePolicy)) {
    throw new FixturePrincipalInvalidError(`unknown role ${String(principal.role)}`);
  }
  const frozen = Object.freeze({ ...principal });
  issuedPrincipals.add(frozen);
  return frozen;
}

/**
 * Resolve the acting principal in production.
 *
 * Fails closed: there is no authenticated session or administrator policy store to read
 * from. A trusted source must be implemented and wired here before any fixture operation
 * is exposed.
 */
export function resolveProductionPrincipal(): never {
  throw new FixturePrincipalUnavailableError(
    "production fixture administration is disabled pending an authenticated "
      + "administrative principal source",
  );
}

/** Assert runtime provenance, not merely shape. */
export function assertTrustedPrincipal(principal: FixtureAdminPrincipal): void {
  if (!issuedPrincipals.has(principal)) {
    throw new FixturePrincipalInvalidError(
      "principal was not issued by a trusted source",
    );
  }
}

/** Capabilities for a trusted principal, derived from policy alone. */
export function capabilitiesForPrincipal(
  principal: FixtureAdminPrincipal,
): readonly FixtureAdminCapability[] {
  assertTrustedPrincipal(principal);
  return rolePolicy[principal.role];
}
