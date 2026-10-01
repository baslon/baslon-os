CREATE TYPE "public"."business_usage" AS ENUM('LIVE', 'SYNTHETIC_TEST', 'PILOT_FIXTURE_TEMPLATE', 'PILOT_FIXTURE_INSTANCE');--> statement-breakpoint
CREATE TYPE "public"."fixture_instance_status" AS ENUM('ACTIVE', 'DISPOSED', 'FAILED_CREATION');--> statement-breakpoint
CREATE TYPE "public"."fixture_reset_state" AS ENUM('REQUESTED', 'DISPOSING', 'RECREATING', 'VERIFYING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."fixture_template_status" AS ENUM('ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "fixture_instance_run_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixture_instance_id" uuid NOT NULL,
	"cloned_analysis_run_id" uuid NOT NULL,
	"source_analysis_run_id" uuid NOT NULL,
	"source_analysis_module" text NOT NULL,
	"source_input_hash" text NOT NULL,
	"source_snapshot_content_hash" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixture_run_provenance_cloned_unique" UNIQUE("fixture_instance_id","cloned_analysis_run_id"),
	CONSTRAINT "fixture_run_provenance_source_unique" UNIQUE("fixture_instance_id","source_analysis_run_id")
);
--> statement-breakpoint
CREATE TABLE "fixture_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"business_usage_binding" "business_usage",
	"historical_business_id" uuid NOT NULL,
	"fixture_template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"created_by_actor_type" "actor_type" NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"predecessor_instance_id" uuid,
	"status" "fixture_instance_status" DEFAULT 'ACTIVE' NOT NULL,
	"verification_passed" boolean DEFAULT false NOT NULL,
	"verification_fingerprint" text,
	"verified_by_actor_type" "actor_type",
	"verified_by_actor_id" text,
	"verified_at" timestamp with time zone,
	"disposed_at" timestamp with time zone,
	"disposal_by_actor_type" "actor_type",
	"disposal_by_actor_id" text,
	"disposal_reason" text,
	"failure_reason" text,
	CONSTRAINT "fixture_instances_business_unique" UNIQUE("business_id"),
	CONSTRAINT "fixture_instances_historical_business_unique" UNIQUE("historical_business_id"),
	CONSTRAINT "fixture_instances_predecessor_unique" UNIQUE("predecessor_instance_id"),
	CONSTRAINT "fixture_instances_usage_check" CHECK (("fixture_instances"."business_usage_binding" IS NULL OR "fixture_instances"."business_usage_binding" = 'PILOT_FIXTURE_INSTANCE')),
	CONSTRAINT "fixture_instances_business_link_check" CHECK ((("fixture_instances"."business_id" IS NULL AND "fixture_instances"."business_usage_binding" IS NULL) OR ("fixture_instances"."business_id" IS NOT NULL AND "fixture_instances"."business_usage_binding" IS NOT NULL AND "fixture_instances"."business_id" = "fixture_instances"."historical_business_id"))),
	CONSTRAINT "fixture_instances_generation_check" CHECK ("fixture_instances"."generation" >= 0),
	CONSTRAINT "fixture_instances_predecessor_check" CHECK (("fixture_instances"."predecessor_instance_id" IS NULL OR "fixture_instances"."predecessor_instance_id" <> "fixture_instances"."id")),
	CONSTRAINT "fixture_instances_generation_predecessor_check" CHECK ((("fixture_instances"."generation" = 0 AND "fixture_instances"."predecessor_instance_id" IS NULL) OR ("fixture_instances"."generation" > 0 AND "fixture_instances"."predecessor_instance_id" IS NOT NULL))),
	CONSTRAINT "fixture_instances_verification_check" CHECK ((("fixture_instances"."verification_passed" = false AND "fixture_instances"."verification_fingerprint" IS NULL AND "fixture_instances"."verified_at" IS NULL AND "fixture_instances"."verified_by_actor_id" IS NULL) OR ("fixture_instances"."verification_passed" = true AND "fixture_instances"."verification_fingerprint" IS NOT NULL AND "fixture_instances"."verified_at" IS NOT NULL AND "fixture_instances"."verified_by_actor_id" IS NOT NULL))),
	CONSTRAINT "fixture_instances_disposal_check" CHECK ((("fixture_instances"."status" = 'DISPOSED' AND "fixture_instances"."disposed_at" IS NOT NULL AND "fixture_instances"."disposal_by_actor_id" IS NOT NULL AND "fixture_instances"."disposal_reason" IS NOT NULL) OR ("fixture_instances"."status" <> 'DISPOSED' AND "fixture_instances"."disposed_at" IS NULL AND "fixture_instances"."disposal_by_actor_id" IS NULL AND "fixture_instances"."disposal_reason" IS NULL))),
	CONSTRAINT "fixture_instances_failed_creation_check" CHECK ((("fixture_instances"."status" = 'FAILED_CREATION' AND "fixture_instances"."failure_reason" IS NOT NULL) OR ("fixture_instances"."status" <> 'FAILED_CREATION' AND "fixture_instances"."failure_reason" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "fixture_reset_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"original_instance_id" uuid NOT NULL,
	"original_business_id" uuid NOT NULL,
	"replacement_instance_id" uuid,
	"replacement_business_id" uuid,
	"fixture_template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"reset_generation" integer NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by_actor_type" "actor_type" NOT NULL,
	"requested_by_actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"state" "fixture_reset_state" DEFAULT 'REQUESTED' NOT NULL,
	"failure_code" text,
	"failure_detail" text,
	"completed_at" timestamp with time zone,
	"pre_disposal_fingerprint" text,
	"replacement_verification_fingerprint" text,
	"export_reference" text,
	"export_checksum" text,
	"export_verified_at" timestamp with time zone,
	"disposal_confirmed_by_actor_type" "actor_type",
	"disposal_confirmed_by_actor_id" text,
	"disposal_confirmed_at" timestamp with time zone,
	CONSTRAINT "fixture_reset_operations_target_generation_unique" UNIQUE("original_instance_id","reset_generation"),
	CONSTRAINT "fixture_reset_operations_replacement_unique" UNIQUE("replacement_instance_id"),
	CONSTRAINT "fixture_reset_operations_distinct_instances_check" CHECK (("fixture_reset_operations"."replacement_instance_id" IS NULL OR "fixture_reset_operations"."replacement_instance_id" <> "fixture_reset_operations"."original_instance_id")),
	CONSTRAINT "fixture_reset_operations_generation_check" CHECK ("fixture_reset_operations"."reset_generation" >= 1),
	CONSTRAINT "fixture_reset_operations_failure_check" CHECK ((("fixture_reset_operations"."state" = 'FAILED' AND "fixture_reset_operations"."failure_code" IS NOT NULL) OR ("fixture_reset_operations"."state" <> 'FAILED' AND "fixture_reset_operations"."failure_code" IS NULL AND "fixture_reset_operations"."failure_detail" IS NULL))),
	CONSTRAINT "fixture_reset_operations_export_check" CHECK ((("fixture_reset_operations"."export_reference" IS NULL AND "fixture_reset_operations"."export_checksum" IS NULL AND "fixture_reset_operations"."export_verified_at" IS NULL AND "fixture_reset_operations"."disposal_confirmed_by_actor_id" IS NULL AND "fixture_reset_operations"."disposal_confirmed_at" IS NULL) OR ("fixture_reset_operations"."export_reference" IS NOT NULL AND "fixture_reset_operations"."export_checksum" IS NOT NULL AND "fixture_reset_operations"."export_verified_at" IS NOT NULL AND "fixture_reset_operations"."disposal_confirmed_by_actor_id" IS NOT NULL AND "fixture_reset_operations"."disposal_confirmed_at" IS NOT NULL))),
	CONSTRAINT "fixture_reset_operations_success_check" CHECK (("fixture_reset_operations"."state" <> 'SUCCEEDED' OR ("fixture_reset_operations"."replacement_instance_id" IS NOT NULL AND "fixture_reset_operations"."replacement_business_id" IS NOT NULL AND "fixture_reset_operations"."completed_at" IS NOT NULL AND "fixture_reset_operations"."export_reference" IS NOT NULL AND "fixture_reset_operations"."disposal_confirmed_at" IS NOT NULL AND "fixture_reset_operations"."replacement_verification_fingerprint" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "fixture_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_version" integer NOT NULL,
	"template_business_id" uuid NOT NULL,
	"template_business_usage" "business_usage" DEFAULT 'PILOT_FIXTURE_TEMPLATE' NOT NULL,
	"source_business_id" uuid NOT NULL,
	"source_approved_diagnosis_id" uuid NOT NULL,
	"source_approved_diagnosis_version" integer NOT NULL,
	"source_snapshot_id" uuid NOT NULL,
	"source_snapshot_version" integer NOT NULL,
	"source_snapshot_content_hash" text NOT NULL,
	"template_content_fingerprint" text NOT NULL,
	"created_by_actor_type" "actor_type" NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_actor_type" "actor_type" NOT NULL,
	"approved_by_actor_id" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "fixture_template_status" DEFAULT 'ACTIVE' NOT NULL,
	"retired_by_actor_type" "actor_type",
	"retired_by_actor_id" text,
	"retired_at" timestamp with time zone,
	CONSTRAINT "fixture_templates_business_unique" UNIQUE("template_business_id"),
	CONSTRAINT "fixture_templates_source_version_unique" UNIQUE("source_business_id","template_version"),
	CONSTRAINT "fixture_templates_id_version_unique" UNIQUE("id","template_version"),
	CONSTRAINT "fixture_templates_identity_separation_check" CHECK ("fixture_templates"."template_business_id" <> "fixture_templates"."source_business_id"),
	CONSTRAINT "fixture_templates_usage_check" CHECK ("fixture_templates"."template_business_usage" = 'PILOT_FIXTURE_TEMPLATE'),
	CONSTRAINT "fixture_templates_version_check" CHECK ("fixture_templates"."template_version" > 0),
	CONSTRAINT "fixture_templates_retirement_check" CHECK ((("fixture_templates"."status" = 'RETIRED' AND "fixture_templates"."retired_at" IS NOT NULL AND "fixture_templates"."retired_by_actor_id" IS NOT NULL AND "fixture_templates"."retired_by_actor_type" IS NOT NULL) OR ("fixture_templates"."status" <> 'RETIRED' AND "fixture_templates"."retired_at" IS NULL AND "fixture_templates"."retired_by_actor_id" IS NULL AND "fixture_templates"."retired_by_actor_type" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "business_usage" "business_usage" DEFAULT 'LIVE' NOT NULL;--> statement-breakpoint
-- Hoisted: this composite UNIQUE is the target of the fixture composite FKs below,
-- so it must exist before they are added. drizzle-kit generated it after them.
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_id_usage_unique" UNIQUE("id","business_usage");--> statement-breakpoint
ALTER TABLE "fixture_instance_run_provenance" ADD CONSTRAINT "fixture_instance_run_provenance_fixture_instance_id_fixture_instances_id_fk" FOREIGN KEY ("fixture_instance_id") REFERENCES "public"."fixture_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD CONSTRAINT "fixture_instances_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD CONSTRAINT "fixture_instances_fixture_template_id_fixture_templates_id_fk" FOREIGN KEY ("fixture_template_id") REFERENCES "public"."fixture_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD CONSTRAINT "fixture_instances_predecessor_instance_id_fixture_instances_id_fk" FOREIGN KEY ("predecessor_instance_id") REFERENCES "public"."fixture_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD CONSTRAINT "fixture_instances_business_usage_fk" FOREIGN KEY ("business_id","business_usage_binding") REFERENCES "public"."businesses"("id","business_usage") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_instances" ADD CONSTRAINT "fixture_instances_template_version_fk" FOREIGN KEY ("fixture_template_id","template_version") REFERENCES "public"."fixture_templates"("id","template_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" ADD CONSTRAINT "fixture_reset_operations_fixture_template_id_fixture_templates_id_fk" FOREIGN KEY ("fixture_template_id") REFERENCES "public"."fixture_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_reset_operations" ADD CONSTRAINT "fixture_reset_operations_template_version_fk" FOREIGN KEY ("fixture_template_id","template_version") REFERENCES "public"."fixture_templates"("id","template_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD CONSTRAINT "fixture_templates_template_business_id_businesses_id_fk" FOREIGN KEY ("template_business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD CONSTRAINT "fixture_templates_source_business_id_businesses_id_fk" FOREIGN KEY ("source_business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD CONSTRAINT "fixture_templates_business_usage_fk" FOREIGN KEY ("template_business_id","template_business_usage") REFERENCES "public"."businesses"("id","business_usage") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD CONSTRAINT "fixture_templates_source_diagnosis_same_business_fk" FOREIGN KEY ("source_approved_diagnosis_id","source_business_id") REFERENCES "public"."approved_diagnoses"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_templates" ADD CONSTRAINT "fixture_templates_source_snapshot_same_business_fk" FOREIGN KEY ("source_snapshot_id","source_business_id") REFERENCES "public"."business_state_snapshots"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fixture_run_provenance_instance_idx" ON "fixture_instance_run_provenance" USING btree ("fixture_instance_id");--> statement-breakpoint
CREATE INDEX "fixture_instances_template_idx" ON "fixture_instances" USING btree ("fixture_template_id");--> statement-breakpoint
CREATE INDEX "fixture_instances_status_idx" ON "fixture_instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fixture_reset_operations_state_idx" ON "fixture_reset_operations" USING btree ("state");--> statement-breakpoint
CREATE INDEX "fixture_reset_operations_original_business_idx" ON "fixture_reset_operations" USING btree ("original_business_id");--> statement-breakpoint
CREATE INDEX "businesses_usage_idx" ON "businesses" USING btree ("business_usage");--> statement-breakpoint
-- ===========================================================================
-- Pilot fixture foundation guards (Pilot Fixture Architecture v2.1, Step A)
--
-- The CHECK constraints above enforce shape. These triggers enforce the rules that
-- depend on the transition rather than the row: who may change a classification, and
-- which provenance is frozen once written.
-- ===========================================================================

-- Protected fixture classifications may be set or cleared only inside the guarded
-- fixture transaction, which announces itself with a transaction-local setting. Any
-- other path -- generic Business update, a hand-written UPDATE, a future CRUD endpoint --
-- is refused, so a fixture cannot be manufactured or silently promoted to LIVE.
CREATE OR REPLACE FUNCTION enforce_business_usage_change() RETURNS trigger AS $$
DECLARE
  fixture_change text;
BEGIN
  fixture_change := current_setting('baslon.fixture_usage_change', true);

  IF TG_OP = 'INSERT' THEN
    IF NEW.business_usage IN ('PILOT_FIXTURE_TEMPLATE', 'PILOT_FIXTURE_INSTANCE')
       AND fixture_change IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'business_usage % may only be assigned by the guarded fixture pathway',
        NEW.business_usage;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.business_usage = OLD.business_usage THEN
    RETURN NEW;
  END IF;

  IF fixture_change IS DISTINCT FROM 'on' THEN
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

CREATE TRIGGER businesses_usage_guard
BEFORE INSERT OR UPDATE ON businesses
FOR EACH ROW EXECUTE FUNCTION enforce_business_usage_change();--> statement-breakpoint

-- An approved template baseline is immutable. Retirement is the single permitted
-- lifecycle change; replacing a baseline means registering a new version.
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
     OR NEW.approved_by_actor_type IS DISTINCT FROM OLD.approved_by_actor_type
     OR NEW.approved_by_actor_id IS DISTINCT FROM OLD.approved_by_actor_id
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'An approved fixture template baseline and its provenance are immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED') THEN
    RAISE EXCEPTION 'fixture_templates status may only move from ACTIVE to RETIRED';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER fixture_templates_immutable_provenance
BEFORE UPDATE ON fixture_templates
FOR EACH ROW EXECUTE FUNCTION enforce_fixture_template_immutability();--> statement-breakpoint

-- Per-run provenance is a record of what was copied. It is never edited: the source
-- hashes it carries are the evidence that a cloned run is a copy and not a new run.
CREATE OR REPLACE FUNCTION prevent_fixture_run_provenance_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fixture_instance_run_provenance records are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER fixture_run_provenance_immutable
BEFORE UPDATE ON fixture_instance_run_provenance
FOR EACH ROW EXECUTE FUNCTION prevent_fixture_run_provenance_update();--> statement-breakpoint

-- The reset audit must survive the graph it describes, and a retry must never be able
-- to point an existing operation at a different victim or a different replacement.
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

  IF OLD.replacement_instance_id IS NOT NULL
     AND NEW.replacement_instance_id IS DISTINCT FROM OLD.replacement_instance_id THEN
    RAISE EXCEPTION 'A recorded reset replacement instance cannot be changed';
  END IF;
  IF OLD.replacement_business_id IS NOT NULL
     AND NEW.replacement_business_id IS DISTINCT FROM OLD.replacement_business_id THEN
    RAISE EXCEPTION 'A recorded reset replacement Business cannot be changed';
  END IF;

  -- Once the reviewed export has been confirmed, its reference and checksum are the
  -- retained record of what was kept. Re-pointing them would break the audit.
  IF OLD.export_reference IS NOT NULL
     AND (NEW.export_reference IS DISTINCT FROM OLD.export_reference
          OR NEW.export_checksum IS DISTINCT FROM OLD.export_checksum
          OR NEW.export_verified_at IS DISTINCT FROM OLD.export_verified_at
          OR NEW.disposal_confirmed_by_actor_id IS DISTINCT FROM OLD.disposal_confirmed_by_actor_id
          OR NEW.disposal_confirmed_at IS DISTINCT FROM OLD.disposal_confirmed_at) THEN
    RAISE EXCEPTION 'A confirmed reviewed-export reference cannot be changed';
  END IF;

  IF OLD.state IN ('SUCCEEDED', 'FAILED') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'A terminal reset operation state cannot change';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER fixture_reset_operations_guard
BEFORE UPDATE OR DELETE ON fixture_reset_operations
FOR EACH ROW EXECUTE FUNCTION enforce_fixture_reset_operation_guard();
