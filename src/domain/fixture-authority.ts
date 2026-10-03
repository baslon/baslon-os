import "server-only";

import {
  assertTrustedPrincipal,
  capabilitiesForPrincipal,
  type FixtureAdminPrincipal,
} from "@/domain/fixture-principal";

/**
 * Architecture §18: ordinary Business edit authority is not sufficient for template
 * management, instance creation or reset/disposal.
 *
 * Review finding R1: capabilities are no longer accepted from the caller. An authority is
 * resolved from a principal whose runtime provenance is checked, and its capabilities come
 * from policy in `fixture-principal.ts`. A caller cannot ask for a capability and receive
 * it, and cannot fabricate either object.
 *
 * Review finding R2: the authority is also the source of the *executing* actor recorded on
 * every mutation, so an audit label can no longer name somebody other than the actor who
 * performed the action.
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
 * Resolve an administrative authority from a trusted principal.
 *
 * AI actors cannot hold one: fixture administration is a material operation on protected
 * baselines and disposable graphs, and the governing principle is that AI proposes while
 * humans decide. `system` is permitted so internal orchestration can hold a narrowed role.
 */
export function resolveFixtureAdminAuthority(
  principal: FixtureAdminPrincipal,
): FixtureAdminAuthority {
  // Provenance first: a structurally valid object that nobody trusted is refused.
  assertTrustedPrincipal(principal);
  const capabilities = capabilitiesForPrincipal(principal);
  const authority = Object.freeze({
    actorType: principal.actorType,
    actorId: principal.actorId,
    capabilities: Object.freeze([...capabilities]) as readonly FixtureAdminCapability[],
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

/**
 * The executing actor for an audit record, taken from the authority rather than from input.
 * Callers must use this instead of accepting an actor label (R2).
 */
export function executingActor(
  authority: FixtureAdminAuthority,
): Readonly<{ actorType: "human" | "system"; actorId: string }> {
  if (!issuedFixtureAuthorities.has(authority)) {
    throw new Error("Fixture administration requires server-derived administrative authority");
  }
  return { actorType: authority.actorType, actorId: authority.actorId };
}

/**
 * Assert the authority belongs to a human.
 *
 * Architecture §9.5 requires an explicit human confirmation before disposal. A `system`
 * actor may orchestrate state advances but cannot invent that confirmation (R2).
 */
export function assertHumanFixtureActor(authority: FixtureAdminAuthority, action: string): void {
  if (!issuedFixtureAuthorities.has(authority)) {
    throw new Error("Fixture administration requires server-derived administrative authority");
  }
  if (authority.actorType !== "human") {
    throw new Error(`${action} requires an explicit human actor`);
  }
}
