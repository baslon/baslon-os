CREATE TYPE "public"."evidence_extraction_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."evidence_proposal_type" AS ENUM('claim', 'evidence', 'metric', 'claim_evidence');--> statement-breakpoint
CREATE TABLE "evidence_extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"raw_intake_text" text NOT NULL,
	"source_type" text,
	"source_reference" text,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "evidence_extraction_run_status" DEFAULT 'RUNNING' NOT NULL,
	"raw_model_output" jsonb,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "evidence_extraction_runs_id_business_unique" UNIQUE("id","business_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"proposal_ref" text NOT NULL,
	"proposal_type" "evidence_proposal_type" NOT NULL,
	"structured_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_proposals_run_ref_unique" UNIQUE("extraction_run_id","proposal_ref")
);
--> statement-breakpoint
ALTER TABLE "evidence_extraction_runs" ADD CONSTRAINT "evidence_extraction_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_proposals" ADD CONSTRAINT "evidence_proposals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_proposals" ADD CONSTRAINT "evidence_proposals_run_same_business_fk" FOREIGN KEY ("extraction_run_id","business_id") REFERENCES "public"."evidence_extraction_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_extraction_runs_business_idx" ON "evidence_extraction_runs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_proposals_business_idx" ON "evidence_proposals" USING btree ("business_id","created_at");