CREATE TABLE "campaign_drive_workspaces" (
    "campaign_id" UUID NOT NULL,
    "shared_drive_id" TEXT NOT NULL,
    "parent_folder_id" TEXT NOT NULL,
    "campaign_folder_id" TEXT,
    "campaign_folder_link" TEXT,
    "last_known_folder_name" TEXT,
    "base_documents_folder_id" TEXT,
    "media_assets_folder_id" TEXT,
    "other_documents_folder_id" TEXT,
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "access_mode" TEXT NOT NULL DEFAULT 'CPMS_VISIBILITY_ONLY',
    "sharing_mode" TEXT NOT NULL DEFAULT 'LINK_WRITER',
    "sync_status" TEXT NOT NULL DEFAULT 'NOT_CREATED',
    "lifecycle_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_checked_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "google_permission_id" TEXT,
    "desired_role" TEXT,
    "permission_sync_status" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_drive_workspaces_pkey" PRIMARY KEY ("campaign_id")
);

CREATE UNIQUE INDEX "campaign_drive_workspaces_campaign_folder_id_key"
ON "campaign_drive_workspaces"("campaign_folder_id");

CREATE INDEX "campaign_drive_workspaces_sync_status_updated_at_idx"
ON "campaign_drive_workspaces"("sync_status", "updated_at");

CREATE INDEX "campaign_drive_workspaces_lifecycle_status_updated_at_idx"
ON "campaign_drive_workspaces"("lifecycle_status", "updated_at");

ALTER TABLE "campaign_drive_workspaces"
ADD CONSTRAINT "campaign_drive_workspaces_campaign_id_fkey"
FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
