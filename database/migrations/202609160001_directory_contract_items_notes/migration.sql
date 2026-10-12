-- AlterTable
ALTER TABLE "supply_contracts" ADD COLUMN     "responsibility_snapshot" JSONB,
ADD COLUMN     "supplier_id" UUID,
ADD COLUMN     "supplier_snapshot" JSONB;

-- AlterTable
ALTER TABLE "supply_slots" ADD COLUMN     "effective_total_qty" DECIMAL(28,10);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "tax_id" TEXT,
    "profile" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_notes" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "search_text" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'YELLOW',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "personal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_external_identities" (
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_updated_at" TIMESTAMPTZ(3),

    CONSTRAINT "directory_external_identities_pkey" PRIMARY KEY ("provider","external_id")
);

-- CreateTable
CREATE TABLE "directory_sync_runs" (
    "provider" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "directory_sync_runs_pkey" PRIMARY KEY ("provider","batch_id")
);

-- CreateTable
CREATE TABLE "supply_item_terms" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "baseline" JSONB,
    "effective" JSONB NOT NULL,
    "record_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supply_item_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_normalized_name_key" ON "suppliers"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tax_id_key" ON "suppliers"("tax_id");

-- CreateIndex
CREATE INDEX "personal_notes_actor_id_pinned_title_idx" ON "personal_notes"("actor_id", "pinned", "title");

-- CreateIndex
CREATE UNIQUE INDEX "directory_external_identities_provider_employee_code_key" ON "directory_external_identities"("provider", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "supply_item_terms_slot_id_period_id_key" ON "supply_item_terms"("slot_id", "period_id");

-- AddForeignKey
ALTER TABLE "personal_notes" ADD CONSTRAINT "personal_notes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_external_identities" ADD CONSTRAINT "directory_external_identities_employee_code_fkey" FOREIGN KEY ("employee_code") REFERENCES "personnel_directory_entries"("employee_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_item_terms" ADD CONSTRAINT "supply_item_terms_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_item_terms" ADD CONSTRAINT "supply_item_terms_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "supply_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_item_terms" ADD CONSTRAINT "supply_item_terms_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "supply_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_contracts" ADD CONSTRAINT "supply_contracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "personal_notes" ADD CONSTRAINT "personal_notes_color_check" CHECK (color IN ('YELLOW','GREEN','BLUE','RED'));

CREATE FUNCTION cpms_item_baseline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.baseline IS NOT NULL AND NEW.baseline IS DISTINCT FROM OLD.baseline THEN
    RAISE EXCEPTION 'Published item baseline is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supply_item_baseline_immutable BEFORE UPDATE ON supply_item_terms
FOR EACH ROW EXECUTE FUNCTION cpms_item_baseline_guard();
