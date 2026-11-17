CREATE TABLE "engagement_settings" (
  "key" TEXT PRIMARY KEY DEFAULT 'engagement', "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_actor_id" UUID REFERENCES "actors"("id") ON DELETE RESTRICT
);
INSERT INTO "engagement_settings" ("key", "enabled") VALUES ('engagement', true) ON CONFLICT DO NOTHING;
CREATE TABLE "mission_progress" (
  "actor_id" UUID NOT NULL REFERENCES "actors"("id") ON DELETE RESTRICT,
  "mission_key" TEXT NOT NULL DEFAULT 'FIRST_CAMPAIGN',
  "run_number" INTEGER NOT NULL DEFAULT 1 CHECK ("run_number" > 0),
  "mode" TEXT NOT NULL CHECK ("mode" IN ('REAL','DEMO')),
  "stage" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("stage" IN ('ACTIVE','DRAFT_SAVED','COMPLETED')),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "campaign_id" UUID REFERENCES "campaigns"("id") ON DELETE SET NULL,
  "campaign_name" TEXT, "completed_at" TIMESTAMPTZ(3), "reward_seen_at" TIMESTAMPTZ(3),
  "completed_count" INTEGER NOT NULL DEFAULT 0 CHECK ("completed_count" >= 0),
  PRIMARY KEY ("actor_id", "mission_key")
);
CREATE TABLE "personal_collectibles" (
  "actor_id" UUID NOT NULL REFERENCES "actors"("id") ON DELETE RESTRICT,
  "item_key" TEXT NOT NULL CHECK (length("item_key") > 0),
  "earned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("actor_id", "item_key")
);
