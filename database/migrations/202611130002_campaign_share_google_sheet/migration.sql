ALTER TABLE "campaign_sharing"
  ADD COLUMN "spreadsheet_id" TEXT,
  ADD COLUMN "spreadsheet_exported_at" TIMESTAMPTZ(3),
  ADD COLUMN "spreadsheet_sharing_version" INTEGER;

CREATE UNIQUE INDEX "campaign_sharing_spreadsheet_id_key" ON "campaign_sharing" ("spreadsheet_id");
