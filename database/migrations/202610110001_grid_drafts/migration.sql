CREATE TABLE "grid_drafts" (
  "id" UUID NOT NULL,
  "owner_actor_id" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "record_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "grid_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grid_drafts_owner_actor_id_fkey" FOREIGN KEY ("owner_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "grid_drafts_owner_actor_id_scope_key" ON "grid_drafts"("owner_actor_id", "scope");
