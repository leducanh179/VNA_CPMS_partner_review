CREATE TABLE "campaign_drive_relink_requests" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "source_folder_id" TEXT NOT NULL,
  "source_folder_link" TEXT NOT NULL,
  "source_folder_name" TEXT NOT NULL,
  "target_folder_id" TEXT NOT NULL,
  "target_folder_link" TEXT NOT NULL,
  "target_folder_name" TEXT NOT NULL,
  "expected_folder_name" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requested_by_actor_id" UUID NOT NULL,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by_actor_id" UUID,
  "decision_reason" TEXT,
  "decided_at" TIMESTAMPTZ(3),
  "applied_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "record_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "campaign_drive_relink_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_drive_relink_requests_status_check" CHECK ("status" IN ('PENDING', 'APPLYING', 'FAILED', 'APPLIED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT "campaign_drive_relink_requests_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "campaign_drive_relink_requests_campaign_id_requested_at_idx" ON "campaign_drive_relink_requests"("campaign_id", "requested_at");
CREATE INDEX "campaign_drive_relink_requests_target_folder_id_status_idx" ON "campaign_drive_relink_requests"("target_folder_id", "status");
CREATE UNIQUE INDEX "campaign_drive_relink_requests_one_open_per_campaign_idx" ON "campaign_drive_relink_requests"("campaign_id") WHERE "status" IN ('PENDING', 'APPLYING', 'FAILED');
