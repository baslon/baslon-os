-- ===========================================================================
-- Pilot fixture review corrections (PR #32 Solution Architect review, R1-R6)
--
-- PRE-CORRECTION DATA RESET -- READ BEFORE APPLYING ELSEWHERE
--
-- The constraints added below are stricter than those migration 0009 created: failed
-- instances must carry their failure attribution, and a reset operation past DISPOSING
-- must carry a durable disposal checkpoint. Rows written under 0009 cannot satisfy them,
-- and the only way to make them satisfy them would be to invent approval or disposal
-- evidence -- precisely what this review forbids.
--
-- These four tables are therefore cleared first. That is safe because migration 0009 is
-- unreleased and NO application route, page or server action writes to these tables, so
-- every row they can contain is a synthetic test artifact.
--
-- TRUNCATE is used deliberately: it does not fire the row-level DELETE guard that 0009
-- placed on fixture_reset_operations, so no immutability trigger is disabled to run it.
--
-- If 0009 ever reached an environment holding fixture rows that matter, review that
-- environment before applying this migration.
-- ===========================================================================
TRUNCATE TABLE "fixture_reset_operations", "fixture_instance_run_provenance", "fixture_instances", "fixture_templates";--> statement-breakpoint

-- Businesses promoted by 0009 would otherwise keep a protected classification with no
-- metadata behind it. Returning them to SYNTHETIC_TEST keeps classification and metadata
-- consistent. Scoped per row through the guarded setting rather than by disabling anything.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT id FROM businesses
    WHERE business_usage IN ('PILOT_FIXTURE_TEMPLATE', 'PILOT_FIXTURE_INSTANCE')
  LOOP
    PERFORM set_config('baslon.fixture_usage_change', target.id::text, true);
    UPDATE businesses SET business_usage = 'SYNTHETIC_TEST' WHERE id = target.id;
  END LOOP;
  PERFORM set_config('baslon.fixture_usage_change', '', true);
END $$;--> statement-breakpoint

-- source_approval_actor_id / source_approved_at are NOT NULL. The tables are empty after
-- the reset above, so the plain ADD COLUMN ... NOT NULL below succeeds.
CREATE TABLE "fixture_reset_operation_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reset_operation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"failure_code" text NOT NULL,
	"failure_detail" text,
	"state_at_failure" "fixture_reset_state" NOT NULL,
	"recorded_by_actor_type" "actor_type" NOT NULL,
	"recorded_by_actor_id" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixture_reset_operation_failures_attempt_unique" UNIQUE("reset_operation_id","attempt_number"),
	CONSTRAINT "fixture_reset_operation_failures_attempt_check" CHECK ("fixture_reset_operation_failures"."attempt_number" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fixture_instances" DROP CONSTRAINT "fixture_instances_verification_check";--> statement-breakpoint
ALTER TABLE "fixture_instances" DROP CONSTRAINT "fixture_instances_disposal_check";--> statement-breakpoint
ALTER TABLE "fixture_instances" DROP CONSTRAINT "fixture_instances_failed_creation_check";--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" DROP CONSTRAINT "fixture_reset_operations_export_check";--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" DROP CONSTRAINT "fixture_reset_operations_success_check";--> statement-breakpoint
ALTER TABLE "fixture_templates" ALTER COLUMN "approved_by_actor_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_templates" ALTER COLUMN "approved_by_actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_templates" ALTER COLUMN "approved_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fixture_templates" ALTER COLUMN "approved_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD COLUMN "failure_recorded_by_actor_type" "actor_type";--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD COLUMN "failure_recorded_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD COLUMN "failure_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" ADD COLUMN "disposal_committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD COLUMN "source_approval_actor_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD COLUMN "source_approved_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD COLUMN "template_approved_by_actor_type" "actor_type";--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD COLUMN "template_approved_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD COLUMN "template_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fixture_reset_operation_failures" ADD CONSTRAINT "fixture_reset_operation_failures_reset_operation_id_fixture_reset_operations_id_fk" FOREIGN KEY ("reset_operation_id") REFERENCES "public"."fixture_reset_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fixture_reset_operation_failures_operation_idx" ON "fixture_reset_operation_failures" USING btree ("reset_operation_id");--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD CONSTRAINT "fixture_instances_verification_check" CHECK ((("fixture_instances"."verification_passed" = false AND "fixture_instances"."verification_fingerprint" IS NULL AND "fixture_instances"."verified_at" IS NULL AND "fixture_instances"."verified_by_actor_id" IS NULL AND "fixture_instances"."verified_by_actor_type" IS NULL) OR ("fixture_instances"."verification_passed" = true AND "fixture_instances"."verification_fingerprint" IS NOT NULL AND "fixture_instances"."verified_at" IS NOT NULL AND "fixture_instances"."verified_by_actor_id" IS NOT NULL AND "fixture_instances"."verified_by_actor_type" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD CONSTRAINT "fixture_instances_disposal_check" CHECK ((("fixture_instances"."status" = 'DISPOSED' AND "fixture_instances"."disposed_at" IS NOT NULL AND "fixture_instances"."disposal_by_actor_id" IS NOT NULL AND "fixture_instances"."disposal_by_actor_type" IS NOT NULL AND "fixture_instances"."disposal_reason" IS NOT NULL) OR ("fixture_instances"."status" <> 'DISPOSED' AND "fixture_instances"."disposed_at" IS NULL AND "fixture_instances"."disposal_by_actor_id" IS NULL AND "fixture_instances"."disposal_by_actor_type" IS NULL AND "fixture_instances"."disposal_reason" IS NULL)));--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD CONSTRAINT "fixture_instances_failed_creation_check" CHECK ((("fixture_instances"."status" = 'FAILED_CREATION' AND "fixture_instances"."failure_reason" IS NOT NULL AND "fixture_instances"."failure_recorded_by_actor_id" IS NOT NULL AND "fixture_instances"."failure_recorded_by_actor_type" IS NOT NULL AND "fixture_instances"."failure_recorded_at" IS NOT NULL) OR ("fixture_instances"."status" <> 'FAILED_CREATION' AND "fixture_instances"."failure_reason" IS NULL AND "fixture_instances"."failure_recorded_by_actor_id" IS NULL AND "fixture_instances"."failure_recorded_by_actor_type" IS NULL AND "fixture_instances"."failure_recorded_at" IS NULL)));--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" ADD CONSTRAINT "fixture_reset_operations_disposal_progress_check" CHECK (("fixture_reset_operations"."state" NOT IN ('RECREATING', 'VERIFYING', 'SUCCEEDED') OR "fixture_reset_operations"."disposal_committed_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" ADD CONSTRAINT "fixture_reset_operations_attempt_count_check" CHECK ("fixture_reset_operations"."attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" ADD CONSTRAINT "fixture_reset_operations_export_check" CHECK ((("fixture_reset_operations"."export_reference" IS NULL AND "fixture_reset_operations"."export_checksum" IS NULL AND "fixture_reset_operations"."export_verified_at" IS NULL AND "fixture_reset_operations"."disposal_confirmed_by_actor_id" IS NULL AND "fixture_reset_operations"."disposal_confirmed_by_actor_type" IS NULL AND "fixture_reset_operations"."disposal_confirmed_at" IS NULL) OR ("fixture_reset_operations"."export_reference" IS NOT NULL AND "fixture_reset_operations"."export_checksum" IS NOT NULL AND "fixture_reset_operations"."export_verified_at" IS NOT NULL AND "fixture_reset_operations"."disposal_confirmed_by_actor_id" IS NOT NULL AND "fixture_reset_operations"."disposal_confirmed_by_actor_type" IS NOT NULL AND "fixture_reset_operations"."disposal_confirmed_at" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" ADD CONSTRAINT "fixture_reset_operations_success_check" CHECK (("fixture_reset_operations"."state" <> 'SUCCEEDED' OR ("fixture_reset_operations"."replacement_instance_id" IS NOT NULL AND "fixture_reset_operations"."replacement_business_id" IS NOT NULL AND "fixture_reset_operations"."completed_at" IS NOT NULL AND "fixture_reset_operations"."export_reference" IS NOT NULL AND "fixture_reset_operations"."disposal_confirmed_at" IS NOT NULL AND "fixture_reset_operations"."disposal_committed_at" IS NOT NULL AND "fixture_reset_operations"."replacement_verification_fingerprint" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD CONSTRAINT "fixture_templates_approval_check" CHECK ((("fixture_templates"."template_approved_at" IS NULL AND "fixture_templates"."template_approved_by_actor_id" IS NULL AND "fixture_templates"."template_approved_by_actor_type" IS NULL) OR ("fixture_templates"."template_approved_at" IS NOT NULL AND "fixture_templates"."template_approved_by_actor_id" IS NOT NULL AND "fixture_templates"."template_approved_by_actor_type" IS NOT NULL)));--> statement-breakpoint
-- ===========================================================================
-- Retained-metadata guards (review finding R5, amendment sections 4 and 7)
--
-- 0009 left fixture_instances with no trigger at all, allowed deletion of retained run
-- provenance, allowed retirement attribution to be rewritten afterwards, and allowed reset
-- state skipping and changes to success evidence. Each is closed below.
--
-- Nothing here disables an existing guard, and the legal Step D disposal path is expressly
-- permitted so that implementing it will not require weakening any of this.
-- ===========================================================================

-- The usage guard now matches the per-Business scoped setting the repository sets, rather
-- than a blanket 'on'. A stray setting can no longer cover a second row in the same
-- transaction. This remains application discipline, not protection against arbitrary SQL.
CREATE OR REPLACE FUNCTION enforce_business_usage_change() RETURNS trigger AS $$
DECLARE
  permitted_business text;
BEGIN
  permitted_business := current_setting('baslon.fixture_usage_change', true);

  IF TG_OP = 'INSERT' THEN
    IF NEW.business_usage IN ('PILOT_FIXTURE_TEMPLATE', 'PILOT_FIXTURE_INSTANCE')
       AND permitted_business IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION
        'business_usage % may only be assigned by the guarded fixture pathway',
        NEW.business_usage;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.business_usage = OLD.business_usage THEN
    RETURN NEW;
  END IF;

  IF permitted_business IS DISTINCT FROM OLD.id::text THEN
    IF OLD.business_usage IN ('PILOT_FIXTURE_TEMPLATE', 'PILOT_FIXTURE_INSTANCE') THEN
      RAISE EXCEPTION
        'business_usage % may only be changed by the guarded fixture pathway',
        OLD.business_usage;
    END IF;
    IF NEW.business_usage IN ('PILOT_FIXTURE_TEMPLATE', 'PILOT_FIXTURE_INSTANCE') THEN
      RAISE EXCEPTION
        'business_usage % may only be assigned by the guarded fixture pathway',
        NEW.business_usage;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Instance identity, provenance and recorded verification are frozen; lifecycle moves only
-- along legal transitions; detachment is permitted only as part of a consistent disposal.
CREATE OR REPLACE FUNCTION enforce_fixture_instance_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fixture_instances records are retained provenance and cannot be deleted';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.historical_business_id IS DISTINCT FROM OLD.historical_business_id
     OR NEW.fixture_template_id IS DISTINCT FROM OLD.fixture_template_id
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.generation IS DISTINCT FROM OLD.generation
     OR NEW.predecessor_instance_id IS DISTINCT FROM OLD.predecessor_instance_id
     OR NEW.created_by_actor_type IS DISTINCT FROM OLD.created_by_actor_type
     OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A fixture instance identity and provenance are immutable';
  END IF;

  -- Recorded verification is evidence; it is never edited or withdrawn.
  IF OLD.verification_passed = true
     AND (NEW.verification_passed IS DISTINCT FROM OLD.verification_passed
          OR NEW.verification_fingerprint IS DISTINCT FROM OLD.verification_fingerprint
          OR NEW.verified_by_actor_type IS DISTINCT FROM OLD.verified_by_actor_type
          OR NEW.verified_by_actor_id IS DISTINCT FROM OLD.verified_by_actor_id
          OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
    RAISE EXCEPTION 'A recorded clone verification cannot be changed';
  END IF;

  -- Legal lifecycle only: ACTIVE may become DISPOSED or FAILED_CREATION; both are terminal.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'A % fixture instance is terminal and cannot change status', OLD.status;
    END IF;
    IF NEW.status NOT IN ('DISPOSED', 'FAILED_CREATION') THEN
      RAISE EXCEPTION 'fixture_instances status may only move to DISPOSED or FAILED_CREATION';
    END IF;
  END IF;

  -- Detachment is only legal as part of becoming DISPOSED in the same statement, with its
  -- full disposal context. The repository additionally ties it to an authorised operation.
  IF OLD.business_id IS NOT NULL AND NEW.business_id IS NULL THEN
    IF NEW.status <> 'DISPOSED'
       OR NEW.disposed_at IS NULL
       OR NEW.disposal_by_actor_id IS NULL
       OR NEW.disposal_by_actor_type IS NULL
       OR NEW.disposal_reason IS NULL THEN
      RAISE EXCEPTION
        'A fixture instance may only be detached as part of a complete disposal';
    END IF;
  END IF;

  -- Reattachment would resurrect a disposed graph identity.
  IF OLD.business_id IS NULL AND NEW.business_id IS NOT NULL THEN
    RAISE EXCEPTION 'A detached fixture instance cannot be reattached';
  END IF;

  -- Disposal attribution, once written, is part of the audit.
  IF OLD.disposed_at IS NOT NULL
     AND (NEW.disposed_at IS DISTINCT FROM OLD.disposed_at
          OR NEW.disposal_by_actor_type IS DISTINCT FROM OLD.disposal_by_actor_type
          OR NEW.disposal_by_actor_id IS DISTINCT FROM OLD.disposal_by_actor_id
          OR NEW.disposal_reason IS DISTINCT FROM OLD.disposal_reason) THEN
    RAISE EXCEPTION 'Recorded disposal attribution cannot be changed';
  END IF;

  -- Failure attribution likewise.
  IF OLD.failure_recorded_at IS NOT NULL
     AND (NEW.failure_recorded_at IS DISTINCT FROM OLD.failure_recorded_at
          OR NEW.failure_recorded_by_actor_type IS DISTINCT FROM OLD.failure_recorded_by_actor_type
          OR NEW.failure_recorded_by_actor_id IS DISTINCT FROM OLD.failure_recorded_by_actor_id
          OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason) THEN
    RAISE EXCEPTION 'Recorded failure attribution cannot be changed';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER fixture_instances_guard
BEFORE UPDATE OR DELETE ON fixture_instances
FOR EACH ROW EXECUTE FUNCTION enforce_fixture_instance_guard();--> statement-breakpoint

-- Retained run provenance was protected against UPDATE but not DELETE.
DROP TRIGGER IF EXISTS fixture_run_provenance_immutable ON fixture_instance_run_provenance;--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_fixture_run_provenance_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fixture_instance_run_provenance records are immutable retained provenance';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER fixture_run_provenance_immutable
BEFORE UPDATE OR DELETE ON fixture_instance_run_provenance
FOR EACH ROW EXECUTE FUNCTION prevent_fixture_run_provenance_update();--> statement-breakpoint

-- Template immutability now also freezes the three distinct approval records and the
-- retirement attribution that 0009 left editable after retirement.
CREATE OR REPLACE FUNCTION enforce_fixture_template_immutability() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.template_business_id IS DISTINCT FROM OLD.template_business_id
     OR NEW.template_business_usage IS DISTINCT FROM OLD.template_business_usage
     OR NEW.source_business_id IS DISTINCT FROM OLD.source_business_id
     OR NEW.source_approved_diagnosis_id IS DISTINCT FROM OLD.source_approved_diagnosis_id
     OR NEW.source_approved_diagnosis_version IS DISTINCT FROM OLD.source_approved_diagnosis_version
     OR NEW.source_snapshot_id IS DISTINCT FROM OLD.source_snapshot_id
     OR NEW.source_snapshot_version IS DISTINCT FROM OLD.source_snapshot_version
     OR NEW.source_snapshot_content_hash IS DISTINCT FROM OLD.source_snapshot_content_hash
     OR NEW.template_content_fingerprint IS DISTINCT FROM OLD.template_content_fingerprint
     OR NEW.created_by_actor_type IS DISTINCT FROM OLD.created_by_actor_type
     OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.source_approval_actor_id IS DISTINCT FROM OLD.source_approval_actor_id
     OR NEW.source_approved_at IS DISTINCT FROM OLD.source_approved_at THEN
    RAISE EXCEPTION 'An approved fixture template baseline and its provenance are immutable';
  END IF;

  -- Template-version approval may be written once and never altered afterwards.
  IF OLD.template_approved_at IS NOT NULL
     AND (NEW.template_approved_at IS DISTINCT FROM OLD.template_approved_at
          OR NEW.template_approved_by_actor_type IS DISTINCT FROM OLD.template_approved_by_actor_type
          OR NEW.template_approved_by_actor_id IS DISTINCT FROM OLD.template_approved_by_actor_id) THEN
    RAISE EXCEPTION 'A recorded template-version approval cannot be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED') THEN
    RAISE EXCEPTION 'fixture_templates status may only move from ACTIVE to RETIRED';
  END IF;

  -- Retirement attribution is frozen once retired (R5).
  IF OLD.retired_at IS NOT NULL
     AND (NEW.retired_at IS DISTINCT FROM OLD.retired_at
          OR NEW.retired_by_actor_type IS DISTINCT FROM OLD.retired_by_actor_type
          OR NEW.retired_by_actor_id IS DISTINCT FROM OLD.retired_by_actor_id) THEN
    RAISE EXCEPTION 'Recorded template retirement attribution cannot be changed';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- The reset guard now enforces the legal transition table at the database boundary,
-- freezes a SUCCEEDED operation completely, permits same-id recovery from FAILED, and
-- protects the disposal checkpoint and the confirming actor type.
CREATE OR REPLACE FUNCTION enforce_fixture_reset_operation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fixture_reset_operations records are a retained audit trail and cannot be deleted';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.original_instance_id IS DISTINCT FROM OLD.original_instance_id
     OR NEW.original_business_id IS DISTINCT FROM OLD.original_business_id
     OR NEW.fixture_template_id IS DISTINCT FROM OLD.fixture_template_id
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.reset_generation IS DISTINCT FROM OLD.reset_generation
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.requested_by_actor_type IS DISTINCT FROM OLD.requested_by_actor_type
     OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'A reset operation identity, target and request details are immutable';
  END IF;

  -- SUCCEEDED is terminal and its evidence is frozen: no field may change afterwards.
  IF OLD.state = 'SUCCEEDED' THEN
    RAISE EXCEPTION 'A SUCCEEDED reset operation is terminal and its evidence is frozen';
  END IF;

  -- Legal transitions only. FAILED is re-enterable (architecture section 16) but only
  -- towards disposal or recreation.
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT (
      (OLD.state = 'REQUESTED'  AND NEW.state IN ('DISPOSING', 'FAILED'))
      OR (OLD.state = 'DISPOSING'  AND NEW.state IN ('RECREATING', 'FAILED'))
      OR (OLD.state = 'RECREATING' AND NEW.state IN ('VERIFYING', 'FAILED'))
      OR (OLD.state = 'VERIFYING'  AND NEW.state IN ('SUCCEEDED', 'FAILED'))
      OR (OLD.state = 'FAILED'     AND NEW.state IN ('DISPOSING', 'RECREATING'))
    ) THEN
      RAISE EXCEPTION 'Reset state cannot move from % to %', OLD.state, NEW.state;
    END IF;
  END IF;

  -- Disposal may not begin without the confirmed reviewed export.
  IF NEW.state = 'DISPOSING' AND OLD.state IS DISTINCT FROM 'DISPOSING'
     AND NEW.disposal_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Disposal requires a verified reviewed export and an explicit confirmation';
  END IF;

  -- The disposal checkpoint is write-once and never cleared.
  IF OLD.disposal_committed_at IS NOT NULL
     AND NEW.disposal_committed_at IS DISTINCT FROM OLD.disposal_committed_at THEN
    RAISE EXCEPTION 'A recorded disposal checkpoint cannot be changed';
  END IF;

  IF OLD.replacement_instance_id IS NOT NULL
     AND NEW.replacement_instance_id IS DISTINCT FROM OLD.replacement_instance_id THEN
    RAISE EXCEPTION 'A recorded reset replacement instance cannot be changed';
  END IF;
  IF OLD.replacement_business_id IS NOT NULL
     AND NEW.replacement_business_id IS DISTINCT FROM OLD.replacement_business_id THEN
    RAISE EXCEPTION 'A recorded reset replacement Business cannot be changed';
  END IF;

  -- A confirmed reviewed export, including who confirmed it, is part of the audit.
  IF OLD.export_reference IS NOT NULL
     AND (NEW.export_reference IS DISTINCT FROM OLD.export_reference
          OR NEW.export_checksum IS DISTINCT FROM OLD.export_checksum
          OR NEW.export_verified_at IS DISTINCT FROM OLD.export_verified_at
          OR NEW.disposal_confirmed_by_actor_type IS DISTINCT FROM OLD.disposal_confirmed_by_actor_type
          OR NEW.disposal_confirmed_by_actor_id IS DISTINCT FROM OLD.disposal_confirmed_by_actor_id
          OR NEW.disposal_confirmed_at IS DISTINCT FROM OLD.disposal_confirmed_at) THEN
    RAISE EXCEPTION 'A confirmed reviewed-export reference cannot be changed';
  END IF;

  -- The attempt counter only ever advances.
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'The reset attempt counter cannot decrease';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Failure history is append-only: it is the evidence that survives a retry.
CREATE OR REPLACE FUNCTION prevent_fixture_reset_failure_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fixture_reset_operation_failures records are append-only history';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER fixture_reset_operation_failures_immutable
BEFORE UPDATE OR DELETE ON fixture_reset_operation_failures
FOR EACH ROW EXECUTE FUNCTION prevent_fixture_reset_failure_mutation();
