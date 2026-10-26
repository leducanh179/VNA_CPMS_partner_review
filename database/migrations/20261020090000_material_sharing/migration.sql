-- Additive only: existing records are NOT consent to anonymous publication.
ALTER TABLE "material_records"
  ADD COLUMN "sharing_mode" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "owner_actor_id" UUID,
  ADD COLUMN "sharing_campaign_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "sharing_grants" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "material_records" ADD CONSTRAINT "material_sharing_mode_check"
  CHECK ("sharing_mode" IN ('LEGACY', 'SHARED', 'CAMPAIGN', 'RESTRICTED'));
CREATE INDEX "material_records_sharing_mode_is_deleted_material_id_idx"
  ON "material_records"("sharing_mode", "is_deleted", "material_id");
