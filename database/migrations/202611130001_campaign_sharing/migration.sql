CREATE TABLE "campaign_sharing" (
  "campaign_id" UUID PRIMARY KEY REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('RESTRICTED', 'ACCOUNTS', 'PUBLIC')),
  "restricted_tabs" TEXT[] NOT NULL,
  "account_tabs" TEXT[] NOT NULL,
  "public_tabs" TEXT[] NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0)
);
