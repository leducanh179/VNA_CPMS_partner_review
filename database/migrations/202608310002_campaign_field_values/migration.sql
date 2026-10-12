ALTER TABLE "campaigns"
ADD COLUMN "field_values" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "campaigns"
SET "field_values" = jsonb_build_object(
  'campaign_code', "code",
  'campaign_name', "name",
  'requesting_unit', "requesting_unit",
  'campaign_lifecycle_state', "lifecycle_state"::text,
  'campaign_comm_start_date', CASE WHEN "start_date" IS NULL THEN NULL ELSE to_char("start_date", 'YYYY-MM-DD') END,
  'campaign_comm_end_date', CASE WHEN "end_date" IS NULL THEN NULL ELSE to_char("end_date", 'YYYY-MM-DD') END
);
