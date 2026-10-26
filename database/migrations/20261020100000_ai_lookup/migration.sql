CREATE TABLE "AiLookupRun" (
  "id" UUID PRIMARY KEY,
  "actorId" UUID NOT NULL,
  "period" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL DEFAULT '',
  "sources" JSONB NOT NULL DEFAULT '[]',
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "usage" JSONB NOT NULL DEFAULT '{}',
  "reservedVnd" INTEGER NOT NULL DEFAULT 0 CHECK ("reservedVnd" >= 0),
  "chargedVnd" INTEGER NOT NULL DEFAULT 0 CHECK ("chargedVnd" >= 0),
  "priceVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AiLookupRun_period_idx" ON "AiLookupRun"("period");
CREATE INDEX "AiLookupRun_actorId_createdAt_idx" ON "AiLookupRun"("actorId", "createdAt");
CREATE INDEX "AiLookupRun_state_createdAt_idx" ON "AiLookupRun"("state", "createdAt");
