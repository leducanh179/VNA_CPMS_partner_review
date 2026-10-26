CREATE TABLE "AiConversation" (
  "id" UUID PRIMARY KEY,
  "actorId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3)
);
ALTER TABLE "AiLookupRun" ADD COLUMN "conversationId" UUID;
-- Preserve any earlier pilot conversation content rather than silently discarding it.
INSERT INTO "AiConversation" ("id","actorId","title","createdAt","updatedAt")
  SELECT "id","actorId",LEFT(COALESCE(NULLIF("question",''),'Hội thoại trước'),100),"createdAt","updatedAt" FROM "AiLookupRun";
UPDATE "AiLookupRun" SET "conversationId"="id";
ALTER TABLE "AiLookupRun" ADD CONSTRAINT "AiLookupRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AiConversation_actorId_deletedAt_updatedAt_idx" ON "AiConversation"("actorId","deletedAt","updatedAt");
CREATE INDEX "AiLookupRun_conversationId_createdAt_idx" ON "AiLookupRun"("conversationId","createdAt");
