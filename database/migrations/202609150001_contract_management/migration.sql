ALTER TABLE "supply_contracts"
  ADD COLUMN "vendor_code" TEXT,
  ADD COLUMN "code_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "leader_actor_id" UUID,
  ADD COLUMN "operator_actor_id" UUID,
  ADD COLUMN "vendor_actor_id" UUID,
  ADD COLUMN "current_revision_id" UUID,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

CREATE TABLE "supply_contract_revisions" (
  "id" UUID NOT NULL PRIMARY KEY,
  "contract_id" UUID NOT NULL REFERENCES "supply_contracts"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "provenance" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "reason" TEXT NOT NULL,
  "evidence" TEXT,
  "created_by_actor_id" UUID NOT NULL,
  "approved_by_actor_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supply_contract_revisions_contract_id_version_key" UNIQUE ("contract_id", "version")
);
ALTER TABLE "supply_contracts" ADD CONSTRAINT "supply_contracts_current_revision_id_fkey"
  FOREIGN KEY ("current_revision_id") REFERENCES "supply_contract_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_records" ADD COLUMN "contract_revision_id" UUID,
  ADD COLUMN "contract_snapshot" JSONB;
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_records_contract_revision_id_fkey"
  FOREIGN KEY ("contract_revision_id") REFERENCES "supply_contract_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "supply_contract_change_requests" (
  "id" UUID NOT NULL PRIMARY KEY,
  "contract_id" UUID NOT NULL REFERENCES "supply_contracts"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "fields" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" TEXT,
  "base_version" INTEGER NOT NULL,
  "base_revision_id" UUID,
  "record_version" INTEGER NOT NULL DEFAULT 1,
  "requester_actor_id" UUID NOT NULL,
  "leader_actor_id" UUID,
  "policy_version" INTEGER NOT NULL,
  "approval_required" BOOLEAN NOT NULL,
  "submitted_at" TIMESTAMPTZ(3),
  "decided_at" TIMESTAMPTZ(3),
  "decided_by_actor_id" UUID,
  "decision_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "supply_contract_change_requests_contract_id_state_idx" ON "supply_contract_change_requests"("contract_id", "state");
CREATE INDEX "supply_contract_change_requests_leader_actor_id_state_idx" ON "supply_contract_change_requests"("leader_actor_id", "state");
CREATE UNIQUE INDEX "supply_contract_one_pending_request" ON "supply_contract_change_requests"("contract_id") WHERE "state" = 'PENDING';
CREATE TABLE "supply_contract_policies" (
  "version" INTEGER NOT NULL PRIMARY KEY,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT NOT NULL,
  "actor_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION cpms_contract_code_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.code_locked AND (NEW.code IS DISTINCT FROM OLD.code OR NOT NEW.code_locked) THEN
    RAISE EXCEPTION 'Contract code is immutable after first save';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cpms_contract_code_immutable BEFORE UPDATE ON "supply_contracts"
  FOR EACH ROW EXECUTE FUNCTION cpms_contract_code_immutable();
ALTER TABLE "supply_contracts" ADD CONSTRAINT "supply_contract_code_format"
  CHECK (NOT "code_locked" OR ("code" ~ '^CON-[A-Z0-9]{2,20}-[1-9][0-9]{3}(0[1-9]|1[0-2])-[A-Z0-9]{6}$'
    AND length(regexp_replace(right("code", 6), '[^A-Z]', '', 'g')) >= 2));
CREATE FUNCTION cpms_contract_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published contract revisions are immutable';
END $$;
CREATE TRIGGER cpms_contract_revision_immutable BEFORE UPDATE ON "supply_contract_revisions"
  FOR EACH ROW EXECUTE FUNCTION cpms_contract_revision_immutable();
