CREATE OR REPLACE FUNCTION prevent_immutable_record_change() RETURNS trigger AS $$
DECLARE
  deletion_business_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    deletion_business_id := current_setting('baslon.permanent_delete_business_id', true);
    IF deletion_business_id IS NOT NULL AND deletion_business_id = OLD.business_id::text THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_evidence_review_history_mutation() RETURNS trigger AS $$
DECLARE
  deletion_business_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    deletion_business_id := current_setting('baslon.permanent_delete_business_id', true);
    IF deletion_business_id IS NOT NULL AND deletion_business_id = OLD.business_id::text THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
