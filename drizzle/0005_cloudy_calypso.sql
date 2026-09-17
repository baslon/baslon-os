CREATE TYPE "public"."analysis_finding_reference_role" AS ENUM('primary', 'conflicting', 'context');--> statement-breakpoint
CREATE TYPE "public"."analysis_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."evidence_quality_area" AS ENUM('business_and_offer', 'customers_and_market', 'marketing_and_acquisition', 'sales_and_conversion', 'delivery_and_capacity', 'financial_performance', 'goals_and_constraints');--> statement-breakpoint
CREATE TYPE "public"."finding_materiality" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "analysis_finding_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"contradiction_id" uuid,
	"evidence_gap_id" uuid,
	"claim_id" uuid,
	"evidence_id" uuid,
	"metric_id" uuid,
	"role" "analysis_finding_reference_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_finding_references_one_finding_check" CHECK (
    num_nonnulls("analysis_finding_references"."contradiction_id", "analysis_finding_references"."evidence_gap_id") = 1
  ),
	CONSTRAINT "analysis_finding_references_one_canonical_record_check" CHECK (
    num_nonnulls("analysis_finding_references"."claim_id", "analysis_finding_references"."evidence_id", "analysis_finding_references"."metric_id") = 1
  )
);
--> statement-breakpoint
CREATE TABLE "analysis_question_sources" (
	"business_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"source_submission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_question_sources_question_id_source_submission_id_pk" PRIMARY KEY("question_id","source_submission_id")
);
--> statement-breakpoint
CREATE TABLE "analysis_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"contradiction_id" uuid,
	"evidence_gap_id" uuid,
	"question" text NOT NULL,
	"priority_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_questions_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "analysis_questions_one_finding_check" CHECK (
    num_nonnulls("analysis_questions"."contradiction_id", "analysis_questions"."evidence_gap_id") = 1
  ),
	CONSTRAINT "analysis_questions_priority_order_check" CHECK ("analysis_questions"."priority_order" > 0),
	CONSTRAINT "analysis_questions_required_text_check" CHECK (length(btrim("analysis_questions"."question")) > 0)
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"module" text NOT NULL,
	"run_type" text NOT NULL,
	"input_snapshot_id" uuid NOT NULL,
	"input_projection_version" text NOT NULL,
	"input_payload" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model_identifier" text NOT NULL,
	"model_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "analysis_run_status" DEFAULT 'RUNNING' NOT NULL,
	"raw_model_output" jsonb,
	"structured_output" jsonb,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_runs_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "analysis_runs_input_payload_object_check" CHECK (jsonb_typeof("analysis_runs"."input_payload") = 'object'),
	CONSTRAINT "analysis_runs_model_configuration_object_check" CHECK (jsonb_typeof("analysis_runs"."model_configuration") = 'object'),
	CONSTRAINT "analysis_runs_validation_errors_array_check" CHECK (jsonb_typeof("analysis_runs"."validation_errors") = 'array'),
	CONSTRAINT "analysis_runs_required_text_check" CHECK (
    length(btrim("analysis_runs"."module")) > 0
    and length(btrim("analysis_runs"."run_type")) > 0
    and length(btrim("analysis_runs"."input_projection_version")) > 0
    and length(btrim("analysis_runs"."input_hash")) > 0
    and length(btrim("analysis_runs"."prompt_version")) > 0
    and length(btrim("analysis_runs"."provider")) > 0
    and length(btrim("analysis_runs"."model_identifier")) > 0
  ),
	CONSTRAINT "analysis_runs_completion_check" CHECK (
    ("analysis_runs"."status" = 'RUNNING' and "analysis_runs"."completed_at" is null)
    or ("analysis_runs"."status" in ('SUCCEEDED', 'FAILED') and "analysis_runs"."completed_at" is not null)
  ),
	CONSTRAINT "analysis_runs_structured_output_check" CHECK (
    "analysis_runs"."status" <> 'SUCCEEDED' or "analysis_runs"."structured_output" is not null
  )
);
--> statement-breakpoint
CREATE TABLE "contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"area" "evidence_quality_area" NOT NULL,
	"statement" text NOT NULL,
	"rationale" text NOT NULL,
	"materiality" "finding_materiality" NOT NULL,
	"priority_rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contradictions_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "contradictions_priority_rank_check" CHECK ("contradictions"."priority_rank" > 0),
	CONSTRAINT "contradictions_required_text_check" CHECK (
    length(btrim("contradictions"."statement")) > 0 and length(btrim("contradictions"."rationale")) > 0
  )
);
--> statement-breakpoint
CREATE TABLE "evidence_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"area" "evidence_quality_area" NOT NULL,
	"missing_information" text NOT NULL,
	"decision_impact" text NOT NULL,
	"materiality" "finding_materiality" NOT NULL,
	"priority_rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_gaps_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "evidence_gaps_priority_rank_check" CHECK ("evidence_gaps"."priority_rank" > 0),
	CONSTRAINT "evidence_gaps_required_text_check" CHECK (
    length(btrim("evidence_gaps"."missing_information")) > 0
    and length(btrim("evidence_gaps"."decision_impact")) > 0
  )
);
--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_id_business_unique" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "analysis_finding_references" ADD CONSTRAINT "analysis_finding_references_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_finding_references" ADD CONSTRAINT "analysis_finding_references_contradiction_same_business_fk" FOREIGN KEY ("contradiction_id","business_id") REFERENCES "public"."contradictions"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_finding_references" ADD CONSTRAINT "analysis_finding_references_gap_same_business_fk" FOREIGN KEY ("evidence_gap_id","business_id") REFERENCES "public"."evidence_gaps"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_finding_references" ADD CONSTRAINT "analysis_finding_references_claim_same_business_fk" FOREIGN KEY ("claim_id","business_id") REFERENCES "public"."claims"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_finding_references" ADD CONSTRAINT "analysis_finding_references_evidence_same_business_fk" FOREIGN KEY ("evidence_id","business_id") REFERENCES "public"."evidence"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_finding_references" ADD CONSTRAINT "analysis_finding_references_metric_same_business_fk" FOREIGN KEY ("metric_id","business_id") REFERENCES "public"."metrics"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_question_sources" ADD CONSTRAINT "analysis_question_sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_question_sources" ADD CONSTRAINT "analysis_question_sources_question_same_business_fk" FOREIGN KEY ("question_id","business_id") REFERENCES "public"."analysis_questions"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_question_sources" ADD CONSTRAINT "analysis_question_sources_submission_same_business_fk" FOREIGN KEY ("source_submission_id","business_id") REFERENCES "public"."source_submissions"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_questions" ADD CONSTRAINT "analysis_questions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_questions" ADD CONSTRAINT "analysis_questions_contradiction_same_business_fk" FOREIGN KEY ("contradiction_id","business_id") REFERENCES "public"."contradictions"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_questions" ADD CONSTRAINT "analysis_questions_gap_same_business_fk" FOREIGN KEY ("evidence_gap_id","business_id") REFERENCES "public"."evidence_gaps"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_snapshot_same_business_fk" FOREIGN KEY ("input_snapshot_id","business_id") REFERENCES "public"."business_state_snapshots"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_run_same_business_fk" FOREIGN KEY ("analysis_run_id","business_id") REFERENCES "public"."analysis_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_gaps" ADD CONSTRAINT "evidence_gaps_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_gaps" ADD CONSTRAINT "evidence_gaps_run_same_business_fk" FOREIGN KEY ("analysis_run_id","business_id") REFERENCES "public"."analysis_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_finding_references_business_idx" ON "analysis_finding_references" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "analysis_finding_references_contradiction_idx" ON "analysis_finding_references" USING btree ("contradiction_id");--> statement-breakpoint
CREATE INDEX "analysis_finding_references_gap_idx" ON "analysis_finding_references" USING btree ("evidence_gap_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_finding_references_contradiction_claim_unique" ON "analysis_finding_references" USING btree ("contradiction_id","claim_id") WHERE "analysis_finding_references"."contradiction_id" is not null and "analysis_finding_references"."claim_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_finding_references_contradiction_evidence_unique" ON "analysis_finding_references" USING btree ("contradiction_id","evidence_id") WHERE "analysis_finding_references"."contradiction_id" is not null and "analysis_finding_references"."evidence_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_finding_references_contradiction_metric_unique" ON "analysis_finding_references" USING btree ("contradiction_id","metric_id") WHERE "analysis_finding_references"."contradiction_id" is not null and "analysis_finding_references"."metric_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_finding_references_gap_claim_unique" ON "analysis_finding_references" USING btree ("evidence_gap_id","claim_id") WHERE "analysis_finding_references"."evidence_gap_id" is not null and "analysis_finding_references"."claim_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_finding_references_gap_evidence_unique" ON "analysis_finding_references" USING btree ("evidence_gap_id","evidence_id") WHERE "analysis_finding_references"."evidence_gap_id" is not null and "analysis_finding_references"."evidence_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_finding_references_gap_metric_unique" ON "analysis_finding_references" USING btree ("evidence_gap_id","metric_id") WHERE "analysis_finding_references"."evidence_gap_id" is not null and "analysis_finding_references"."metric_id" is not null;--> statement-breakpoint
CREATE INDEX "analysis_question_sources_business_idx" ON "analysis_question_sources" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "analysis_questions_business_priority_idx" ON "analysis_questions" USING btree ("business_id","priority_order");--> statement-breakpoint
CREATE INDEX "analysis_runs_business_created_idx" ON "analysis_runs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "analysis_runs_snapshot_created_idx" ON "analysis_runs" USING btree ("input_snapshot_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_equivalent_active_unique" ON "analysis_runs" USING btree ("business_id","input_snapshot_id","module","input_projection_version","prompt_version") WHERE "analysis_runs"."status" in ('RUNNING', 'SUCCEEDED');--> statement-breakpoint
CREATE INDEX "contradictions_run_priority_idx" ON "contradictions" USING btree ("analysis_run_id","priority_rank");--> statement-breakpoint
CREATE INDEX "contradictions_business_created_idx" ON "contradictions" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_gaps_run_priority_idx" ON "evidence_gaps" USING btree ("analysis_run_id","priority_rank");--> statement-breakpoint
CREATE INDEX "evidence_gaps_business_created_idx" ON "evidence_gaps" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE FUNCTION prevent_analysis_run_invalid_change() RETURNS trigger AS $$
DECLARE
  deletion_business_id text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RUNNING' OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'analysis_runs must be created in RUNNING state';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    deletion_business_id := current_setting('baslon.permanent_delete_business_id', true);
    IF deletion_business_id IS NOT NULL AND deletion_business_id = OLD.business_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'analysis_runs records are immutable outside permanent Business deletion';
  END IF;

  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'terminal analysis_runs records are immutable';
  END IF;

  IF NEW.status NOT IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'analysis_runs may only transition from RUNNING to a terminal state';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.business_id IS DISTINCT FROM OLD.business_id
    OR NEW.module IS DISTINCT FROM OLD.module
    OR NEW.run_type IS DISTINCT FROM OLD.run_type
    OR NEW.input_snapshot_id IS DISTINCT FROM OLD.input_snapshot_id
    OR NEW.input_projection_version IS DISTINCT FROM OLD.input_projection_version
    OR NEW.input_payload IS DISTINCT FROM OLD.input_payload
    OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
    OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.model_identifier IS DISTINCT FROM OLD.model_identifier
    OR NEW.model_configuration IS DISTINCT FROM OLD.model_configuration
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'analysis_runs provenance is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER analysis_runs_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON analysis_runs
FOR EACH ROW EXECUTE FUNCTION prevent_analysis_run_invalid_change();--> statement-breakpoint
CREATE TRIGGER contradictions_immutable
BEFORE UPDATE OR DELETE ON contradictions
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
CREATE TRIGGER evidence_gaps_immutable
BEFORE UPDATE OR DELETE ON evidence_gaps
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
CREATE TRIGGER analysis_finding_references_immutable
BEFORE UPDATE OR DELETE ON analysis_finding_references
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
CREATE TRIGGER analysis_questions_immutable
BEFORE UPDATE OR DELETE ON analysis_questions
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
CREATE TRIGGER analysis_question_sources_immutable
BEFORE UPDATE OR DELETE ON analysis_question_sources
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
