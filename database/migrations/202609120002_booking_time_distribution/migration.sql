ALTER TABLE "booking_records"
  ADD COLUMN "overall_start_date" DATE,
  ADD COLUMN "overall_end_date" DATE,
  ADD COLUMN "campaign_dates_auto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "time_distribution" JSONB NOT NULL DEFAULT '{"version":1,"mode":"AUTO","segments":[],"fillRemainder":true}'::jsonb;

ALTER TABLE "booking_records" ADD CONSTRAINT "booking_overall_dates_valid"
  CHECK ("overall_start_date" IS NULL OR "overall_end_date" IS NULL OR "overall_start_date" <= "overall_end_date");
