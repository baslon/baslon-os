CREATE TYPE "public"."evidence_review_decision" AS ENUM('ACCEPTED', 'CORRECTED', 'REJECTED', 'UNRESOLVED');--> statement-breakpoint
CREATE TYPE "public"."evidence_review_session_status" AS ENUM('OPEN', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."review_canonical_entity_type" AS ENUM('claim', 'evidence', 'metric', 'claim_evidence');--> statement-breakpoint
CREATE TABLE "evidence_review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" "evidence_review_session_status" DEFAULT 'OPEN' NOT NULL,
	"resulting_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "evidence_review_sessions_run_unique" UNIQUE("extraction_run_id"),
	CONSTRAINT "evidence_review_sessions_id_business_run_unique" UNIQUE("id","business_id","extraction_run_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_session_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"decision" "evidence_review_decision" NOT NULL,
	"reviewed_payload" jsonb,
	"reason" text,
	"canonical_entity_type" "review_canonical_entity_type",
	"canonical_entity_id" uuid,
	"canonical_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_reviews_proposal_unique" UNIQUE("proposal_id"),
	CONSTRAINT "proposal_reviews_corrected_payload_check" CHECK (
    ("proposal_reviews"."decision" = 'CORRECTED' and "proposal_reviews"."reviewed_payload" is not null)
    or ("proposal_reviews"."decision" <> 'CORRECTED' and "proposal_reviews"."reviewed_payload" is null)
  ),
	CONSTRAINT "proposal_reviews_noncanonical_decision_check" CHECK (
    "proposal_reviews"."decision" not in ('REJECTED', 'UNRESOLVED')
    or ("proposal_reviews"."canonical_entity_type" is null and "proposal_reviews"."canonical_entity_id" is null)
  )
);
--> statement-breakpoint
ALTER TABLE "evidence_review_sessions" ADD CONSTRAINT "evidence_review_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_state_snapshots" ADD CONSTRAINT "business_state_snapshots_id_business_unique" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "evidence_review_sessions" ADD CONSTRAINT "evidence_review_sessions_run_same_business_fk" FOREIGN KEY ("extraction_run_id","business_id") REFERENCES "public"."evidence_extraction_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_review_sessions" ADD CONSTRAINT "evidence_review_sessions_snapshot_same_business_fk" FOREIGN KEY ("resulting_snapshot_id","business_id") REFERENCES "public"."business_state_snapshots"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_reviews" ADD CONSTRAINT "proposal_reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_reviews" ADD CONSTRAINT "proposal_reviews_session_same_business_run_fk" FOREIGN KEY ("review_session_id","business_id","extraction_run_id") REFERENCES "public"."evidence_review_sessions"("id","business_id","extraction_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_proposals" ADD CONSTRAINT "evidence_proposals_id_business_run_unique" UNIQUE("id","business_id","extraction_run_id");--> statement-breakpoint
ALTER TABLE "proposal_reviews" ADD CONSTRAINT "proposal_reviews_proposal_same_business_run_fk" FOREIGN KEY ("proposal_id","business_id","extraction_run_id") REFERENCES "public"."evidence_proposals"("id","business_id","extraction_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_reviews_session_idx" ON "proposal_reviews" USING btree ("review_session_id","reviewed_at");--> statement-breakpoint
CREATE FUNCTION prevent_evidence_review_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER evidence_proposals_immutable
BEFORE UPDATE OR DELETE ON evidence_proposals
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_review_history_mutation();--> statement-breakpoint
CREATE TRIGGER proposal_reviews_immutable
BEFORE UPDATE OR DELETE ON proposal_reviews
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_review_history_mutation();
