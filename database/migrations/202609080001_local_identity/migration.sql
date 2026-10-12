-- AlterTable
ALTER TABLE "actors" ADD COLUMN     "account_kind" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "authz_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "login_email" TEXT,
ADD COLUMN     "personnel_employee_code" TEXT;

-- AlterTable
ALTER TABLE "personnel_directory_entries" ADD COLUMN     "display_group" TEXT,
ADD COLUMN     "record_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "source_reference" TEXT;

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "context_mode" TEXT,
ADD COLUMN     "original_actor_id" UUID;

-- CreateTable
CREATE TABLE "employment_org_units" (
    "id" UUID NOT NULL,
    "identity_key" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parent_id" UUID,
    "source_provider" TEXT NOT NULL,
    "catalog_organization_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_org_units_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "employment_memberships" (
    "actor_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "division_id" UUID,
    "display_group" TEXT,
    "record_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employment_memberships_pkey" PRIMARY KEY ("actor_id")
);

-- CreateTable
CREATE TABLE "local_credentials" (
    "actor_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "local_credentials_pkey" PRIMARY KEY ("actor_id")
);

-- CreateTable
CREATE TABLE "local_sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_hash" TEXT NOT NULL,
    "original_actor_id" UUID NOT NULL,
    "effective_actor_id" UUID NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'DIRECT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "local_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_login_buckets" (
    "key_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "local_login_buckets_pkey" PRIMARY KEY ("key_hash")
);

-- CreateTable
CREATE TABLE "pending_directory_contacts" (
    "email" TEXT NOT NULL,
    "source_sheet" TEXT NOT NULL,
    "source_row" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_directory_contacts_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "identity_import_state" (
    "key" TEXT NOT NULL,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "bootstrapped_at" TIMESTAMPTZ(3),
    "source_hash" TEXT,

    CONSTRAINT "identity_import_state_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "scoped_role_bindings" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "role_code" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "module" TEXT,
    "org_id" UUID,
    "campaign_id" UUID,
    "relation" TEXT NOT NULL DEFAULT 'PRESET',
    "expires_at" TIMESTAMPTZ(3),
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoped_role_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employment_org_units_identity_key_key" ON "employment_org_units"("identity_key");

-- CreateIndex
CREATE INDEX "employment_org_units_parent_id_kind_idx" ON "employment_org_units"("parent_id", "kind");

-- CreateIndex
CREATE INDEX "employment_memberships_department_id_division_id_idx" ON "employment_memberships"("department_id", "division_id");

-- CreateIndex
CREATE UNIQUE INDEX "local_sessions_token_hash_key" ON "local_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "local_sessions_original_actor_id_revoked_at_idx" ON "local_sessions"("original_actor_id", "revoked_at");

-- CreateIndex
CREATE INDEX "local_sessions_effective_actor_id_revoked_at_idx" ON "local_sessions"("effective_actor_id", "revoked_at");

-- CreateIndex
CREATE INDEX "local_sessions_expires_at_idx" ON "local_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "scoped_role_bindings_actor_id_module_idx" ON "scoped_role_bindings"("actor_id", "module");

-- CreateIndex
CREATE INDEX "scoped_role_bindings_campaign_id_idx" ON "scoped_role_bindings"("campaign_id");

-- CreateIndex
CREATE INDEX "scoped_role_bindings_org_id_idx" ON "scoped_role_bindings"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "scoped_role_bindings_actor_id_role_code_scope_key_key" ON "scoped_role_bindings"("actor_id", "role_code", "scope_key");

-- CreateIndex
CREATE UNIQUE INDEX "actors_personnel_employee_code_key" ON "actors"("personnel_employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "actors_login_email_key" ON "actors"("login_email");

-- AddForeignKey
ALTER TABLE "actors" ADD CONSTRAINT "actors_personnel_employee_code_fkey" FOREIGN KEY ("personnel_employee_code") REFERENCES "personnel_directory_entries"("employee_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_original_actor_id_fkey" FOREIGN KEY ("original_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_org_units" ADD CONSTRAINT "employment_org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_org_units" ADD CONSTRAINT "employment_org_units_catalog_organization_code_fkey" FOREIGN KEY ("catalog_organization_code") REFERENCES "organization_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_memberships" ADD CONSTRAINT "employment_memberships_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_memberships" ADD CONSTRAINT "employment_memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_memberships" ADD CONSTRAINT "employment_memberships_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_sessions" ADD CONSTRAINT "local_sessions_original_actor_id_fkey" FOREIGN KEY ("original_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_sessions" ADD CONSTRAINT "local_sessions_effective_actor_id_fkey" FOREIGN KEY ("effective_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoped_role_bindings" ADD CONSTRAINT "scoped_role_bindings_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoped_role_bindings" ADD CONSTRAINT "scoped_role_bindings_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoped_role_bindings" ADD CONSTRAINT "scoped_role_bindings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoped_role_bindings" ADD CONSTRAINT "scoped_role_bindings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Existing legacy rows satisfy these checks without identity/authorship backfill.
ALTER TABLE "actors" ADD CONSTRAINT "actors_account_kind_check" CHECK (
  "account_kind" IN ('LEGACY', 'PERSONNEL') AND "authz_version" > 0 AND
  ("account_kind" <> 'PERSONNEL' OR ("personnel_employee_code" IS NOT NULL AND "login_email" IS NOT NULL)) AND
  ("login_email" IS NULL OR "login_email" = lower(btrim("login_email")))
);
ALTER TABLE "employment_org_units" ADD CONSTRAINT "employment_tree_shape_check" CHECK (
  ("kind" = 'DEPARTMENT' AND "parent_id" IS NULL) OR
  ("kind" = 'DIVISION' AND "parent_id" IS NOT NULL AND "parent_id" <> "id")
);
ALTER TABLE "local_sessions" ADD CONSTRAINT "local_session_shape_check" CHECK (
  (("mode" = 'DIRECT' AND "original_actor_id" = "effective_actor_id") OR
   ("mode" = 'DEMO_IMPERSONATION' AND "original_actor_id" <> "effective_actor_id")) AND
  "expires_at" > "created_at" AND "last_seen_at" >= "created_at" AND "credential_version" > 0 AND
  "token_hash" ~ '^[a-f0-9]{64}$' AND "csrf_hash" ~ '^[a-f0-9]{64}$'
);
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credential_version_check" CHECK ("credential_version" > 0);
ALTER TABLE "local_login_buckets" ADD CONSTRAINT "local_login_attempts_check" CHECK ("attempts" >= 0 AND "key_hash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "pending_directory_contacts" ADD CONSTRAINT "pending_contact_shape_check" CHECK ("email" = lower(btrim("email")) AND "source_row" > 0);

ALTER TABLE "scoped_role_bindings" ADD CONSTRAINT "scoped_role_binding_shape_check" CHECK (
  "record_version" > 0 AND "relation" IN ('PRESET', 'ALL', 'OWN', 'OWN_DRAFT', 'ASSIGNED', 'UNIT') AND
  (("scope_type" = 'SYSTEM' AND "module" IS NULL AND "org_id" IS NULL AND "campaign_id" IS NULL) OR
   ("scope_type" = 'MODULE' AND "module" IS NOT NULL AND "org_id" IS NULL AND "campaign_id" IS NULL) OR
   ("scope_type" = 'MODULE_ORG' AND "module" IS NOT NULL AND "org_id" IS NOT NULL AND "campaign_id" IS NULL) OR
   ("scope_type" = 'RECORD' AND "module" = 'CAMPAIGN' AND "org_id" IS NULL AND "campaign_id" IS NOT NULL))
);
