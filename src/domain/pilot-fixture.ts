import { z } from "zod";

/**
 * Step A of the approved Pilot Fixture Architecture v2.1: the domain foundation for
 * protected pilot templates and disposable pilot instances.
 *
 * This module owns the vocabulary and the legality rules. It deliberately contains no
 * clone engine and no reset orchestration — those are Steps B and D. Nothing here may
 * assert that a fixture graph exists; it only describes classification, provenance and
 * the state transitions that are truthful before those engines are built.
 */

// ---------------------------------------------------------------------------
// Business usage classification (architecture §4)
// ---------------------------------------------------------------------------

/**
 * Usage is a separate concern from `businesses.status`, which remains the lifecycle
 * field. Usage answers "what kind of data is this?", status answers "is it active?".
 */
export const businessUsages = [
  "LIVE",
  "SYNTHETIC_TEST",
  "PILOT_FIXTURE_TEMPLATE",
  "PILOT_FIXTURE_INSTANCE",
] as const;

export type BusinessUsage = (typeof businessUsages)[number];

/**
 * Usages an ordinary Business create/update may assign. Fixture classifications are
 * assigned only by the guarded fixture pathway, so generic CRUD cannot manufacture a
 * fixture identity or promote a fixture to LIVE.
 */
export const selfAssignableBusinessUsages = ["LIVE", "SYNTHETIC_TEST"] as const;
export type SelfAssignableBusinessUsage = (typeof selfAssignableBusinessUsages)[number];

/**
 * The safe default. Classifying an unknown Business as LIVE forbids pilot reset and
 * fixture eligibility, so a mistake here withholds a capability rather than exposing
 * real data to disposal. Typed as self-assignable because the default must always be a
 * value an ordinary create is allowed to use.
 */
export const DEFAULT_BUSINESS_USAGE: SelfAssignableBusinessUsage = "LIVE";

/** Usages that only the guarded fixture pathway may set or clear. */
export const protectedBusinessUsages = [
  "PILOT_FIXTURE_TEMPLATE",
  "PILOT_FIXTURE_INSTANCE",
] as const;
export type ProtectedBusinessUsage = (typeof protectedBusinessUsages)[number];

export function isProtectedBusinessUsage(value: BusinessUsage): value is ProtectedBusinessUsage {
  return (protectedBusinessUsages as readonly string[]).includes(value);
}

export const businessUsageSchema = z.enum(businessUsages);
export const selfAssignableBusinessUsageSchema = z.enum(selfAssignableBusinessUsages);

// ---------------------------------------------------------------------------
// Lifecycle states (architecture §5.3, §6, §10)
// ---------------------------------------------------------------------------

export const fixtureTemplateStatuses = ["ACTIVE", "RETIRED"] as const;
export type FixtureTemplateStatus = (typeof fixtureTemplateStatuses)[number];

export const fixtureInstanceStatuses = ["ACTIVE", "DISPOSED", "FAILED_CREATION"] as const;
export type FixtureInstanceStatus = (typeof fixtureInstanceStatuses)[number];

export const fixtureResetStates = [
  "REQUESTED",
  "DISPOSING",
  "RECREATING",
  "VERIFYING",
  "SUCCEEDED",
  "FAILED",
] as const;
export type FixtureResetState = (typeof fixtureResetStates)[number];

/**
 * Retirement is the only supported template lifecycle change. Replacing a pilot
 * baseline means a new template version, never an edit to an approved one.
 */
const templateStatusTransitions: Readonly<Record<FixtureTemplateStatus, readonly FixtureTemplateStatus[]>> = {
  ACTIVE: ["RETIRED"],
  RETIRED: [],
};

export function isLegalTemplateStatusTransition(
  from: FixtureTemplateStatus,
  to: FixtureTemplateStatus,
): boolean {
  return templateStatusTransitions[from].includes(to);
}

/**
 * An instance may fail during creation or be disposed. Both are terminal: a disposed
 * graph is never revived, it is replaced by a new instance with a higher generation.
 */
const instanceStatusTransitions: Readonly<Record<FixtureInstanceStatus, readonly FixtureInstanceStatus[]>> = {
  ACTIVE: ["DISPOSED", "FAILED_CREATION"],
  DISPOSED: [],
  FAILED_CREATION: [],
};

export function isLegalInstanceStatusTransition(
  from: FixtureInstanceStatus,
  to: FixtureInstanceStatus,
): boolean {
  return instanceStatusTransitions[from].includes(to);
}

/**
 * The reset state machine from architecture §10. FAILED is reachable from every
 * non-terminal state because the durable `REQUESTED` record must be able to record a
 * rolled-back destructive transaction through a separate guarded update (§9.4).
 */
const resetStateTransitions: Readonly<Record<FixtureResetState, readonly FixtureResetState[]>> = {
  REQUESTED: ["DISPOSING", "FAILED"],
  DISPOSING: ["RECREATING", "FAILED"],
  RECREATING: ["VERIFYING", "FAILED"],
  VERIFYING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export function isLegalResetStateTransition(
  from: FixtureResetState,
  to: FixtureResetState,
): boolean {
  return resetStateTransitions[from].includes(to);
}

export function isTerminalResetState(state: FixtureResetState): boolean {
  return resetStateTransitions[state].length === 0;
}

// ---------------------------------------------------------------------------
// Eligibility (architecture §11)
// ---------------------------------------------------------------------------

/**
 * The classification/metadata half of the Phase 2 entry precondition. Step A can
 * answer only this much: the workflow, approved-Diagnosis and Snapshot-binding halves
 * belong to Step C, and this function must never be mistaken for the whole gate.
 *
 * Classification alone is never sufficient, and structural validation alone is never
 * sufficient without the classification — so both are required here.
 */
export type FixtureEligibilityInput = Readonly<{
  businessUsage: BusinessUsage;
  businessStatus: string;
  instance: {
    status: FixtureInstanceStatus;
    verificationPassed: boolean;
    businessId: string | null;
  } | null;
  template: { status: FixtureTemplateStatus; templateVersion: number } | null;
  instanceTemplateVersion: number | null;
}>;

export type FixtureEligibility = Readonly<{
  eligible: boolean;
  /** Stable machine-readable reasons; never free-form model text. */
  reasons: readonly string[];
}>;

export function evaluateFixtureInstanceEligibility(
  input: FixtureEligibilityInput,
): FixtureEligibility {
  const reasons: string[] = [];

  if (input.businessUsage !== "PILOT_FIXTURE_INSTANCE") {
    reasons.push("business_usage_not_pilot_fixture_instance");
  }
  if (input.businessStatus !== "active") reasons.push("business_not_active");
  if (!input.instance) reasons.push("fixture_instance_metadata_missing");
  if (!input.template) reasons.push("fixture_template_missing");

  if (input.instance) {
    if (input.instance.status !== "ACTIVE") reasons.push("fixture_instance_not_active");
    if (!input.instance.verificationPassed) reasons.push("clone_verification_not_passed");
    if (input.instance.businessId === null) reasons.push("fixture_instance_business_detached");
  }
  if (input.template && input.instanceTemplateVersion !== null) {
    if (input.template.templateVersion !== input.instanceTemplateVersion) {
      reasons.push("template_version_not_recognised");
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Service input contracts
// ---------------------------------------------------------------------------

const actorSchema = z.object({
  actorType: z.enum(["human", "system"]),
  actorId: z.string().trim().min(1).max(200),
});

const fingerprintSchema = z.string().trim().min(1).max(200);
const hashSchema = z.string().trim().min(1).max(200);

/**
 * Registration of an approved template. This records provenance for a template
 * Business that already exists; it does not construct the copy. Step B supplies the
 * deep copy, so a row created here describes a baseline that is not yet populated.
 */
export const registerFixtureTemplateSchema = z.object({
  templateBusinessId: z.uuid(),
  sourceBusinessId: z.uuid(),
  templateVersion: z.number().int().positive(),
  sourceApprovedDiagnosisId: z.uuid(),
  sourceApprovedDiagnosisVersion: z.number().int().positive(),
  sourceSnapshotId: z.uuid(),
  sourceSnapshotVersion: z.number().int().positive(),
  sourceSnapshotContentHash: hashSchema,
  templateContentFingerprint: fingerprintSchema,
  createdBy: actorSchema,
  approvedBy: actorSchema,
}).refine((value) => value.templateBusinessId !== value.sourceBusinessId, {
  message: "A template Business must be distinct from its source Business",
  path: ["templateBusinessId"],
});

export const retireFixtureTemplateSchema = z.object({
  fixtureTemplateId: z.uuid(),
  retiredBy: actorSchema,
});

export const registerFixtureInstanceSchema = z.object({
  businessId: z.uuid(),
  fixtureTemplateId: z.uuid(),
  createdBy: actorSchema,
  generation: z.number().int().min(0).default(0),
  predecessorInstanceId: z.uuid().nullish(),
});

export const recordInstanceVerificationSchema = z.object({
  fixtureInstanceId: z.uuid(),
  verificationFingerprint: fingerprintSchema,
  verifiedBy: actorSchema,
});

export const markInstanceFailedCreationSchema = z.object({
  fixtureInstanceId: z.uuid(),
  failureReason: z.string().trim().min(1).max(2000),
  recordedBy: actorSchema,
});

export const recordRunProvenanceSchema = z.object({
  fixtureInstanceId: z.uuid(),
  entries: z.array(z.object({
    clonedAnalysisRunId: z.uuid(),
    sourceAnalysisRunId: z.uuid(),
    sourceAnalysisModule: z.string().trim().min(1).max(120),
    sourceInputHash: hashSchema,
    sourceSnapshotContentHash: hashSchema.nullish(),
  })).min(1),
});

/**
 * The reset request record. Committed in its own transaction before any destructive
 * work (§9.4), so a crash leaves an interpretable row rather than an ambiguous
 * fixture. The export fields are confirmation evidence captured before disposal
 * (§9.5); Step A stores them, Step D will require them.
 */
export const createResetRequestSchema = z.object({
  /** Caller-supplied idempotency key. A repeat must not rebind the original target. */
  resetOperationId: z.uuid(),
  originalInstanceId: z.uuid(),
  fixtureTemplateId: z.uuid(),
  templateVersion: z.number().int().positive(),
  resetGeneration: z.number().int().min(1),
  reason: z.string().trim().min(1).max(2000),
  requestedBy: actorSchema,
});

export const confirmResetExportSchema = z.object({
  resetOperationId: z.uuid(),
  exportReference: z.string().trim().min(1).max(500),
  exportChecksum: hashSchema,
  disposalConfirmedBy: actorSchema,
});

export const advanceResetStateSchema = z.object({
  resetOperationId: z.uuid(),
  toState: z.enum(fixtureResetStates),
  failureCode: z.string().trim().min(1).max(120).nullish(),
  failureDetail: z.string().trim().min(1).max(2000).nullish(),
  replacementInstanceId: z.uuid().nullish(),
  preDisposalFingerprint: fingerprintSchema.nullish(),
  replacementVerificationFingerprint: fingerprintSchema.nullish(),
});

export type RegisterFixtureTemplateInput = z.input<typeof registerFixtureTemplateSchema>;
export type RetireFixtureTemplateInput = z.input<typeof retireFixtureTemplateSchema>;
export type RegisterFixtureInstanceInput = z.input<typeof registerFixtureInstanceSchema>;
export type RecordInstanceVerificationInput = z.input<typeof recordInstanceVerificationSchema>;
export type MarkInstanceFailedCreationInput = z.input<typeof markInstanceFailedCreationSchema>;
export type RecordRunProvenanceInput = z.input<typeof recordRunProvenanceSchema>;
export type CreateResetRequestInput = z.input<typeof createResetRequestSchema>;
export type ConfirmResetExportInput = z.input<typeof confirmResetExportSchema>;
export type AdvanceResetStateInput = z.input<typeof advanceResetStateSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A guarded fixture rule was violated — a domain refusal, not an infrastructure fault. */
export class PilotFixtureRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PilotFixtureRuleError";
  }
}

/**
 * Raised by command contracts reserved for Steps B and D. They exist so callers and
 * tests can see the intended boundary, and they fail closed rather than returning a
 * fabricated success or a stubbed graph.
 */
export class PilotFixtureEngineUnavailableError extends Error {
  constructor(operation: string, requiredStep: string) {
    super(`${operation} requires the ${requiredStep} implementation, which does not exist yet`);
    this.name = "PilotFixtureEngineUnavailableError";
  }
}
