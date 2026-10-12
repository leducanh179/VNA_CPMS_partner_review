-- Campaign Spreadsheet Exchange IV-B is additive. Existing Campaign,
-- MaterialRecord, AuditEvent and legacy field_values data remain untouched.

CREATE TABLE "google_oauth_connections" (
  "actor_id" UUID NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "account_email" TEXT NOT NULL,
  "account_name" TEXT,
  "encrypted_tokens" TEXT NOT NULL,
  "granted_scopes" TEXT[] NOT NULL,
  "access_token_expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "google_oauth_connections_pkey" PRIMARY KEY ("actor_id")
);

CREATE TABLE "google_oauth_states" (
  "state_hash" TEXT NOT NULL,
  "actor_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_oauth_states_pkey" PRIMARY KEY ("state_hash")
);

CREATE TABLE "spreadsheet_exchange_operations" (
  "id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "spreadsheet_id" TEXT NOT NULL,
  "source_sheet_id" TEXT,
  "target_sheet_id" TEXT,
  "target_sheet_name" TEXT,
  "result_url" TEXT,
  "status" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "spreadsheet_exchange_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_oauth_connections_provider_account_id_key" ON "google_oauth_connections"("provider_account_id");
CREATE INDEX "google_oauth_states_actor_id_expires_at_idx" ON "google_oauth_states"("actor_id", "expires_at");
CREATE UNIQUE INDEX "spreadsheet_exchange_operations_actor_id_idempotency_key_key" ON "spreadsheet_exchange_operations"("actor_id", "idempotency_key");
CREATE INDEX "spreadsheet_exchange_operations_spreadsheet_id_created_at_idx" ON "spreadsheet_exchange_operations"("spreadsheet_id", "created_at");

ALTER TABLE "google_oauth_connections" ADD CONSTRAINT "google_oauth_connections_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_oauth_states" ADD CONSTRAINT "google_oauth_states_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spreadsheet_exchange_operations" ADD CONSTRAINT "spreadsheet_exchange_operations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
