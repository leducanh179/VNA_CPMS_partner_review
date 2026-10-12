CREATE TABLE "supply_pivot_views" (
  "id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "contract_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "definition" JSONB NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "record_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "supply_pivot_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supply_pivot_views_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supply_pivot_views_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "supply_pivot_views_actor_id_contract_id_name_key" ON "supply_pivot_views"("actor_id", "contract_id", "name");
CREATE INDEX "supply_pivot_views_contract_id_actor_id_idx" ON "supply_pivot_views"("contract_id", "actor_id");
CREATE UNIQUE INDEX "supply_pivot_views_one_default" ON "supply_pivot_views"("actor_id", "contract_id") WHERE "is_default" = true;
