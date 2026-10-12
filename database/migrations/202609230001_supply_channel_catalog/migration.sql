CREATE TABLE "supply_channel_catalogs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "data" JSONB NOT NULL,
  "digest" TEXT NOT NULL,
  "recordVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedByActorId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- A reference activity has one managed owned source, including while in Trash.
CREATE UNIQUE INDEX "supply_contract_owned_activity_key"
ON "supply_contracts" ((source->>'ownedActivityCode')) WHERE source->>'kind' = 'OWNED_MEDIA';
