import type { FixtureAdminAuthority } from "@/domain/fixture-authority";
import {
  PilotFixtureEngineUnavailableError,
  type AdvanceResetStateInput,
  type ConfirmResetExportInput,
  type CreateResetRequestInput,
  type MarkInstanceFailedCreationInput,
  type RecordInstanceVerificationInput,
  type RecordRunProvenanceInput,
  type RegisterFixtureInstanceInput,
  type ApproveFixtureTemplateInput,
  type RegisterFixtureTemplateInput,
  type RetireFixtureTemplateInput,
} from "@/domain/pilot-fixture";
import type { PilotFixtureRepository } from "@/repositories/pilot-fixture-repository";

/**
 * The guarded entry point for the pilot fixture foundation.
 *
 * Two things make this service trustworthy rather than decorative:
 *
 *  1. every mutating operation demands a server-derived administrative capability, so
 *     ordinary Business edit authority cannot reach any of it;
 *  2. the operations that would need the clone or reset engines fail closed instead of
 *     returning a fabricated success.
 *
 * It is not registered in any route or UI. Step A introduces no fixture endpoint, which
 * is why no functional reset or delete surface exists for a caller to find.
 */
export class PilotFixtureService {
  constructor(private readonly repository: PilotFixtureRepository) {}

  // -------------------------------------------------------------------------
  // Template administration
  // -------------------------------------------------------------------------

  registerTemplate(authority: FixtureAdminAuthority, input: RegisterFixtureTemplateInput) {
    return this.repository.registerTemplate(authority, input);
  }

  /**
   * Approve a registered template version. Separate from registering it: a template is not
   * approved because its source Diagnosis was, and the record states which action the
   * actor performed.
   */
  approveTemplate(authority: FixtureAdminAuthority, input: ApproveFixtureTemplateInput) {
    return this.repository.approveTemplate(authority, input);
  }

  retireTemplate(authority: FixtureAdminAuthority, input: RetireFixtureTemplateInput) {
    return this.repository.retireTemplate(authority, input);
  }

  // -------------------------------------------------------------------------
  // Instance administration
  // -------------------------------------------------------------------------

  registerInstance(authority: FixtureAdminAuthority, input: RegisterFixtureInstanceInput) {
    return this.repository.registerInstance(authority, input);
  }

  recordInstanceVerification(
    authority: FixtureAdminAuthority,
    input: RecordInstanceVerificationInput,
  ) {
    return this.repository.recordInstanceVerification(authority, input);
  }

  markInstanceFailedCreation(
    authority: FixtureAdminAuthority,
    input: MarkInstanceFailedCreationInput,
  ) {
    return this.repository.markInstanceFailedCreation(authority, input);
  }

  recordRunProvenance(authority: FixtureAdminAuthority, input: RecordRunProvenanceInput) {
    return this.repository.recordRunProvenance(authority, input);
  }

  // -------------------------------------------------------------------------
  // Reset metadata administration
  // -------------------------------------------------------------------------

  createResetRequest(authority: FixtureAdminAuthority, input: CreateResetRequestInput) {
    return this.repository.createResetRequest(authority, input);
  }

  confirmResetExport(authority: FixtureAdminAuthority, input: ConfirmResetExportInput) {
    return this.repository.confirmResetExport(authority, input);
  }

  advanceResetState(authority: FixtureAdminAuthority, input: AdvanceResetStateInput) {
    return this.repository.advanceResetState(authority, input);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  getTemplate(fixtureTemplateId: string) {
    return this.repository.getTemplate(fixtureTemplateId);
  }

  listTemplates() {
    return this.repository.listTemplates();
  }

  getInstance(fixtureInstanceId: string) {
    return this.repository.getInstance(fixtureInstanceId);
  }

  getInstanceByBusiness(businessId: string) {
    return this.repository.getInstanceByBusiness(businessId);
  }

  listRunProvenance(fixtureInstanceId: string) {
    return this.repository.listRunProvenance(fixtureInstanceId);
  }

  getResetOperation(resetOperationId: string) {
    return this.repository.getResetOperation(resetOperationId);
  }

  /** Append-only failure history for a reset operation (R3). */
  listResetFailures(resetOperationId: string) {
    return this.repository.listResetFailures(resetOperationId);
  }

  /**
   * The disposal METADATA contract only (amendment section 4).
   *
   * Step D must call this inside the same transaction as the real graph deletion. It is not
   * a disposal command: `disposePilotFixtureInstance` below still fails closed, so nothing
   * here deletes anything.
   */
  applyDisposalMetadata(
    authority: FixtureAdminAuthority,
    input: { resetOperationId: string; fixtureInstanceId: string; reason: string },
  ) {
    return this.repository.applyDisposalMetadata(authority, input);
  }

  listResetOperationsForBusiness(businessId: string) {
    return this.repository.listResetOperationsForBusiness(businessId);
  }

  /**
   * The classification/metadata half of the Phase 2 fixture precondition.
   *
   * Callers must combine this with the Step C workflow, approved-Diagnosis and
   * Snapshot-binding checks. A true result here does not open Phase 2 on its own.
   */
  evaluateEligibility(businessId: string) {
    return this.repository.evaluateEligibility(businessId);
  }

  // -------------------------------------------------------------------------
  // Reserved command contracts — deliberately fail closed
  //
  // These exist so the intended boundary is visible in code and provable in tests.
  // Each one throws rather than returning a partial or simulated result, because a
  // stubbed success here would be indistinguishable from a real fixture to a caller.
  // -------------------------------------------------------------------------

  /** Step B: deep-copies a template graph with regenerated identifiers. */
  createTemplateFromSource(): never {
    throw new PilotFixtureEngineUnavailableError(
      "Creating a fixture template from a source Business",
      "Step B fixture clone engine",
    );
  }

  /** Step B: manufactures a fresh instance graph from a protected template. */
  createInstanceFromTemplate(): never {
    throw new PilotFixtureEngineUnavailableError(
      "Creating a fixture instance from a template",
      "Step B fixture clone engine",
    );
  }

  /** Step B: structural and equivalence verification of a cloned graph. */
  verifyClone(): never {
    throw new PilotFixtureEngineUnavailableError(
      "Clone verification",
      "Step B fixture clone engine",
    );
  }

  /** Step D: whole-instance dispose-and-recreate, with an audit-surviving operation. */
  resetPilotFixture(): never {
    throw new PilotFixtureEngineUnavailableError(
      "Pilot fixture reset",
      "Step D fixture disposal and reset integration",
    );
  }

  /** Step D: disposal of the instance graph, guarded to PILOT_FIXTURE_INSTANCE. */
  disposePilotFixtureInstance(): never {
    throw new PilotFixtureEngineUnavailableError(
      "Pilot fixture disposal",
      "Step D fixture disposal and reset integration",
    );
  }

  /** Step D dependency: the reviewed export artifact generator (architecture 9.5). */
  generateReviewedExport(): never {
    throw new PilotFixtureEngineUnavailableError(
      "Reviewed export generation",
      "Step D reviewed-export implementation",
    );
  }
}
