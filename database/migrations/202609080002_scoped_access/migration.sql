-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "preset_initialized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "record_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "business_revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "requesting_department_id" UUID,
ADD COLUMN     "requesting_division_id" UUID;

-- CreateTable
CREATE TABLE "permission_definitions" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "group_label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supported_scopes" TEXT[],
    "implementation_status" TEXT NOT NULL DEFAULT 'RESERVED',

    CONSTRAINT "permission_definitions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_code" TEXT NOT NULL,
    "permission_code" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'ALLOW',
    "relation" TEXT NOT NULL,
    "default_scope" TEXT NOT NULL DEFAULT 'MODULE',

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_permission_overrides" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "module" TEXT,
    "org_id" UUID,
    "campaign_id" UUID,
    "field_key" TEXT,
    "relation" TEXT NOT NULL DEFAULT 'ALL',
    "relation_org_id" UUID,
    "valid_from" TIMESTAMPTZ(3),
    "valid_until" TIMESTAMPTZ(3),
    "record_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "account_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_policy_state" (
    "key" TEXT NOT NULL,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "access_policy_state_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "campaign_participants" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "actor_id" UUID,
    "org_id" UUID,
    "functional_role" TEXT NOT NULL,
    "responsibility" TEXT NOT NULL,
    "assigned_by_actor_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3),
    "record_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "campaign_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_code_permission_code_relation_key" ON "role_permissions"("role_code", "permission_code", "relation");

-- CreateIndex
CREATE INDEX "account_permission_overrides_actor_id_module_idx" ON "account_permission_overrides"("actor_id", "module");

-- CreateIndex
CREATE INDEX "account_permission_overrides_campaign_id_field_key_idx" ON "account_permission_overrides"("campaign_id", "field_key");

-- CreateIndex
CREATE UNIQUE INDEX "account_permission_overrides_actor_id_permission_code_scope_key" ON "account_permission_overrides"("actor_id", "permission_code", "scope_key");

-- CreateIndex
CREATE INDEX "campaign_participants_campaign_id_ends_at_idx" ON "campaign_participants"("campaign_id", "ends_at");

-- CreateIndex
CREATE INDEX "campaign_participants_actor_id_ends_at_idx" ON "campaign_participants"("actor_id", "ends_at");

-- CreateIndex
CREATE INDEX "campaign_participants_org_id_ends_at_idx" ON "campaign_participants"("org_id", "ends_at");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_requesting_department_id_fkey" FOREIGN KEY ("requesting_department_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_requesting_division_id_fkey" FOREIGN KEY ("requesting_division_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission_definitions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_permission_overrides" ADD CONSTRAINT "account_permission_overrides_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_permission_overrides" ADD CONSTRAINT "account_permission_overrides_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission_definitions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_permission_overrides" ADD CONSTRAINT "account_permission_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_permission_overrides" ADD CONSTRAINT "account_permission_overrides_relation_org_id_fkey" FOREIGN KEY ("relation_org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_permission_overrides" ADD CONSTRAINT "account_permission_overrides_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_assigned_by_actor_id_fkey" FOREIGN KEY ("assigned_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scope keys make nullable identities unambiguous. No legacy business rows are rewritten.
ALTER TABLE "permission_definitions"
  ALTER COLUMN "supported_scopes" SET NOT NULL,
  ADD CONSTRAINT "permission_definition_status" CHECK ("implementation_status" IN ('IMPLEMENTED', 'RESERVED')),
  ADD CONSTRAINT "permission_definition_scopes" CHECK (cardinality("supported_scopes") > 0 AND "supported_scopes" <@ ARRAY['SYSTEM','MODULE','MODULE_ORG','RECORD','FIELD']::text[]);
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permission_effect" CHECK ("effect" IN ('ALLOW','DENY')),
  ADD CONSTRAINT "role_permission_relation" CHECK ("relation" IN ('ALL','OWN','OWN_DRAFT','ASSIGNED','UNIT')),
  ADD CONSTRAINT "role_permission_default_scope" CHECK ("default_scope" IN ('SYSTEM','MODULE','MODULE_ORG','RECORD'));
ALTER TABLE "account_permission_overrides"
  ADD CONSTRAINT "account_override_effect" CHECK ("effect" IN ('ALLOW','DENY')),
  ADD CONSTRAINT "account_override_relation" CHECK ("relation" IN ('ALL','OWN','OWN_DRAFT','ASSIGNED','UNIT')),
  ADD CONSTRAINT "account_override_relation_org" CHECK (("relation" = 'UNIT') = ("relation_org_id" IS NOT NULL)),
  ADD CONSTRAINT "account_override_dates" CHECK ("valid_until" IS NULL OR "valid_from" IS NULL OR "valid_until" > "valid_from"),
  ADD CONSTRAINT "account_override_version" CHECK ("record_version" > 0),
  ADD CONSTRAINT "account_override_scope" CHECK (
    ("scope_type" = 'SYSTEM' AND "module" IS NULL AND "org_id" IS NULL AND "campaign_id" IS NULL AND "field_key" IS NULL) OR
    ("scope_type" = 'MODULE' AND "module" IS NOT NULL AND "org_id" IS NULL AND "campaign_id" IS NULL AND "field_key" IS NULL) OR
    ("scope_type" = 'MODULE_ORG' AND "module" IS NOT NULL AND "org_id" IS NOT NULL AND "campaign_id" IS NULL AND "field_key" IS NULL) OR
    ("scope_type" = 'RECORD' AND "module" = 'CAMPAIGN' AND "org_id" IS NULL AND "campaign_id" IS NOT NULL AND "field_key" IS NULL) OR
    ("scope_type" = 'FIELD' AND "module" = 'CAMPAIGN' AND "org_id" IS NULL AND "campaign_id" IS NOT NULL AND "field_key" IS NOT NULL AND "permission_code" = 'campaign.update')
  ),
  ADD CONSTRAINT "account_override_module" CHECK ("module" IS NULL OR "module" = upper(split_part("permission_code", '.', 1))),
  ADD CONSTRAINT "account_override_canonical_key" CHECK ("scope_key"::jsonb = jsonb_build_array("scope_type", "module", "org_id", "campaign_id", "field_key"));
ALTER TABLE "scoped_role_bindings"
  ADD CONSTRAINT "binding_canonical_key" CHECK ("scope_key"::jsonb = jsonb_build_array("scope_type", "module", "org_id", "campaign_id")),
  ADD CONSTRAINT "admin_requires_system_binding" CHECK ("role_code" <> 'ADMIN' OR "scope_type" = 'SYSTEM');
ALTER TABLE "campaign_participants"
  ADD CONSTRAINT "participant_shape" CHECK (
    ("functional_role" = 'CM' AND "actor_id" IS NOT NULL AND "org_id" IS NOT NULL) OR
    ("functional_role" = 'DIVISION' AND "actor_id" IS NULL AND "org_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "participant_responsibility" CHECK ("responsibility" IN ('LEAD','COOP')),
  ADD CONSTRAINT "participant_dates" CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at"),
  ADD CONSTRAINT "participant_version" CHECK ("record_version" > 0);
CREATE UNIQUE INDEX "participant_current_cm_identity" ON "campaign_participants" ("campaign_id", "actor_id", "org_id") WHERE "functional_role" = 'CM' AND "ends_at" IS NULL;
CREATE UNIQUE INDEX "participant_current_division_identity" ON "campaign_participants" ("campaign_id", "org_id") WHERE "functional_role" = 'DIVISION' AND "ends_at" IS NULL;
CREATE UNIQUE INDEX "participant_one_lead_cm_per_division" ON "campaign_participants" ("campaign_id", "org_id") WHERE "functional_role" = 'CM' AND "responsibility" = 'LEAD' AND "ends_at" IS NULL;
CREATE UNIQUE INDEX "participant_one_lead_division" ON "campaign_participants" ("campaign_id") WHERE "functional_role" = 'DIVISION' AND "responsibility" = 'LEAD' AND "ends_at" IS NULL;
