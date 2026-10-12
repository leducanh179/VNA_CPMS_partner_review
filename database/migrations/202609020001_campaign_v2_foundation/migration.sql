-- Campaign V2 foundation is intentionally additive. Legacy field_values and
-- every existing Campaign column remain in place for dual-read/dual-write.

CREATE TYPE "CampaignNormalizationStatus" AS ENUM ('CURRENT', 'NEEDS_NORMALIZATION');
CREATE TYPE "CampaignMarketSelectionOrigin" AS ENUM ('CUSTOM', 'REGION', 'GLOBAL', 'LEGACY');
CREATE TYPE "OrganizationUnitCategory" AS ENUM ('QUICK_SELECT', 'FOREIGN_BRANCH');

CREATE TABLE "campaign_levels" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "rule_description" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "campaign_levels_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "campaign_objectives" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "requires_other_text" BOOLEAN NOT NULL DEFAULT false,
  "display_order" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "campaign_objectives_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "market_regions" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "market_regions_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "markets" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "region_code" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "markets_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "organization_units" (
  "code" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "source_name" TEXT,
  "category" "OrganizationUnitCategory" NOT NULL,
  "source_provider" TEXT NOT NULL,
  "source_unit_id" TEXT,
  "source_unit_code" TEXT,
  "market_code" TEXT,
  "display_order" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "organization_units_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "personnel_directory_entries" (
  "employee_code" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "gender" TEXT,
  "organization_code" TEXT,
  "organization_name" TEXT NOT NULL,
  "department_name" TEXT,
  "job_title" TEXT,
  "phone_text" TEXT,
  "email" TEXT,
  "birth_year" INTEGER,
  "source_provider" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "personnel_directory_entries_pkey" PRIMARY KEY ("employee_code"),
  CONSTRAINT "personnel_directory_birth_year_check" CHECK ("birth_year" IS NULL OR "birth_year" BETWEEN 1900 AND 2100)
);

CREATE TABLE "content_pillars" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "level" INTEGER NOT NULL,
  "parent_code" TEXT,
  "effective_start" DATE,
  "effective_end" DATE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "content_pillars_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "content_pillars_level_check" CHECK ("level" IN (1, 2))
);

ALTER TABLE "campaigns"
  ALTER COLUMN "requesting_unit" DROP NOT NULL,
  ADD COLUMN "effective_start_date" DATE,
  ADD COLUMN "effective_end_date" DATE,
  ADD COLUMN "level_code" TEXT,
  ADD COLUMN "requesting_employee_code" TEXT,
  ADD COLUMN "manual_requester_email" TEXT,
  ADD COLUMN "primary_objective_code" TEXT,
  ADD COLUMN "primary_objective_other" TEXT,
  ADD COLUMN "kpi_text" TEXT,
  ADD COLUMN "description_rich_text" JSONB,
  ADD COLUMN "additional_information" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "data_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "normalization_status" "CampaignNormalizationStatus" NOT NULL DEFAULT 'NEEDS_NORMALIZATION';

CREATE TABLE "campaign_markets" (
  "campaign_id" UUID NOT NULL,
  "market_code" TEXT NOT NULL,
  "selection_origin" "CampaignMarketSelectionOrigin" NOT NULL DEFAULT 'CUSTOM',
  "selection_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_markets_pkey" PRIMARY KEY ("campaign_id", "market_code")
);

CREATE TABLE "campaign_requesting_units" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "organization_unit_code" TEXT,
  "custom_name" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "campaign_requesting_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_requesting_units_value_check" CHECK (
    ("organization_unit_code" IS NOT NULL AND "custom_name" IS NULL)
    OR ("organization_unit_code" IS NULL AND length(btrim("custom_name")) > 0)
  )
);

CREATE UNIQUE INDEX "organization_units_source_unit_id_key" ON "organization_units"("source_unit_id");
CREATE INDEX "markets_region_code_is_active_display_order_idx" ON "markets"("region_code", "is_active", "display_order");
CREATE INDEX "organization_units_category_is_active_display_order_idx" ON "organization_units"("category", "is_active", "display_order");
CREATE INDEX "organization_units_market_code_idx" ON "organization_units"("market_code");
CREATE INDEX "personnel_directory_entries_full_name_idx" ON "personnel_directory_entries"("full_name");
CREATE INDEX "personnel_directory_entries_email_idx" ON "personnel_directory_entries"("email");
CREATE INDEX "personnel_directory_entries_organization_code_department_name_idx" ON "personnel_directory_entries"("organization_code", "department_name");
CREATE INDEX "content_pillars_year_level_is_active_idx" ON "content_pillars"("year", "level", "is_active");
CREATE INDEX "content_pillars_parent_code_idx" ON "content_pillars"("parent_code");
CREATE INDEX "campaigns_level_code_idx" ON "campaigns"("level_code");
CREATE INDEX "campaigns_requesting_employee_code_idx" ON "campaigns"("requesting_employee_code");
CREATE INDEX "campaigns_primary_objective_code_idx" ON "campaigns"("primary_objective_code");
CREATE INDEX "campaigns_normalization_status_idx" ON "campaigns"("normalization_status");
CREATE INDEX "campaign_markets_market_code_idx" ON "campaign_markets"("market_code");
CREATE UNIQUE INDEX "campaign_requesting_units_campaign_id_organization_unit_code_key" ON "campaign_requesting_units"("campaign_id", "organization_unit_code");
CREATE INDEX "campaign_requesting_units_organization_unit_code_idx" ON "campaign_requesting_units"("organization_unit_code");

ALTER TABLE "markets" ADD CONSTRAINT "markets_region_code_fkey" FOREIGN KEY ("region_code") REFERENCES "market_regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_market_code_fkey" FOREIGN KEY ("market_code") REFERENCES "markets"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "content_pillars"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_level_code_fkey" FOREIGN KEY ("level_code") REFERENCES "campaign_levels"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_requesting_employee_code_fkey" FOREIGN KEY ("requesting_employee_code") REFERENCES "personnel_directory_entries"("employee_code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_primary_objective_code_fkey" FOREIGN KEY ("primary_objective_code") REFERENCES "campaign_objectives"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaign_markets" ADD CONSTRAINT "campaign_markets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_markets" ADD CONSTRAINT "campaign_markets_market_code_fkey" FOREIGN KEY ("market_code") REFERENCES "markets"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaign_requesting_units" ADD CONSTRAINT "campaign_requesting_units_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_requesting_units" ADD CONSTRAINT "campaign_requesting_units_organization_unit_code_fkey" FOREIGN KEY ("organization_unit_code") REFERENCES "organization_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
