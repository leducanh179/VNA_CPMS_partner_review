ALTER TABLE "AiLookupRun" ADD COLUMN "artifacts" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "AiWorkspaceState" (
  "id" TEXT PRIMARY KEY, "version" INTEGER NOT NULL DEFAULT 0,
  "draftVersion" INTEGER NOT NULL DEFAULT 0, "draft" JSONB NOT NULL DEFAULT '{}',
  "published" JSONB NOT NULL DEFAULT '{}', "libraryVersion" INTEGER NOT NULL DEFAULT 0,
  "librarySpreadsheetId" TEXT NOT NULL DEFAULT '', "librarySyncedAt" TIMESTAMP(3)
);
CREATE TABLE "AiPolicyVersion" (
  "version" INTEGER PRIMARY KEY, "policy" JSONB NOT NULL, "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AiLibraryEntry" (
  "id" TEXT PRIMARY KEY, "itemId" TEXT NOT NULL, "rootId" TEXT NOT NULL,
  "sourceRow" INTEGER NOT NULL, "data" JSONB NOT NULL
);
CREATE INDEX "AiLibraryEntry_itemId_idx" ON "AiLibraryEntry"("itemId");
CREATE INDEX "AiLibraryEntry_rootId_idx" ON "AiLibraryEntry"("rootId");
CREATE TABLE "AiAgentProposal" (
  "id" UUID PRIMARY KEY, "runId" UUID NOT NULL REFERENCES "AiLookupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "actorId" UUID NOT NULL, "campaignId" UUID NOT NULL, "expectedVersion" INTEGER NOT NULL,
  "changes" JSONB NOT NULL, "reason" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'PREPARED',
  "result" JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiAgentProposal_runId_actorId_idx" ON "AiAgentProposal"("runId", "actorId");
