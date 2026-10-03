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
  /**
   * Review finding R3: architecture §16 requires a failed reset to be retried under the
   * SAME operation ID once its cause is resolved, so FAILED is re-enterable. Which target
   * is legal depends on whether disposal was recorded as committed, which the caller
   * cannot assert — see `legalResetRecoveryTargets`.
   */
  FAILED: ["DISPOSING", "RECREATING"],
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

/**
 * Where a FAILED operation may resume.
 *
 * Architecture §16 distinguishes failure *before* disposal (the original graph is intact,
 * so the whole operation retries) from failure *after* disposal committed (the original is
 * gone, so only recreation retries and the old graph must never be disposed again).
 *
 * The checkpoint alone is not proof of either, which is why the repository reconciles it
 * against the actual instance rows under lock before allowing a transition. This function
 * states the legal set; it does not establish the facts.
 */
export function legalResetRecoveryTargets(
  disposalCommitted: boolean,
): readonly FixtureResetState[] {
  return disposalCommitted ? ["RECREATING"] : ["DISPOSING"];
}

/**
 * Verification evidence is required before SUCCEEDED, not before VERIFYING.
 *
 * Review finding R4/amendment §2: a replacement is bound and frozen early, then verified
 * during VERIFYING. Demanding a passed verification in order to *enter* VERIFYING would
 * make the state unreachable.
 */
export function resetStateRequiresVerifiedReplacement(state: FixtureResetState): boolean {
  return state === "SUCCEEDED";
}

/** States in which a replacement instance may legally be bound to the operation. */
export function resetStateAcceptsReplacementBinding(state: FixtureResetState): boolean {
  return state === "RECREATING" || state === "VERIFYING";
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

/**
 * Review finding R2: executing actors are NO LONGER accepted as input. They are derived
 * from the verified authority at the service boundary, so an audit record can never name
 * somebody other than the actor who performed the action.
 *
 * Three approval meanings are kept strictly apart (amendment §1):
 *
 *  1. *historical source approval* — who approved the source Diagnosis, read from the
 *     stored `approved_diagnoses` row, never supplied by a caller;
 *  2. *creation execution* — who registered the template, derived from authority;
 *  3. *template-version approval* — a separate, explicit approval of the protected
 *     template, performed by its own guarded operation and recorded as its own action.
 *
 * A template is not approved merely because its source Diagnosis was.
 */

const fingerprintSchema = z.string().trim().min(1).max(200);
const hashSchema = z.string().trim().min(1).max(200);

/**
 * Register a template over an existing template Business.
 *
 * Records provenance and creation; it does not construct the copy (Step B) and does not
 * approve the template. `sourceSnapshotContentHash` is optional: the repository derives the
 * hash from the stored Snapshot under the approved hashing contract and, when a value is
 * supplied, treats it as a cross-check that must agree (R6).
 */
export const registerFixtureTemplateSchema = z.object({
  templateBusinessId: z.uuid(),
  sourceBusinessId: z.uuid(),
  templateVersion: z.number().int().positive(),
  sourceApprovedDiagnosisId: z.uuid(),
  sourceApprovedDiagnosisVersion: z.number().int().positive(),
  sourceSnapshotId: z.uuid(),
  sourceSnapshotVersion: z.number().int().positive(),
  /** Optional cross-check only. The stored value is always derived, never trusted input. */
  expectedSourceSnapshotContentHash: hashSchema.optional(),
  templateContentFingerprint: fingerprintSchema,
}).strict();

/**
 * Approve a registered template version. A distinct, explicit action from creation, so the
 * record states which action the actor performed even when policy lets one human do both.
 */
export const approveFixtureTemplateSchema = z.object({
  fixtureTemplateId: z.uuid(),
  /** Must equal the fingerprint recorded at registration: approval binds to content. */
  templateContentFingerprint: fingerprintSchema,
}).strict();

export const retireFixtureTemplateSchema = z.object({
  fixtureTemplateId: z.uuid(),
}).strict();

export const registerFixtureInstanceSchema = z.object({
  businessId: z.uuid(),
  fixtureTemplateId: z.uuid(),
  generation: z.number().int().min(0).default(0),
  predecessorInstanceId: z.uuid().nullish(),
}).strict();

export const recordInstanceVerificationSchema = z.object({
  fixtureInstanceId: z.uuid(),
  verificationFingerprint: fingerprintSchema,
}).strict();

export const markInstanceFailedCreationSchema = z.object({
  fixtureInstanceId: z.uuid(),
  failureReason: z.string().trim().min(1).max(2000),
}).strict();

export const recordRunProvenanceSchema = z.object({
  fixtureInstanceId: z.uuid(),
  entries: z.array(z.object({
    clonedAnalysisRunId: z.uuid(),
    sourceAnalysisRunId: z.uuid(),
    sourceAnalysisModule: z.string().trim().min(1).max(120),
    sourceInputHash: hashSchema,
    sourceSnapshotContentHash: hashSchema.nullish(),
  }).strict()).min(1),
}).strict();

/**
 * The reset request record, committed in its own transaction before any destructive work
 * (§9.4). Every identity field is compared on replay, so a repeat with the same id cannot
 * silently change the target, template, version or generation (R6).
 */
export const createResetRequestSchema = z.object({
  resetOperationId: z.uuid(),
  originalInstanceId: z.uuid(),
  fixtureTemplateId: z.uuid(),
  templateVersion: z.number().int().positive(),
  resetGeneration: z.number().int().min(1),
  reason: z.string().trim().min(1).max(2000),
}).strict();

/**
 * Record the reviewed export and the explicit disposal confirmation (§9.5). The confirming
 * actor is derived from authority and must be human; a system actor cannot invent it (R2).
 */
export const confirmResetExportSchema = z.object({
  resetOperationId: z.uuid(),
  exportReference: z.string().trim().min(1).max(500),
  exportChecksum: hashSchema,
}).strict();

/**
 * Advance the reset state machine.
 *
 * `replacementVerificationFingerprint` is deliberately absent: success evidence is read
 * from the replacement's own recorded verification rather than accepted from the caller
 * (R4).
 */
export const advanceResetStateSchema = z.object({
  resetOperationId: z.uuid(),
  toState: z.enum(fixtureResetStates),
  failureCode: z.string().trim().min(1).max(120).nullish(),
  failureDetail: z.string().trim().min(1).max(2000).nullish(),
  replacementInstanceId: z.uuid().nullish(),
  preDisposalFingerprint: fingerprintSchema.nullish(),
}).strict();

export type ApproveFixtureTemplateInput = z.input<typeof approveFixtureTemplateSchema>;
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
