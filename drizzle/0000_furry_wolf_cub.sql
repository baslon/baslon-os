CREATE TYPE "public"."actor_type" AS ENUM('human', 'system', 'ai');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('fact', 'observation', 'management_belief', 'hypothesis', 'ai_inference', 'unknown', 'decision');--> statement-breakpoint
CREATE TYPE "public"."claim_evidence_relationship" AS ENUM('supports', 'contradicts', 'context');--> statement-breakpoint
CREATE TYPE "public"."workflow_event" AS ENUM('START_INTAKE', 'SUBMIT_INTAKE', 'ADD_EVIDENCE', 'MARK_UNKNOWN', 'CONTINUE_WITH_GAPS', 'GENERATE_PHASE1', 'APPROVE_PHASE1', 'REQUEST_REVISION', 'REJECT_PHASE1', 'PROCESS_EVIDENCE', 'RUN_GAP_ANALYSIS', 'MARK_ANALYSIS_COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."workflow_state" AS ENUM('NEW', 'INTAKE_IN_PROGRESS', 'INTAKE_READY', 'EVIDENCE_PROCESSING', 'EVIDENCE_READY', 'GAP_ANALYSIS', 'GAP_RESOLUTION_REQUIRED', 'PHASE1_READY', 'PHASE1_ANALYSING', 'PHASE1_AWAITING_REVIEW', 'REVISION_REQUIRED', 'PHASE1_APPROVED');--> statement-breakpoint
CREATE TABLE "business_profiles" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"profile_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_state_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"created_from_analysis_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_state_snapshots_business_version_unique" UNIQUE("business_id","version"),
	CONSTRAINT "business_state_snapshots_version_check" CHECK ("business_state_snapshots"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"website_url" text,
	"sector" text,
	"status" text DEFAULT 'active' NOT NULL,
	"primary_geography" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"business_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"relationship_type" "claim_evidence_relationship" NOT NULL,
	"strength_score" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_evidence_claim_id_evidence_id_relationship_type_pk" PRIMARY KEY("claim_id","evidence_id","relationship_type"),
	CONSTRAINT "claim_evidence_strength_check" CHECK ("claim_evidence"."strength_score" is null or ("claim_evidence"."strength_score" >= 0 and "claim_evidence"."strength_score" <= 1))
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"claim_type" "claim_type" NOT NULL,
	"subject_area" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence_level" text NOT NULL,
	"confidence_score" numeric(5, 4),
	"confidence_basis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by_claim_id" uuid,
	CONSTRAINT "claims_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "claims_confidence_score_check" CHECK ("claims"."confidence_score" is null or ("claims"."confidence_score" >= 0 and "claims"."confidence_score" <= 1)),
	CONSTRAINT "claims_fact_admission_audit_check" CHECK (
    "claims"."claim_type" <> 'fact' or (
      "claims"."confidence_basis" @> '{"factAdmission":{"actorType":"human"}}'::jsonb
      and jsonb_typeof("claims"."confidence_basis" #> '{factAdmission,supportingEvidenceIds}') = 'array'
      and jsonb_array_length("claims"."confidence_basis" #> '{factAdmission,supportingEvidenceIds}') > 0
    )
  )
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"statement" text NOT NULL,
	"value_numeric" numeric(20, 4),
	"value_text" text,
	"unit" text,
	"period_start" date,
	"period_end" date,
	"source_type" text NOT NULL,
	"source_reference" text,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reliability_level" text NOT NULL,
	"reliability_score" numeric(5, 4),
	"directness_level" text NOT NULL,
	"recency_level" text NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"materiality" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "evidence_period_check" CHECK ("evidence"."period_end" is null or "evidence"."period_start" is null or "evidence"."period_end" >= "evidence"."period_start"),
	CONSTRAINT "evidence_reliability_score_check" CHECK ("evidence"."reliability_score" is null or ("evidence"."reliability_score" >= 0 and "evidence"."reliability_score" <= 1))
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"metric_label" text NOT NULL,
	"numeric_value" numeric(20, 4) NOT NULL,
	"unit" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"dimension_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_period_check" CHECK ("metrics"."period_end" is null or "metrics"."period_start" is null or "metrics"."period_end" >= "metrics"."period_start")
);
--> statement-breakpoint
CREATE TABLE "strategy_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"state" "workflow_state" DEFAULT 'NEW' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_workflows_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"from_state" "workflow_state" NOT NULL,
	"to_state" "workflow_state" NOT NULL,
	"event" "workflow_event" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_state_snapshots" ADD CONSTRAINT "business_state_snapshots_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_same_business_fk" FOREIGN KEY ("claim_id","business_id") REFERENCES "public"."claims"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_same_business_fk" FOREIGN KEY ("evidence_id","business_id") REFERENCES "public"."evidence"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_superseded_same_business_fk" FOREIGN KEY ("superseded_by_claim_id","business_id") REFERENCES "public"."claims"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_source_evidence_same_business_fk" FOREIGN KEY ("source_evidence_id","business_id") REFERENCES "public"."evidence"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_workflows" ADD CONSTRAINT "strategy_workflows_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_workflow_id_strategy_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."strategy_workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "businesses_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "claims_business_idx" ON "claims" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "evidence_business_idx" ON "evidence" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "metrics_business_key_idx" ON "metrics" USING btree ("business_id","metric_key");--> statement-breakpoint
CREATE INDEX "workflow_transitions_workflow_idx" ON "workflow_transitions" USING btree ("workflow_id","created_at");
--> statement-breakpoint
CREATE FUNCTION prevent_immutable_record_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER business_state_snapshots_immutable
BEFORE UPDATE OR DELETE ON "business_state_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
--> statement-breakpoint
CREATE TRIGGER evidence_immutable
BEFORE UPDATE OR DELETE ON "evidence"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
