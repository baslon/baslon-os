CREATE TABLE "approved_diagnosis_headline_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"approved_diagnosis_id" uuid NOT NULL,
	"approved_diagnosis_version" integer NOT NULL,
	"diagnosis_run_id" uuid NOT NULL,
	"proposal_run_id" uuid NOT NULL,
	"review_session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approved_diagnosis_headline_sets_version_unique" UNIQUE("approved_diagnosis_id","version"),
	CONSTRAINT "approved_diagnosis_headline_sets_session_unique" UNIQUE("review_session_id"),
	CONSTRAINT "approved_diagnosis_headline_sets_binding_unique" UNIQUE("id","business_id","approved_diagnosis_id","diagnosis_run_id","review_session_id"),
	CONSTRAINT "approved_diagnosis_headline_sets_version_check" CHECK ("approved_diagnosis_headline_sets"."version" > 0 and "approved_diagnosis_headline_sets"."approved_diagnosis_version" > 0),
	CONSTRAINT "approved_diagnosis_headline_sets_approver_check" CHECK (length(btrim("approved_diagnosis_headline_sets"."approved_by")) > 0)
);
--> statement-breakpoint
CREATE TABLE "approved_diagnosis_headlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"headline_set_id" uuid NOT NULL,
	"approved_diagnosis_id" uuid NOT NULL,
	"diagnosis_run_id" uuid NOT NULL,
	"review_session_id" uuid NOT NULL,
	"diagnosis_item_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"item_ref" text NOT NULL,
	"headline" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approved_diagnosis_headlines_set_item_unique" UNIQUE("headline_set_id","diagnosis_item_id"),
	CONSTRAINT "approved_diagnosis_headlines_ref_check" CHECK ("approved_diagnosis_headlines"."item_ref" ~ '^I(?:[0-9]{3}|[1-9][0-9]{3,})$'),
	CONSTRAINT "approved_diagnosis_headlines_headline_check" CHECK ((
    length(btrim("approved_diagnosis_headlines"."headline")) > 0 and "approved_diagnosis_headlines"."headline" = btrim("approved_diagnosis_headlines"."headline") and char_length("approved_diagnosis_headlines"."headline") <= 120
    and "approved_diagnosis_headlines"."headline" !~ '[\r\n]' and "approved_diagnosis_headlines"."headline" ~ '[[:alnum:]]'
  ))
);
--> statement-breakpoint
CREATE TABLE "diagnosis_headline_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"approved_diagnosis_id" uuid NOT NULL,
	"diagnosis_run_id" uuid NOT NULL,
	"diagnosis_item_id" uuid NOT NULL,
	"item_ref" text NOT NULL,
	"headline" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnosis_headline_proposals_run_item_unique" UNIQUE("analysis_run_id","diagnosis_item_id"),
	CONSTRAINT "diagnosis_headline_proposals_binding_unique" UNIQUE("id","business_id","analysis_run_id","diagnosis_item_id"),
	CONSTRAINT "diagnosis_headline_proposals_ref_check" CHECK ("diagnosis_headline_proposals"."item_ref" ~ '^I(?:[0-9]{3}|[1-9][0-9]{3,})$'),
	CONSTRAINT "diagnosis_headline_proposals_headline_check" CHECK ((
    length(btrim("diagnosis_headline_proposals"."headline")) > 0 and "diagnosis_headline_proposals"."headline" = btrim("diagnosis_headline_proposals"."headline") and char_length("diagnosis_headline_proposals"."headline") <= 120
    and "diagnosis_headline_proposals"."headline" !~ '[\r\n]' and "diagnosis_headline_proposals"."headline" ~ '[[:alnum:]]'
  ))
);
--> statement-breakpoint
CREATE TABLE "diagnosis_headline_review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"approved_diagnosis_id" uuid NOT NULL,
	"diagnosis_run_id" uuid NOT NULL,
	"proposal_run_id" uuid NOT NULL,
	"set_version" integer NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" "diagnosis_review_session_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "diagnosis_headline_review_sessions_version_unique" UNIQUE("approved_diagnosis_id","set_version"),
	CONSTRAINT "diagnosis_headline_review_sessions_binding_unique" UNIQUE("id","business_id","approved_diagnosis_id","diagnosis_run_id","proposal_run_id"),
	CONSTRAINT "diagnosis_headline_review_sessions_version_check" CHECK ("diagnosis_headline_review_sessions"."set_version" > 0),
	CONSTRAINT "diagnosis_headline_review_sessions_reviewer_check" CHECK (length(btrim("diagnosis_headline_review_sessions"."reviewer_id")) > 0),
	CONSTRAINT "diagnosis_headline_review_sessions_completion_check" CHECK (
    ("diagnosis_headline_review_sessions"."status" = 'OPEN' and "diagnosis_headline_review_sessions"."completed_at" is null)
    or ("diagnosis_headline_review_sessions"."status" = 'COMPLETED' and "diagnosis_headline_review_sessions"."completed_at" is not null)
  )
);
--> statement-breakpoint
CREATE TABLE "diagnosis_headline_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"review_session_id" uuid NOT NULL,
	"approved_diagnosis_id" uuid NOT NULL,
	"diagnosis_run_id" uuid NOT NULL,
	"proposal_run_id" uuid NOT NULL,
	"diagnosis_item_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"decision" "evidence_review_decision" NOT NULL,
	"corrected_headline" text,
	"reason" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnosis_headline_reviews_session_item_unique" UNIQUE("review_session_id","diagnosis_item_id"),
	CONSTRAINT "diagnosis_headline_reviews_binding_unique" UNIQUE("id","business_id","review_session_id","diagnosis_item_id"),
	CONSTRAINT "diagnosis_headline_reviews_decision_check" CHECK ("diagnosis_headline_reviews"."decision" in ('ACCEPTED', 'CORRECTED')),
	CONSTRAINT "diagnosis_headline_reviews_corrected_check" CHECK (
    ("diagnosis_headline_reviews"."decision" = 'CORRECTED') = ("diagnosis_headline_reviews"."corrected_headline" is not null)
  ),
	CONSTRAINT "diagnosis_headline_reviews_corrected_headline_check" CHECK ("diagnosis_headline_reviews"."corrected_headline" is null or (
    length(btrim("diagnosis_headline_reviews"."corrected_headline")) > 0 and "diagnosis_headline_reviews"."corrected_headline" = btrim("diagnosis_headline_reviews"."corrected_headline") and char_length("diagnosis_headline_reviews"."corrected_headline") <= 120
    and "diagnosis_headline_reviews"."corrected_headline" !~ '[\r\n]' and "diagnosis_headline_reviews"."corrected_headline" ~ '[[:alnum:]]'
  )),
	CONSTRAINT "diagnosis_headline_reviews_reason_check" CHECK ("diagnosis_headline_reviews"."reason" is null or length(btrim("diagnosis_headline_reviews"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "diagnosis_items" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "approved_diagnoses" ADD CONSTRAINT "approved_diagnoses_id_business_run_unique" UNIQUE("id","business_id","analysis_run_id");--> statement-breakpoint
ALTER TABLE "approved_diagnoses" ADD CONSTRAINT "approved_diagnoses_binding_unique" UNIQUE("id","business_id","analysis_run_id","version");--> statement-breakpoint
ALTER TABLE "approved_diagnosis_headline_sets" ADD CONSTRAINT "approved_diagnosis_headline_sets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnosis_headline_sets" ADD CONSTRAINT "approved_diagnosis_headline_sets_approved_exact_fk" FOREIGN KEY ("approved_diagnosis_id","business_id","diagnosis_run_id","approved_diagnosis_version") REFERENCES "public"."approved_diagnoses"("id","business_id","analysis_run_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnosis_headline_sets" ADD CONSTRAINT "approved_diagnosis_headline_sets_session_same_binding_fk" FOREIGN KEY ("review_session_id","business_id","approved_diagnosis_id","diagnosis_run_id","proposal_run_id") REFERENCES "public"."diagnosis_headline_review_sessions"("id","business_id","approved_diagnosis_id","diagnosis_run_id","proposal_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnosis_headlines" ADD CONSTRAINT "approved_diagnosis_headlines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnosis_headlines" ADD CONSTRAINT "approved_diagnosis_headlines_set_same_binding_fk" FOREIGN KEY ("headline_set_id","business_id","approved_diagnosis_id","diagnosis_run_id","review_session_id") REFERENCES "public"."approved_diagnosis_headline_sets"("id","business_id","approved_diagnosis_id","diagnosis_run_id","review_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnosis_headlines" ADD CONSTRAINT "approved_diagnosis_headlines_review_same_session_fk" FOREIGN KEY ("review_id","business_id","review_session_id","diagnosis_item_id") REFERENCES "public"."diagnosis_headline_reviews"("id","business_id","review_session_id","diagnosis_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_diagnosis_headlines" ADD CONSTRAINT "approved_diagnosis_headlines_item_same_run_fk" FOREIGN KEY ("diagnosis_item_id","business_id","diagnosis_run_id") REFERENCES "public"."diagnosis_items"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_proposals" ADD CONSTRAINT "diagnosis_headline_proposals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_proposals" ADD CONSTRAINT "diagnosis_headline_proposals_run_same_business_fk" FOREIGN KEY ("analysis_run_id","business_id") REFERENCES "public"."analysis_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_proposals" ADD CONSTRAINT "diagnosis_headline_proposals_approved_same_run_fk" FOREIGN KEY ("approved_diagnosis_id","business_id","diagnosis_run_id") REFERENCES "public"."approved_diagnoses"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_proposals" ADD CONSTRAINT "diagnosis_headline_proposals_item_same_run_fk" FOREIGN KEY ("diagnosis_item_id","business_id","diagnosis_run_id") REFERENCES "public"."diagnosis_items"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_review_sessions" ADD CONSTRAINT "diagnosis_headline_review_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_review_sessions" ADD CONSTRAINT "diagnosis_headline_review_sessions_approved_same_run_fk" FOREIGN KEY ("approved_diagnosis_id","business_id","diagnosis_run_id") REFERENCES "public"."approved_diagnoses"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_review_sessions" ADD CONSTRAINT "diagnosis_headline_review_sessions_run_same_business_fk" FOREIGN KEY ("proposal_run_id","business_id") REFERENCES "public"."analysis_runs"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_reviews" ADD CONSTRAINT "diagnosis_headline_reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_reviews" ADD CONSTRAINT "diagnosis_headline_reviews_session_same_binding_fk" FOREIGN KEY ("review_session_id","business_id","approved_diagnosis_id","diagnosis_run_id","proposal_run_id") REFERENCES "public"."diagnosis_headline_review_sessions"("id","business_id","approved_diagnosis_id","diagnosis_run_id","proposal_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_reviews" ADD CONSTRAINT "diagnosis_headline_reviews_proposal_same_run_fk" FOREIGN KEY ("proposal_id","business_id","proposal_run_id","diagnosis_item_id") REFERENCES "public"."diagnosis_headline_proposals"("id","business_id","analysis_run_id","diagnosis_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_headline_reviews" ADD CONSTRAINT "diagnosis_headline_reviews_item_same_run_fk" FOREIGN KEY ("diagnosis_item_id","business_id","diagnosis_run_id") REFERENCES "public"."diagnosis_items"("id","business_id","analysis_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_headline_review_sessions_one_open_unique" ON "diagnosis_headline_review_sessions" USING btree ("approved_diagnosis_id") WHERE "diagnosis_headline_review_sessions"."status" = 'OPEN';--> statement-breakpoint
ALTER TABLE "diagnosis_items" ADD CONSTRAINT "diagnosis_items_headline_check" CHECK ("diagnosis_items"."headline" is null or (
    length(btrim("diagnosis_items"."headline")) > 0 and "diagnosis_items"."headline" = btrim("diagnosis_items"."headline") and char_length("diagnosis_items"."headline") <= 120
    and "diagnosis_items"."headline" !~ '[\r\n]' and "diagnosis_items"."headline" ~ '[[:alnum:]]'
  ));--> statement-breakpoint
-- Diagnosis Item Headline extension. Additive only: no existing row is updated
-- and no historical headline is fabricated. v1 diagnosis items keep a NULL
-- headline; phase1_diagnosis_v2 items must carry one (structure by CHECK).
CREATE OR REPLACE FUNCTION phase1_diagnosis_output_guard() RETURNS trigger AS $$
DECLARE
  run_id uuid;
  run_module text;
  run_status text;
  run_prompt text;
BEGIN
  IF TG_TABLE_NAME = 'diagnosis_calculation_sources' THEN
    SELECT analysis_run_id INTO run_id FROM diagnosis_calculations
      WHERE id = NEW.diagnosis_calculation_id AND business_id = NEW.business_id;
  ELSE
    run_id := NEW.analysis_run_id;
  END IF;
  SELECT module, status::text, prompt_version INTO run_module, run_status, run_prompt FROM analysis_runs
    WHERE id = run_id AND business_id = NEW.business_id;
  IF run_module IS DISTINCT FROM 'phase1_diagnosis' THEN
    RAISE EXCEPTION '% must belong to a phase1_diagnosis analysis run', TG_TABLE_NAME;
  END IF;
  IF run_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION '% can only be written while its diagnosis run is RUNNING', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'diagnosis_items' THEN
    IF run_prompt = 'phase1_diagnosis_v2' THEN
      IF NEW.headline IS NULL THEN
        RAISE EXCEPTION 'phase1_diagnosis_v2 diagnosis items require a headline';
      END IF;
    ELSIF run_prompt = 'phase1_diagnosis_v1' THEN
      IF NEW.headline IS NOT NULL THEN
        RAISE EXCEPTION 'phase1_diagnosis_v1 diagnosis items have no headline';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported phase1_diagnosis prompt version %', run_prompt;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- As in 0007, plus: an approval uses the artifact contract of its run's prompt version.
CREATE OR REPLACE FUNCTION approved_diagnosis_guard() RETURNS trigger AS $$
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
  IF NOT (
    (run_record.prompt_version = 'phase1_diagnosis_v1' AND NEW.artifact_version = 'phase1_diagnosis_artifact_v1')
    OR (run_record.prompt_version = 'phase1_diagnosis_v2' AND NEW.artifact_version = 'phase1_diagnosis_artifact_v2')
  ) THEN
    RAISE EXCEPTION 'an approved diagnosis must use the artifact contract of its run prompt version';
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
-- Exact duplicate headlines within one approved set are refused (conservative
-- normalisation only: trim, case-fold, collapse whitespace). Semantic overlap
-- remains a human judgement.
CREATE UNIQUE INDEX "approved_diagnosis_headlines_text_unique" ON approved_diagnosis_headlines
  (headline_set_id, lower(regexp_replace(btrim(headline), '\s+', ' ', 'g')));
--> statement-breakpoint
-- Companion headlines label only the effective (ACCEPTED or CORRECTED) items of
-- their exact approved diagnosis. A REJECTED item can never carry a headline.
CREATE FUNCTION diagnosis_headline_item_guard() RETURNS trigger AS $$
DECLARE
  item_ref_value text;
BEGIN
  SELECT item.item_ref INTO item_ref_value
    FROM approved_diagnoses approved
    JOIN diagnosis_item_reviews review
      ON review.review_session_id = approved.review_session_id AND review.business_id = approved.business_id
    JOIN diagnosis_items item
      ON item.id = review.diagnosis_item_id AND item.business_id = review.business_id
    WHERE approved.id = NEW.approved_diagnosis_id
      AND approved.business_id = NEW.business_id
      AND approved.analysis_run_id = NEW.diagnosis_run_id
      AND review.diagnosis_item_id = NEW.diagnosis_item_id
      AND review.decision IN ('ACCEPTED', 'CORRECTED');
  IF item_ref_value IS NULL THEN
    RAISE EXCEPTION '% may only label an ACCEPTED or CORRECTED item of its approved diagnosis', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME <> 'diagnosis_headline_reviews' THEN
    IF NEW.item_ref IS DISTINCT FROM item_ref_value THEN
      RAISE EXCEPTION '% item_ref must match its diagnosis item', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- Proposals are written only with their own RUNNING diagnosis_headlines run, which
-- reads the approved diagnosis's snapshot and proposes for that diagnosis alone.
CREATE FUNCTION diagnosis_headline_proposal_guard() RETURNS trigger AS $$
DECLARE
  run_record record;
  approved_snapshot uuid;
BEGIN
  SELECT module, status::text AS status, input_snapshot_id INTO run_record FROM analysis_runs
    WHERE id = NEW.analysis_run_id AND business_id = NEW.business_id;
  IF run_record.module IS DISTINCT FROM 'diagnosis_headlines' THEN
    RAISE EXCEPTION 'diagnosis_headline_proposals must belong to a diagnosis_headlines analysis run';
  END IF;
  IF run_record.status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'diagnosis_headline_proposals can only be written while their run is RUNNING';
  END IF;
  SELECT snapshot_id INTO approved_snapshot FROM approved_diagnoses
    WHERE id = NEW.approved_diagnosis_id AND business_id = NEW.business_id;
  IF approved_snapshot IS DISTINCT FROM run_record.input_snapshot_id THEN
    RAISE EXCEPTION 'a headline proposal run must read the snapshot of its approved diagnosis';
  END IF;
  IF EXISTS (
    SELECT 1 FROM diagnosis_headline_proposals proposal
    WHERE proposal.analysis_run_id = NEW.analysis_run_id
      AND proposal.approved_diagnosis_id <> NEW.approved_diagnosis_id
  ) THEN
    RAISE EXCEPTION 'a headline proposal run proposes for exactly one approved diagnosis';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER diagnosis_headline_proposals_output_guard
BEFORE INSERT ON diagnosis_headline_proposals
FOR EACH ROW EXECUTE FUNCTION diagnosis_headline_proposal_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_headline_proposals_item_guard
BEFORE INSERT ON diagnosis_headline_proposals
FOR EACH ROW EXECUTE FUNCTION diagnosis_headline_item_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_headline_proposals_immutable
BEFORE UPDATE OR DELETE ON diagnosis_headline_proposals
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
-- A headline review is created OPEN for a successful proposal run that covers
-- every effective item exactly once, prepares the next set version, may only move
-- OPEN -> COMPLETED, and completes only when every effective item has a decision.
CREATE FUNCTION diagnosis_headline_review_session_guard() RETURNS trigger AS $$
DECLARE
  deletion_business_id text;
  run_record record;
  effective_count integer;
  proposal_count integer;
  bound_count integer;
  next_version integer;
  undecided integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'diagnosis_headline_review_sessions must be created OPEN';
    END IF;
    SELECT module, status::text AS status INTO run_record FROM analysis_runs
      WHERE id = NEW.proposal_run_id AND business_id = NEW.business_id;
    IF run_record.module IS DISTINCT FROM 'diagnosis_headlines' OR run_record.status IS DISTINCT FROM 'SUCCEEDED' THEN
      RAISE EXCEPTION 'a headline review requires a successful diagnosis_headlines run';
    END IF;
    SELECT count(*) INTO effective_count
      FROM approved_diagnoses approved
      JOIN diagnosis_item_reviews review
        ON review.review_session_id = approved.review_session_id AND review.business_id = approved.business_id
      WHERE approved.id = NEW.approved_diagnosis_id
        AND approved.business_id = NEW.business_id
        AND review.decision IN ('ACCEPTED', 'CORRECTED');
    SELECT count(*), count(*) FILTER (WHERE approved_diagnosis_id = NEW.approved_diagnosis_id)
      INTO proposal_count, bound_count
      FROM diagnosis_headline_proposals
      WHERE analysis_run_id = NEW.proposal_run_id AND business_id = NEW.business_id;
    IF effective_count = 0 OR proposal_count <> effective_count OR bound_count <> effective_count THEN
      RAISE EXCEPTION 'a headline review requires exactly one proposal for every effective item of its approved diagnosis';
    END IF;
    SELECT coalesce(max(version), 0) + 1 INTO next_version FROM approved_diagnosis_headline_sets
      WHERE approved_diagnosis_id = NEW.approved_diagnosis_id AND business_id = NEW.business_id;
    IF NEW.set_version IS DISTINCT FROM next_version THEN
      RAISE EXCEPTION 'a headline review must prepare the next headline set version (%)', next_version;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    deletion_business_id := current_setting('baslon.permanent_delete_business_id', true);
    IF deletion_business_id IS NOT NULL AND deletion_business_id = OLD.business_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'diagnosis_headline_review_sessions records are immutable outside permanent Business deletion';
  END IF;

  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION 'completed diagnosis_headline_review_sessions records are immutable';
  END IF;
  IF NEW.status <> 'COMPLETED'
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.business_id IS DISTINCT FROM OLD.business_id
    OR NEW.approved_diagnosis_id IS DISTINCT FROM OLD.approved_diagnosis_id
    OR NEW.diagnosis_run_id IS DISTINCT FROM OLD.diagnosis_run_id
    OR NEW.proposal_run_id IS DISTINCT FROM OLD.proposal_run_id
    OR NEW.set_version IS DISTINCT FROM OLD.set_version
    OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'diagnosis_headline_review_sessions may only change from OPEN to COMPLETED';
  END IF;
  SELECT count(*) INTO undecided FROM diagnosis_headline_proposals proposal
    WHERE proposal.analysis_run_id = OLD.proposal_run_id
      AND proposal.business_id = OLD.business_id
      AND NOT EXISTS (
        SELECT 1 FROM diagnosis_headline_reviews review
        WHERE review.review_session_id = OLD.id AND review.diagnosis_item_id = proposal.diagnosis_item_id
      );
  IF undecided > 0 THEN
    RAISE EXCEPTION 'every effective item requires a final headline before the headline review completes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER diagnosis_headline_review_sessions_guard
BEFORE INSERT OR UPDATE OR DELETE ON diagnosis_headline_review_sessions
FOR EACH ROW EXECUTE FUNCTION diagnosis_headline_review_session_guard();--> statement-breakpoint
-- A headline review completes only by approving its headline set, in the same transaction.
CREATE FUNCTION diagnosis_headline_review_session_approved() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM approved_diagnosis_headline_sets headline_set WHERE headline_set.review_session_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a headline review completes only by approving its headline set';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER diagnosis_headline_review_sessions_approved
AFTER UPDATE ON diagnosis_headline_review_sessions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION diagnosis_headline_review_session_approved();--> statement-breakpoint
CREATE FUNCTION diagnosis_headline_review_guard() RETURNS trigger AS $$
DECLARE
  session_status text;
BEGIN
  SELECT status::text INTO session_status FROM diagnosis_headline_review_sessions
    WHERE id = NEW.review_session_id AND business_id = NEW.business_id;
  IF session_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'headline decisions require an OPEN headline review session';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER diagnosis_headline_reviews_open_session_guard
BEFORE INSERT ON diagnosis_headline_reviews
FOR EACH ROW EXECUTE FUNCTION diagnosis_headline_review_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_headline_reviews_item_guard
BEFORE INSERT ON diagnosis_headline_reviews
FOR EACH ROW EXECUTE FUNCTION diagnosis_headline_item_guard();--> statement-breakpoint
CREATE TRIGGER diagnosis_headline_reviews_immutable
BEFORE UPDATE OR DELETE ON diagnosis_headline_reviews
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
-- An approved headline set records its COMPLETED review, that review's set version
-- and reviewer, and (checked at commit) exactly one headline per effective item.
CREATE FUNCTION approved_diagnosis_headline_set_guard() RETURNS trigger AS $$
DECLARE
  session_record record;
BEGIN
  SELECT status::text AS status, set_version, reviewer_id INTO session_record
    FROM diagnosis_headline_review_sessions
    WHERE id = NEW.review_session_id AND business_id = NEW.business_id;
  IF session_record.status IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'an approved headline set requires a COMPLETED headline review';
  END IF;
  IF NEW.version IS DISTINCT FROM session_record.set_version THEN
    RAISE EXCEPTION 'an approved headline set must carry the version its review prepared';
  END IF;
  IF NEW.approved_by IS DISTINCT FROM session_record.reviewer_id THEN
    RAISE EXCEPTION 'an approved headline set must be approved by its reviewer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER approved_diagnosis_headline_sets_guard
BEFORE INSERT ON approved_diagnosis_headline_sets
FOR EACH ROW EXECUTE FUNCTION approved_diagnosis_headline_set_guard();--> statement-breakpoint
CREATE FUNCTION approved_diagnosis_headline_set_complete() RETURNS trigger AS $$
DECLARE
  expected integer;
  actual integer;
BEGIN
  SELECT count(*) INTO expected
    FROM approved_diagnoses approved
    JOIN diagnosis_item_reviews review
      ON review.review_session_id = approved.review_session_id AND review.business_id = approved.business_id
    WHERE approved.id = NEW.approved_diagnosis_id
      AND approved.business_id = NEW.business_id
      AND review.decision IN ('ACCEPTED', 'CORRECTED');
  SELECT count(*) INTO actual FROM approved_diagnosis_headlines WHERE headline_set_id = NEW.id;
  IF actual <> expected THEN
    RAISE EXCEPTION 'an approved headline set must hold exactly one headline for every effective item';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER approved_diagnosis_headline_sets_complete
AFTER INSERT ON approved_diagnosis_headline_sets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION approved_diagnosis_headline_set_complete();--> statement-breakpoint
CREATE TRIGGER approved_diagnosis_headline_sets_immutable
BEFORE UPDATE OR DELETE ON approved_diagnosis_headline_sets
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();--> statement-breakpoint
-- An approved headline is exactly its reviewed headline: the proposal when
-- ACCEPTED, the correction when CORRECTED.
CREATE FUNCTION approved_diagnosis_headline_guard() RETURNS trigger AS $$
DECLARE
  review_record record;
BEGIN
  SELECT review.decision::text AS decision, review.corrected_headline, proposal.headline AS proposed
    INTO review_record
    FROM diagnosis_headline_reviews review
    JOIN diagnosis_headline_proposals proposal
      ON proposal.id = review.proposal_id AND proposal.business_id = review.business_id
    WHERE review.id = NEW.review_id AND review.business_id = NEW.business_id;
  IF NEW.headline IS DISTINCT FROM (
    CASE WHEN review_record.decision = 'CORRECTED' THEN review_record.corrected_headline ELSE review_record.proposed END
  ) THEN
    RAISE EXCEPTION 'an approved headline must be exactly its reviewed headline';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER approved_diagnosis_headlines_guard
BEFORE INSERT ON approved_diagnosis_headlines
FOR EACH ROW EXECUTE FUNCTION approved_diagnosis_headline_guard();--> statement-breakpoint
CREATE TRIGGER approved_diagnosis_headlines_item_guard
BEFORE INSERT ON approved_diagnosis_headlines
FOR EACH ROW EXECUTE FUNCTION diagnosis_headline_item_guard();--> statement-breakpoint
CREATE TRIGGER approved_diagnosis_headlines_immutable
BEFORE UPDATE OR DELETE ON approved_diagnosis_headlines
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
