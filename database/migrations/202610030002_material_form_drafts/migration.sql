CREATE TABLE "material_form_drafts" (
  "id" UUID NOT NULL,
  "owner_actor_id" UUID NOT NULL,
  "material_id" UUID,
  "title" TEXT NOT NULL DEFAULT '',
  "form_data" JSONB NOT NULL,
  "record_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "material_form_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_form_drafts_owner_actor_id_fkey" FOREIGN KEY ("owner_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "material_form_drafts_owner_actor_id_updated_at_idx" ON "material_form_drafts"("owner_actor_id", "updated_at");
