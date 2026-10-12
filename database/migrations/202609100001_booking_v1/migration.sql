-- CreateTable
CREATE TABLE "booking_records" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "campaign_id" UUID,
    "campaign_label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(28,6) NOT NULL,
    "price_basis" DECIMAL(28,10) NOT NULL,
    "tax_rate" DECIMAL(10,8) NOT NULL,
    "amount" DECIMAL(28,6) NOT NULL,
    "vat" DECIMAL(28,6) NOT NULL,
    "gross" DECIMAL(28,6) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" TIMESTAMPTZ(3),
    "material_id" UUID,
    "material_url" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "vendor_confirmed_qty" DECIMAL(28,10),
    "source_approved_qty" DECIMAL(28,10),
    "accepted_qty" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "report_state" TEXT NOT NULL DEFAULT 'EMPTY',
    "report_template_id" UUID,
    "report_data" JSONB NOT NULL DEFAULT '{}',
    "source_key" TEXT,
    "source" JSONB NOT NULL DEFAULT '{}',
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_allocation_access" (
    "allocation_id" UUID NOT NULL,
    "owner_department_id" UUID,
    "beneficiary_department_id" UUID,
    "leader_actor_ids" JSONB NOT NULL DEFAULT '[]',
    "operator_actor_ids" JSONB NOT NULL DEFAULT '[]',
    "beneficiary_actor_ids" JSONB NOT NULL DEFAULT '[]',
    "vendor_actor_ids" JSONB NOT NULL DEFAULT '[]',
    "record_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "booking_allocation_access_pkey" PRIMARY KEY ("allocation_id")
);

-- CreateTable
CREATE TABLE "booking_report_templates" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_revisions" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_commands" (
    "key" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "digest" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_commands_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_records_source_key_key" ON "booking_records"("source_key");

-- CreateIndex
CREATE INDEX "booking_records_contract_id_allocation_id_deleted_at_idx" ON "booking_records"("contract_id", "allocation_id", "deleted_at");

-- CreateIndex
CREATE INDEX "booking_records_campaign_id_start_date_idx" ON "booking_records"("campaign_id", "start_date");

-- CreateIndex
CREATE INDEX "booking_records_state_updated_at_idx" ON "booking_records"("state", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_report_templates_contract_id_version_key" ON "booking_report_templates"("contract_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "booking_revisions_booking_id_version_key" ON "booking_revisions"("booking_id", "version");

-- AddForeignKey
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_records_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_records_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "supply_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_records_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "supply_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_records_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_records_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_records_created_by_actor_id_fkey" FOREIGN KEY ("created_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_records_report_template_id_fkey" FOREIGN KEY ("report_template_id") REFERENCES "booking_report_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_allocation_access" ADD CONSTRAINT "booking_allocation_access_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "supply_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_report_templates" ADD CONSTRAINT "booking_report_templates_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_revisions" ADD CONSTRAINT "booking_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_valid_values" CHECK (quantity > 0 AND price_basis > 0 AND unit_price >= 0 AND tax_rate >= 0 AND tax_rate <= 1 AND accepted_qty >= 0 AND end_date >= start_date);

-- RenameIndex
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_valid_states" CHECK (state IN ('ACTIVE','PAUSED') AND report_state IN ('EMPTY','DRAFT','ACCEPTED'));
