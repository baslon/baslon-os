import "server-only";

export type ServerActorContext = Readonly<{
  actorType: "human" | "system" | "ai";
  actorId: string;
}>;

export type HumanAuthority = Readonly<{ actorId: string }>;

const issuedHumanAuthorities = new WeakSet<object>();

export function deriveHumanAuthority(context: ServerActorContext): HumanAuthority {
  if (context.actorType !== "human") {
    throw new Error("Fact admission requires server-derived human authority");
  }
  if (!context.actorId.trim()) throw new Error("Human actorId is required");
  const authority = Object.freeze({ actorId: context.actorId });
  issuedHumanAuthorities.add(authority);
  return authority;
}

export function assertHumanAuthority(authority: HumanAuthority): void {
  if (!issuedHumanAuthorities.has(authority)) {
    throw new Error("Fact admission requires server-derived human authority");
  }
}
