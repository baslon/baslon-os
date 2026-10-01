import "server-only";

import type { ServerActorContext } from "@/domain/server-authority";

/**
 * Architecture §18: ordinary Business edit authority is not sufficient for template
 * management, instance creation or reset/disposal. These are separate administrative
 * capabilities, so they get their own server-derived, unforgeable authority tokens
 * following the same branding convention as `deriveHumanAuthority`.
 *
 * A caller cannot fabricate one of these by constructing an object literal: only a
 * token this module issued is recognised, which keeps the capability check on the
 * server and out of request payloads.
 */

export type FixtureAdminCapability =
  /** Register and retire fixture templates. */
  | "template_admin"
  /** Register fixture instances and record their verification outcome. */
  | "instance_admin"
  /** Request and advance reset operations, and confirm disposal. */
  | "reset_admin";

export type FixtureAdminAuthority = Readonly<{
  actorType: "human" | "system";
  actorId: string;
  capabilities: readonly FixtureAdminCapability[];
}>;

const issuedFixtureAuthorities = new WeakSet<object>();

/**
 * Derive an administrative fixture authority from a server actor context.
 *
 * AI actors are rejected outright: fixture administration is a material operation on
 * protected baselines and disposable graphs, and the governing principle is that AI
 * proposes while humans decide. A `system` actor is permitted so scheduled or internal
 * orchestration can hold a narrowed capability set.
 */
export function deriveFixtureAdminAuthority(
  context: ServerActorContext,
  capabilities: readonly FixtureAdminCapability[],
): FixtureAdminAuthority {
  if (context.actorType === "ai") {
    throw new Error("Fixture administration cannot be performed by an AI actor");
  }
  if (!context.actorId.trim()) throw new Error("Fixture administration requires an actorId");
  if (capabilities.length === 0) {
    throw new Error("Fixture administration requires at least one capability");
  }
  const authority = Object.freeze({
    actorType: context.actorType,
    actorId: context.actorId,
    capabilities: Object.freeze([...new Set(capabilities)]) as readonly FixtureAdminCapability[],
  });
  issuedFixtureAuthorities.add(authority);
  return authority;
}

/** Assert the token was issued here and carries the capability the operation needs. */
export function assertFixtureAdminCapability(
  authority: FixtureAdminAuthority,
  capability: FixtureAdminCapability,
): void {
  if (!issuedFixtureAuthorities.has(authority)) {
    throw new Error("Fixture administration requires server-derived administrative authority");
  }
  if (!authority.capabilities.includes(capability)) {
    throw new Error(`Fixture administration requires the ${capability} capability`);
  }
}
