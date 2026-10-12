CREATE TABLE "booking_approval_delegations" (
  "id" UUID NOT NULL, "contract_id" UUID NOT NULL, "version" INTEGER NOT NULL,
  "leader_actor_id" UUID NOT NULL, "delegate_actor_id" UUID NOT NULL,
  "leader_name" TEXT NOT NULL, "delegate_name" TEXT NOT NULL, "recipient_role" TEXT NOT NULL, "scope" TEXT NOT NULL, "actions" JSONB NOT NULL,
  "starts_on" VARCHAR(10) NOT NULL, "ends_on" VARCHAR(10), "revoked" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT NOT NULL, "actor_id" UUID NOT NULL, "actor_name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_approval_delegations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_delegation_dates" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on"),
  CONSTRAINT "booking_delegation_version" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "booking_delegation_contract_recipient_version_key" ON "booking_approval_delegations"("contract_id", "delegate_actor_id", "version");
