ALTER TABLE "supply_contracts"
  ADD COLUMN "service_recipient" TEXT,
  ADD COLUMN "market_scope" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
  ADD COLUMN "market_codes" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "supply_contracts"
  ADD CONSTRAINT "supply_contracts_market_scope_check"
  CHECK ("market_scope" IN ('UNSPECIFIED', 'ALL', 'SELECTED'));
