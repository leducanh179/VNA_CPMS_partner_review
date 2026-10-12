CREATE TABLE "campaign_form_drafts" (
  "id" UUID NOT NULL,
  "owner_actor_id" UUID NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "level_code" TEXT,
  "form_data" JSONB NOT NULL,
  "record_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "campaign_form_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_form_drafts_owner_actor_id_fkey" FOREIGN KEY ("owner_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "campaign_form_drafts_owner_actor_id_updated_at_idx" ON "campaign_form_drafts"("owner_actor_id", "updated_at");
