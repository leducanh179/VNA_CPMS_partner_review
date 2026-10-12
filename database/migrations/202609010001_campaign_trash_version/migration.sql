ALTER TABLE "campaigns"
ADD COLUMN "record_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN "deleted_by_actor_id" UUID;

ALTER TABLE "campaigns"
ADD CONSTRAINT "campaigns_deleted_by_actor_id_fkey"
FOREIGN KEY ("deleted_by_actor_id") REFERENCES "actors"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "campaigns_deleted_at_updated_at_idx"
ON "campaigns"("deleted_at", "updated_at");
