CREATE TABLE "source_submission_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"source_submission_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_submission_attachments_byte_size_check" CHECK ("source_submission_attachments"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "source_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"description" text,
	"raw_text" text,
	"source_reference" text,
	"source_occurred_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_submissions_id_business_unique" UNIQUE("id","business_id")
);
--> statement-breakpoint
ALTER TABLE "evidence_extraction_runs" ADD COLUMN "source_submission_id" uuid;--> statement-breakpoint
ALTER TABLE "source_submission_attachments" ADD CONSTRAINT "source_submission_attachments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_submission_attachments" ADD CONSTRAINT "source_submission_attachments_same_business_fk" FOREIGN KEY ("source_submission_id","business_id") REFERENCES "public"."source_submissions"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_submissions" ADD CONSTRAINT "source_submissions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_submission_attachments_submission_idx" ON "source_submission_attachments" USING btree ("source_submission_id","created_at");--> statement-breakpoint
CREATE INDEX "source_submissions_business_submitted_idx" ON "source_submissions" USING btree ("business_id","submitted_at");--> statement-breakpoint
ALTER TABLE "evidence_extraction_runs" ADD CONSTRAINT "evidence_extraction_runs_source_submission_same_business_fk" FOREIGN KEY ("source_submission_id","business_id") REFERENCES "public"."source_submissions"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_extraction_runs_source_submission_idx" ON "evidence_extraction_runs" USING btree ("source_submission_id");
--> statement-breakpoint
CREATE TRIGGER source_submissions_immutable
BEFORE UPDATE OR DELETE ON source_submissions
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
--> statement-breakpoint
CREATE TRIGGER source_submission_attachments_immutable
BEFORE UPDATE OR DELETE ON source_submission_attachments
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
