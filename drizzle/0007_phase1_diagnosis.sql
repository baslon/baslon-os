CREATE TYPE "public"."diagnosis_grounding" AS ENUM('evidence_backed', 'calculated', 'interpretive', 'hypothesis');--> statement-breakpoint
CREATE TYPE "public"."diagnosis_interpretation_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."diagnosis_item_type" AS ENUM('position', 'strength', 'constraint', 'risk', 'opportunity', 'limitation', 'decision_required');--> statement-breakpoint
CREATE TYPE "public"."diagnosis_reference_role" AS ENUM('primary', 'context', 'limiting_gap');--> statement-breakpoint
CREATE TYPE "public"."diagnosis_review_session_status" AS ENUM('OPEN', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "approved_diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"review_session_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_version" integer NOT NULL,
	"input_projection_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"artifact_version" text NOT NULL,
	"version" integer NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_content" jsonb NOT NULL,
	CONSTRAINT "approved_diagnoses_run_unique" UNIQUE("analysis_run_id"),
	CONSTRAINT "approved_diagnoses_session_unique" UNIQUE("review_session_id"),
	CONSTRAINT "approved_diagnoses_business_version_unique" UNIQUE("business_id","version"),
	CONSTRAINT "approved_diagnoses_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "approved_diagnoses_version_check" CHECK ("approved_diagnoses"."version" > 0 and "approved_diagnoses"."snapshot_version" > 0),
	CONSTRAINT "approved_diagnoses_content_object_check" CHECK (jsonb_typeof("approved_diagnoses"."approved_content") = 'object'),
	CONSTRAINT "approved_diagnoses_required_text_check" CHECK (
    length(btrim("approved_diagnoses"."approved_by")) > 0 and length(btrim("approved_diagnoses"."artifact_version")) > 0
  )
);
--> statement-breakpoint
CREATE TABLE "diagnosis_calculation_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"diagnosis_calculation_id" uuid NOT NULL,
	"metric_id" uuid,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnosis_calculation_sources_one_source_check" CHECK (
    num_nonnulls("diagnosis_calculation_sources"."metric_id", "diagnosis_calculation_sources"."evidence_id") = 1
  )
);
--> statement-breakpoint
CREATE TABLE "diagnosis_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"calculation_ref" text NOT NULL,
	"rule_key" text NOT NULL,
	"rule_version" text NOT NULL,
	"label" text NOT NULL,
	"formula" text NOT NULL,
	"value_numeric" numeric(20, 4),
	"value_precision" numeric_precision NOT NULL,
	"value_lower" numeric(20, 4),
	"value_upper" numeric(20, 4),
	"unit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnosis_calculations_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "diagnosis_calculations_id_business_run_unique" UNIQUE("id","business_id","analysis_run_id"),
	CONSTRAINT "diagnosis_calculations_run_ref_unique" UNIQUE("analysis_run_id","calculation_ref"),
	CONSTRAINT "diagnosis_calculations_ref_check" CHECK ("diagnosis_calculations"."calculation_ref" ~ '^D(?:[0-9]{3}|[1-9][0-9]{3,})$'),
	CONSTRAINT "diagnosis_calculations_required_text_check" CHECK (
    length(btrim("diagnosis_calculations"."rule_key")) > 0 and length(btrim("diagnosis_calculations"."rule_version")) > 0
    and length(btrim("diagnosis_calculations"."label")) > 0 and length(btrim("diagnosis_calculations"."formula")) > 0
    and length(btrim("diagnosis_calculations"."unit")) > 0
  ),
	CONSTRAINT "diagnosis_calculations_value_check" CHECK (
    ("diagnosis_calculations"."value_precision" = 'range'
      and "diagnosis_calculations"."value_lower" is not null and "diagnosis_calculations"."value_upper" is not null
      and "diagnosis_calculations"."value_lower" <= "diagnosis_calculations"."value_upper" and "diagnosis_calculations"."value_numeric" is null)
    or ("diagnosis_calculations"."value_precision" in ('exact', 'approximate', 'estimate', 'unspecified')
      and "diagnosis_calculations"."value_numeric" is not null and "diagnosis_calculations"."value_lower" is null and "diagnosis_calculations"."value_upper" is null)
  )
);
--> statement-breakpoint
CREATE TABLE "diagnosis_item_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"diagnosis_item_id" uuid NOT NULL,
	"role" "diagnosis_reference_role" NOT NULL,
	"claim_id" uuid,
	"evidence_id" uuid,
	"metric_id" uuid,
	"evidence_gap_id" uuid,
	"diagnosis_calculation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnosis_item_references_one_target_check" CHECK (
    num_nonnulls("diagnosis_item_references"."claim_id", "diagnosis_item_references"."evidence_id", "diagnosis_item_references"."metric_id", "diagnosis_item_references"."evidence_gap_id", "diagnosis_item_references"."diagnosis_calculation_id") = 1
  ),
	CONSTRAINT "diagnosis_item_references_gap_role_check" CHECK (
    ("diagnosis_item_references"."role" = 'limiting_gap') = ("diagnosis_item_references"."evidence_gap_id" is not null)
  )
);
--> statement-breakpoint
CREATE TABLE "diagnosis_item_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"review_session_id" uuid NOT NULL,
	"diagnosis_item_id" uuid NOT NULL,
	"decision" "evidence_review_decision" NOT NULL,
	"corrected_payload" jsonb,
	"reason" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnosis_item_reviews_item_unique" UNIQUE("diagnosis_item_id"),
	CONSTRAINT "diagnosis_item_reviews_decision_check" CHECK ("diagnosis_item_reviews"."decision" in ('ACCEPTED', 'CORRECTED', 'REJECTED')),
	CONSTRAINT "diagnosis_item_reviews_corrected_payload_check" CHECK (
    ("diagnosis_item_reviews"."decision" = 'CORRECTED' and "diagnosis_item_reviews"."corrected_payload" is not null
      and jsonb_typeof("diagnosis_item_reviews"."corrected_payload") = 'object')
    or ("diagnosis_item_reviews"."decision" <> 'CORRECTED' and "diagnosis_item_reviews"."corrected_payload" is null)
  )
);
--> statement-breakpoint
CREATE TABLE "diagnosis_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"item_ref" text NOT NULL,
	"item_type" "diagnosis_item_type" NOT NULL,
	"statement" text NOT NULL,
	"rationale" text NOT NULL,
	"grounding" "diagnosis_grounding" NOT NULL,
	"materiality" "finding_materiality" NOT NULL,
	"interpretation_confidence" "diagnosis_interpretation_confidence",
	"limitations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnosis_items_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "diagnosis_items_id_business_run_unique" UNIQUE("id","business_id","analysis_run_id"),
	CONSTRAINT "diagnosis_items_run_ref_unique" UNIQUE("analysis_run_id","item_ref"),
	CONSTRAINT "diagnosis_items_ref_check" CHECK ("diagnosis_items"."item_ref" ~ '^I(?:[0-9]{3}|[1-9][0-9]{3,})$'),
	CONSTRAINT "diagnosis_items_required_text_check" CHECK (
    length(btrim("diagnosis_items"."statement")) > 0 and length(btrim("diagnosis_items"."rationale")) > 0
    and ("diagnosis_items"."limitations" is null or length(btrim("diagnosis_items"."limitations")) > 0)
  ),
	CONSTRAINT "diagnosis_items_interpretation_limitations_check" CHECK (
    "diagnosis_items"."grounding" not in ('interpretive', 'hypothesis') or "diagnosis_items"."limitations" is not null
  )
);
--> statement-breakpoint
CREATE TABLE "diagnosis_review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" "diagnosis_review_session_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "diagnosis_review_sessions_run_unique" UNIQUE("analysis_run_id"),
	CONSTRAINT "diagnosis_review_sessions_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "diagnosis_review_sessions_id_business_run_unique" UNIQUE("id","business_id","analysis_run_id"),
	CONSTRAINT "diagnosis_review_sessions_reviewer_check" CHECK (length(btrim("diagnosis_review_sessions"."reviewer_id")) > 0),
	CONSTRAINT "diagnosis_review_sessions_completion_check" CHECK (
    ("diagnosis_review_sessions"."status" = 'OPEN' and "diagnosis_review_sessions"."completed_at" is null)
    or ("diagnosis_review_sessions"."status" = 'COMPLETED' and "diagnosis_review_sessions"."completed_at" is not null)
  )
);
--> statement-breakpoint
ALTER TABLE "approved_diagnoses" ADD CONSTRAINT "approved_diagnoses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnoses" ADD CONSTRAINT "approved_diagnoses_session_same_run_fk" FOREIGN KEY ("review_session_id","business_id","analysis_run_id") REFERENCES "public"."diagnosis_review_sessions"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnoses" ADD CONSTRAINT "approved_diagnoses_run_same_business_fk" FOREIGN KEY ("analysis_run_id","business_id") REFERENCES "public"."analysis_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnoses" ADD CONSTRAINT "approved_diagnoses_snapshot_same_business_fk" FOREIGN KEY ("snapshot_id","business_id") REFERENCES "public"."business_state_snapshots"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_calculation_sources" ADD CONSTRAINT "diagnosis_calculation_sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_calculation_sources" ADD CONSTRAINT "diagnosis_calculation_sources_calculation_same_business_fk" FOREIGN KEY ("diagnosis_calculation_id","business_id") REFERENCES "public"."diagnosis_calculations"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_calculation_sources" ADD CONSTRAINT "diagnosis_calculation_sources_metric_same_business_fk" FOREIGN KEY ("metric_id","business_id") REFERENCES "public"."metrics"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_calculation_sources" ADD CONSTRAINT "diagnosis_calculation_sources_evidence_same_business_fk" FOREIGN KEY ("evidence_id","business_id") REFERENCES "public"."evidence"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_calculations" ADD CONSTRAINT "diagnosis_calculations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_calculations" ADD CONSTRAINT "diagnosis_calculations_run_same_business_fk" FOREIGN KEY ("analysis_run_id","business_id") REFERENCES "public"."analysis_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_references" ADD CONSTRAINT "diagnosis_item_references_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_references" ADD CONSTRAINT "diagnosis_item_references_item_same_run_fk" FOREIGN KEY ("diagnosis_item_id","business_id","analysis_run_id") REFERENCES "public"."diagnosis_items"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_references" ADD CONSTRAINT "diagnosis_item_references_calculation_same_run_fk" FOREIGN KEY ("diagnosis_calculation_id","business_id","analysis_run_id") REFERENCES "public"."diagnosis_calculations"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_references" ADD CONSTRAINT "diagnosis_item_references_claim_same_business_fk" FOREIGN KEY ("claim_id","business_id") REFERENCES "public"."claims"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_references" ADD CONSTRAINT "diagnosis_item_references_evidence_same_business_fk" FOREIGN KEY ("evidence_id","business_id") REFERENCES "public"."evidence"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_references" ADD CONSTRAINT "diagnosis_item_references_metric_same_business_fk" FOREIGN KEY ("metric_id","business_id") REFERENCES "public"."metrics"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_references" ADD CONSTRAINT "diagnosis_item_references_gap_same_business_fk" FOREIGN KEY ("evidence_gap_id","business_id") REFERENCES "public"."evidence_gaps"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_reviews" ADD CONSTRAINT "diagnosis_item_reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_reviews" ADD CONSTRAINT "diagnosis_item_reviews_session_same_run_fk" FOREIGN KEY ("review_session_id","business_id","analysis_run_id") REFERENCES "public"."diagnosis_review_sessions"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_item_reviews" ADD CONSTRAINT "diagnosis_item_reviews_item_same_run_fk" FOREIGN KEY ("diagnosis_item_id","business_id","analysis_run_id") REFERENCES "public"."diagnosis_items"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_items" ADD CONSTRAINT "diagnosis_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_items" ADD CONSTRAINT "diagnosis_items_run_same_business_fk" FOREIGN KEY ("analysis_run_id","business_id") REFERENCES "public"."analysis_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_review_sessions" ADD CONSTRAINT "diagnosis_review_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_review_sessions" ADD CONSTRAINT "diagnosis_review_sessions_run_same_business_fk" FOREIGN KEY ("analysis_run_id","business_id") REFERENCES "public"."analysis_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnosis_calculation_sources_calculation_idx" ON "diagnosis_calculation_sources" USING btree ("diagnosis_calculation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_calculation_sources_metric_unique" ON "diagnosis_calculation_sources" USING btree ("diagnosis_calculation_id","metric_id") WHERE "diagnosis_calculation_sources"."metric_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_calculation_sources_evidence_unique" ON "diagnosis_calculation_sources" USING btree ("diagnosis_calculation_id","evidence_id") WHERE "diagnosis_calculation_sources"."evidence_id" is not null;--> statement-breakpoint
CREATE INDEX "diagnosis_item_references_item_idx" ON "diagnosis_item_references" USING btree ("diagnosis_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_item_references_claim_unique" ON "diagnosis_item_references" USING btree ("diagnosis_item_id","claim_id") WHERE "diagnosis_item_references"."claim_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_item_references_evidence_unique" ON "diagnosis_item_references" USING btree ("diagnosis_item_id","evidence_id") WHERE "diagnosis_item_references"."evidence_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_item_references_metric_unique" ON "diagnosis_item_references" USING btree ("diagnosis_item_id","metric_id") WHERE "diagnosis_item_references"."metric_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_item_references_gap_unique" ON "diagnosis_item_references" USING btree ("diagnosis_item_id","evidence_gap_id") WHERE "diagnosis_item_references"."evidence_gap_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_item_references_calculation_unique" ON "diagnosis_item_references" USING btree ("diagnosis_item_id","diagnosis_calculation_id") WHERE "diagnosis_item_references"."diagnosis_calculation_id" is not null;--> statement-breakpoint
CREATE INDEX "diagnosis_item_reviews_session_idx" ON "diagnosis_item_reviews" USING btree ("review_session_id","reviewed_at");
--> statement-breakpoint
-- Phase 1 Diagnosis integrity (M4-05 / M4-06 / M4-07). Diagnosis output may only be
-- written while its own phase1_diagnosis run is RUNNING, and is immutable thereafter.
CREATE FUNCTION phase1_diagnosis_output_guard() RETURNS trigger AS $$
DECLARE
  run_id uuid;
  run_module text;
  run_status text;
BEGIN
  IF TG_TABLE_NAME = 'diagnosis_calculation_sources' THEN
    SELECT analysis_run_id INTO run_id FROM diagnosis_calculations
      WHERE id = NEW.diagnosis_calculation_id AND business_id = NEW.business_id;
  ELSE
    run_id := NEW.analysis_run_id;
  END IF;
  SELECT module, status::text INTO run_module, run_status FROM analysis_runs
    WHERE id = run_id AND business_id = NEW.business_id;
  IF run_module IS DISTINCT FROM 'phase1_diagnosis' THEN
    RAISE EXCEPTION '% must belong to a phase1_diagnosis analysis run', TG_TABLE_NAME;
  END IF;
  IF run_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION '% can only be written while its diagnosis run is RUNNING', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER diagnosis_calculations_output_guard
BEFORE INSERT ON diagnosis_calculations
FOR EACH ROW EXECUTE FUNCTION phase1_diagnosis_output_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_calculation_sources_output_guard
BEFORE INSERT ON diagnosis_calculation_sources
FOR EACH ROW EXECUTE FUNCTION phase1_diagnosis_output_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_items_output_guard
BEFORE INSERT ON diagnosis_items
FOR EACH ROW EXECUTE FUNCTION phase1_diagnosis_output_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_item_references_output_guard
BEFORE INSERT ON diagnosis_item_references
FOR EACH ROW EXECUTE FUNCTION phase1_diagnosis_output_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_calculations_immutable
BEFORE UPDATE OR DELETE ON diagnosis_calculations
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
CREATE TRIGGER diagnosis_calculation_sources_immutable
BEFORE UPDATE OR DELETE ON diagnosis_calculation_sources
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
CREATE TRIGGER diagnosis_items_immutable
BEFORE UPDATE OR DELETE ON diagnosis_items
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
CREATE TRIGGER diagnosis_item_references_immutable
BEFORE UPDATE OR DELETE ON diagnosis_item_references
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
-- A review session is created OPEN for a successful diagnosis run, may only move
-- OPEN -> COMPLETED, and completes only when every item in the run has a decision.
CREATE FUNCTION diagnosis_review_session_guard() RETURNS trigger AS $$
DECLARE
  deletion_business_id text;
  run_module text;
  run_status text;
  undecided integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'diagnosis_review_sessions must be created OPEN';
    END IF;
    SELECT module, status::text INTO run_module, run_status FROM analysis_runs
      WHERE id = NEW.analysis_run_id AND business_id = NEW.business_id;
    IF run_module IS DISTINCT FROM 'phase1_diagnosis' OR run_status IS DISTINCT FROM 'SUCCEEDED' THEN
      RAISE EXCEPTION 'diagnosis review requires a successful phase1_diagnosis run';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    deletion_business_id := current_setting('baslon.permanent_delete_business_id', true);
    IF deletion_business_id IS NOT NULL AND deletion_business_id = OLD.business_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'diagnosis_review_sessions records are immutable outside permanent Business deletion';
  END IF;

  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION 'completed diagnosis_review_sessions records are immutable';
  END IF;
  IF NEW.status <> 'COMPLETED'
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.business_id IS DISTINCT FROM OLD.business_id
    OR NEW.analysis_run_id IS DISTINCT FROM OLD.analysis_run_id
    OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'diagnosis_review_sessions may only change from OPEN to COMPLETED';
  END IF;
  SELECT count(*) INTO undecided FROM diagnosis_items item
    WHERE item.analysis_run_id = OLD.analysis_run_id
      AND item.business_id = OLD.business_id
      AND NOT EXISTS (
        SELECT 1 FROM diagnosis_item_reviews review
        WHERE review.diagnosis_item_id = item.id AND review.review_session_id = OLD.id
      );
  IF undecided > 0 THEN
    RAISE EXCEPTION 'every diagnosis item requires exactly one decision before the review completes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER diagnosis_review_sessions_guard
BEFORE INSERT OR UPDATE OR DELETE ON diagnosis_review_sessions
FOR EACH ROW EXECUTE FUNCTION diagnosis_review_session_guard();--> statement-breakpoint
CREATE FUNCTION diagnosis_item_review_guard() RETURNS trigger AS $$
DECLARE
  session_status text;
BEGIN
  SELECT status::text INTO session_status FROM diagnosis_review_sessions
    WHERE id = NEW.review_session_id AND business_id = NEW.business_id;
  IF session_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'diagnosis item decisions require an OPEN review session';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER diagnosis_item_reviews_open_session_guard
BEFORE INSERT ON diagnosis_item_reviews
FOR EACH ROW EXECUTE FUNCTION diagnosis_item_review_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_item_reviews_immutable
BEFORE UPDATE OR DELETE ON diagnosis_item_reviews
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
-- An approved diagnosis must record exactly the run it approves: a successful
-- phase1_diagnosis run, its snapshot and version, its input/prompt versions and
-- input hash, and a COMPLETED review of that run with at least one surviving item.
CREATE FUNCTION approved_diagnosis_guard() RETURNS trigger AS $$
DECLARE
  run_record record;
  session_status text;
  snapshot_version_value integer;
BEGIN
  SELECT module, status::text AS status, input_snapshot_id, input_projection_version, prompt_version, input_hash
    INTO run_record FROM analysis_runs
    WHERE id = NEW.analysis_run_id AND business_id = NEW.business_id;
  IF run_record.module IS DISTINCT FROM 'phase1_diagnosis' OR run_record.status IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'an approved diagnosis requires a successful phase1_diagnosis run';
  END IF;
  SELECT version INTO snapshot_version_value FROM business_state_snapshots
    WHERE id = NEW.snapshot_id AND business_id = NEW.business_id;
  IF NEW.snapshot_id IS DISTINCT FROM run_record.input_snapshot_id
    OR NEW.snapshot_version IS DISTINCT FROM snapshot_version_value
    OR NEW.input_projection_version IS DISTINCT FROM run_record.input_projection_version
    OR NEW.prompt_version IS DISTINCT FROM run_record.prompt_version
    OR NEW.input_hash IS DISTINCT FROM run_record.input_hash THEN
    RAISE EXCEPTION 'an approved diagnosis must record its run exact snapshot, versions and input hash';
  END IF;
  SELECT status::text INTO session_status FROM diagnosis_review_sessions
    WHERE id = NEW.review_session_id AND business_id = NEW.business_id;
  IF session_status IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'an approved diagnosis requires a COMPLETED review session';
  END IF;
  -- An all-rejected review is not approvable; it must go back through revision.
  IF NOT EXISTS (
    SELECT 1 FROM diagnosis_item_reviews review
    WHERE review.review_session_id = NEW.review_session_id
      AND review.business_id = NEW.business_id
      AND review.decision IN ('ACCEPTED', 'CORRECTED')
  ) THEN
    RAISE EXCEPTION 'an approved diagnosis requires at least one ACCEPTED or CORRECTED item';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER approved_diagnoses_guard
BEFORE INSERT ON approved_diagnoses
FOR EACH ROW EXECUTE FUNCTION approved_diagnosis_guard();--> statement-breakpoint
CREATE TRIGGER approved_diagnoses_immutable
BEFORE UPDATE OR DELETE ON approved_diagnoses
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
