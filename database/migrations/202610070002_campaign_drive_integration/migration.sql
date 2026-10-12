ALTER TABLE "campaign_drive_workspaces"
  ADD COLUMN "permission_policy_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "campaign_drive_workspaces"
  ALTER COLUMN "sharing_mode" SET DEFAULT 'PARENT_INHERITED';

CREATE TABLE "google_drive_integration_connections" (
  "key" TEXT NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "account_email" TEXT NOT NULL,
  "account_name" TEXT,
  "encrypted_tokens" TEXT NOT NULL,
  "granted_scopes" TEXT[] NOT NULL,
  "access_token_expires_at" TIMESTAMPTZ(3),
  "connected_by_actor_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "google_drive_integration_connections_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "google_drive_integration_connections_connected_by_actor_id_fkey" FOREIGN KEY ("connected_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
