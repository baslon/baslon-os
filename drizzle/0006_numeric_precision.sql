CREATE TYPE "public"."numeric_precision" AS ENUM('exact', 'approximate', 'estimate', 'range', 'unspecified');--> statement-breakpoint
ALTER TABLE "metrics" ALTER COLUMN "numeric_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "value_precision" numeric_precision DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "value_lower" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "value_upper" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "numeric_precision" numeric_precision DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "numeric_lower" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "numeric_upper" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_value_precision_check" CHECK (
    ("evidence"."value_precision" = 'range'
      and "evidence"."value_lower" is not null and "evidence"."value_upper" is not null
      and "evidence"."value_lower" <= "evidence"."value_upper" and "evidence"."value_numeric" is null)
    or ("evidence"."value_precision" in ('exact', 'approximate', 'estimate')
      and "evidence"."value_numeric" is not null and "evidence"."value_lower" is null and "evidence"."value_upper" is null)
    or ("evidence"."value_precision" = 'unspecified'
      and "evidence"."value_lower" is null and "evidence"."value_upper" is null)
  );--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_numeric_precision_check" CHECK (
    ("metrics"."numeric_precision" = 'range'
      and "metrics"."numeric_lower" is not null and "metrics"."numeric_upper" is not null
      and "metrics"."numeric_lower" <= "metrics"."numeric_upper" and "metrics"."numeric_value" is null)
    or ("metrics"."numeric_precision" in ('exact', 'approximate', 'estimate', 'unspecified')
      and "metrics"."numeric_value" is not null and "metrics"."numeric_lower" is null and "metrics"."numeric_upper" is null)
  );