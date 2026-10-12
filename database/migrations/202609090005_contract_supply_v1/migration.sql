-- CreateTable
CREATE TABLE "supply_contracts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "number" TEXT,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "supplyType" TEXT NOT NULL DEFAULT 'PAID',
    "owner_unit_code" TEXT,
    "owner_department" TEXT,
    "manager_actor_id" UUID,
    "manager_email" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "signed_amount" DECIMAL(28,6),
    "signed_vat" DECIMAL(28,6),
    "signed_gross" DECIMAL(28,6),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dossier_url" TEXT,
    "source" JSONB NOT NULL DEFAULT '{}',
    "quality" JSONB NOT NULL DEFAULT '[]',
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "local_revision" INTEGER NOT NULL DEFAULT 0,
    "created_by_actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supply_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_contract_aliases" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "supply_contract_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_slots" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "quantity_unit" TEXT,
    "price_basis" DECIMAL(28,10),
    "unit_price" DECIMAL(28,6),
    "total_qty" DECIMAL(28,10),
    "signed_amount" DECIMAL(28,6),
    "cost_type" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "business_type" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "channel" TEXT,
    "specific_channel" TEXT,
    "market_code" TEXT,
    "description" TEXT,
    "material_requirement" TEXT,
    "preview_url" TEXT,
    "manager_email" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "capacity_mode" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "capacity" INTEGER,
    "source" JSONB NOT NULL DEFAULT '{}',
    "quality" JSONB NOT NULL DEFAULT '[]',
    "record_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supply_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_slot_bookers" (
    "id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "personnel_code" TEXT,

    CONSTRAINT "supply_slot_bookers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_periods" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,

    CONSTRAINT "supply_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_allocation_plans" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE,
    "source" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "supply_allocation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_allocations" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "slot_id" UUID,
    "period_id" UUID NOT NULL,
    "source_key" TEXT,
    "beneficiary_unit_code" TEXT,
    "beneficiary_label" TEXT NOT NULL,
    "scope_kind" TEXT NOT NULL DEFAULT 'ENTITLEMENT',
    "limit_mode" TEXT NOT NULL DEFAULT 'HARD_LIMIT',
    "baseline_qty" DECIMAL(28,10),
    "baseline_amount" DECIMAL(28,6),
    "unit_price" DECIMAL(28,6),
    "input_basis" TEXT NOT NULL DEFAULT 'SOURCE',
    "percent" DECIMAL(18,10),
    "denominator" DECIMAL(28,10),
    "tax_rate" DECIMAL(10,8),
    "vat_estimated" BOOLEAN NOT NULL DEFAULT false,
    "source_month_count" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source_version" TEXT,
    "source" JSONB NOT NULL DEFAULT '{}',
    "quality" JSONB NOT NULL DEFAULT '[]',
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "approved_by_actor_id" UUID,
    "approved_at" TIMESTAMPTZ(3),

    CONSTRAINT "supply_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_adjustment_groups" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MIXED',
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effective_date" DATE,
    "source" JSONB NOT NULL DEFAULT '{}',
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_actor_id" UUID NOT NULL,
    "approved_by_actor_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "reverses_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_adjustment_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_adjustment_lines" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "delta_qty" DECIMAL(28,10),
    "delta_amount" DECIMAL(28,6),
    "expected_allocation_version" INTEGER NOT NULL,
    "source" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "supply_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_financial_lines" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "source_key" TEXT NOT NULL,
    "external_id" TEXT,
    "item_code" TEXT,
    "description" TEXT,
    "unit" TEXT,
    "quantity" DECIMAL(28,10),
    "unit_price" DECIMAL(28,6),
    "amount" DECIMAL(28,6),
    "source" JSONB NOT NULL,

    CONSTRAINT "supply_financial_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_slot_financial_maps" (
    "id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "line_id" UUID,
    "source_key" TEXT NOT NULL,
    "tax_rate" DECIMAL(10,8),
    "period_code" TEXT,
    "status" TEXT NOT NULL,
    "source" JSONB NOT NULL,

    CONSTRAINT "supply_slot_financial_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_imports" (
    "id" UUID NOT NULL,
    "contract_id" UUID,
    "source_id" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "expected_version" INTEGER,
    "read_at" TIMESTAMPTZ(3) NOT NULL,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_commands" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "digest" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_legal_revisions" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_legal_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supply_contracts_code_key" ON "supply_contracts"("code");

-- CreateIndex
CREATE INDEX "supply_contracts_status_start_date_end_date_idx" ON "supply_contracts"("status", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "supply_contract_aliases_provider_source_id_alias_key" ON "supply_contract_aliases"("provider", "source_id", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "supply_slots_code_key" ON "supply_slots"("code");

-- CreateIndex
CREATE INDEX "supply_slots_contract_id_status_idx" ON "supply_slots"("contract_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supply_slot_bookers_slot_id_email_key" ON "supply_slot_bookers"("slot_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "supply_periods_contract_id_code_key" ON "supply_periods"("contract_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "supply_allocation_plans_contract_id_version_key" ON "supply_allocation_plans"("contract_id", "version");

-- CreateIndex
CREATE INDEX "supply_allocations_contract_id_period_id_beneficiary_unit_c_idx" ON "supply_allocations"("contract_id", "period_id", "beneficiary_unit_code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supply_allocations_contract_id_source_key_key" ON "supply_allocations"("contract_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "supply_adjustment_groups_reverses_id_key" ON "supply_adjustment_groups"("reverses_id");

-- CreateIndex
CREATE INDEX "supply_adjustment_groups_contract_id_status_idx" ON "supply_adjustment_groups"("contract_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supply_adjustment_lines_group_id_allocation_id_key" ON "supply_adjustment_lines"("group_id", "allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "supply_financial_lines_contract_id_source_key_key" ON "supply_financial_lines"("contract_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "supply_slot_financial_maps_slot_id_source_key_key" ON "supply_slot_financial_maps"("slot_id", "source_key");

-- CreateIndex
CREATE INDEX "supply_imports_source_id_digest_status_idx" ON "supply_imports"("source_id", "digest", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supply_commands_key_key" ON "supply_commands"("key");

-- CreateIndex
CREATE UNIQUE INDEX "supply_legal_revisions_contract_id_version_key" ON "supply_legal_revisions"("contract_id", "version");

-- AddForeignKey
ALTER TABLE "supply_contracts" ADD CONSTRAINT "supply_contracts_owner_unit_code_fkey" FOREIGN KEY ("owner_unit_code") REFERENCES "organization_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_contracts" ADD CONSTRAINT "supply_contracts_manager_actor_id_fkey" FOREIGN KEY ("manager_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_contract_aliases" ADD CONSTRAINT "supply_contract_aliases_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_slots" ADD CONSTRAINT "supply_slots_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_slots" ADD CONSTRAINT "supply_slots_market_code_fkey" FOREIGN KEY ("market_code") REFERENCES "markets"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_slot_bookers" ADD CONSTRAINT "supply_slot_bookers_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "supply_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_slot_bookers" ADD CONSTRAINT "supply_slot_bookers_personnel_code_fkey" FOREIGN KEY ("personnel_code") REFERENCES "personnel_directory_entries"("employee_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_periods" ADD CONSTRAINT "supply_periods_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_allocation_plans" ADD CONSTRAINT "supply_allocation_plans_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_allocations" ADD CONSTRAINT "supply_allocations_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_allocations" ADD CONSTRAINT "supply_allocations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "supply_allocation_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_allocations" ADD CONSTRAINT "supply_allocations_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "supply_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_allocations" ADD CONSTRAINT "supply_allocations_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "supply_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_allocations" ADD CONSTRAINT "supply_allocations_beneficiary_unit_code_fkey" FOREIGN KEY ("beneficiary_unit_code") REFERENCES "organization_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_adjustment_groups" ADD CONSTRAINT "supply_adjustment_groups_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_adjustment_groups" ADD CONSTRAINT "supply_adjustment_groups_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "supply_adjustment_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_adjustment_lines" ADD CONSTRAINT "supply_adjustment_lines_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "supply_adjustment_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_adjustment_lines" ADD CONSTRAINT "supply_adjustment_lines_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "supply_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_financial_lines" ADD CONSTRAINT "supply_financial_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_slot_financial_maps" ADD CONSTRAINT "supply_slot_financial_maps_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "supply_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_slot_financial_maps" ADD CONSTRAINT "supply_slot_financial_maps_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "supply_financial_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_imports" ADD CONSTRAINT "supply_imports_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_legal_revisions" ADD CONSTRAINT "supply_legal_revisions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supply_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Source supply permissions only. No existing Campaign, Material or Google grants are altered.
INSERT INTO permission_definitions (code,label,module,group_label,description,supported_scopes,implementation_status)
VALUES
('contract.read','Xem hợp đồng, slot và inventory','CONTRACT','Hợp đồng','Đọc trong phạm vi được cấp.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED'),
('contract.create','Tạo hợp đồng','CONTRACT','Hợp đồng','Tạo nguồn cung nháp.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED'),
('contract.update','Sửa hợp đồng và slot','CONTRACT','Hợp đồng','Cần được phân công hoặc ADMIN.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED'),
('contract.allocate','Lập phân bổ và điều chỉnh','CONTRACT','Hợp đồng','Lưu nháp, gửi duyệt và đảo có liên kết.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED'),
('contract.approve','Duyệt phân bổ và điều chỉnh','CONTRACT','Hợp đồng','Duyệt nguyên tử có version và audit.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED'),
('contract.import','Nhập nguồn hợp đồng','CONTRACT','Hợp đồng','Preview trước apply; bảo vệ sửa local.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED'),
('contract.export','Xuất nguồn hợp đồng','CONTRACT','Hợp đồng','Xuất dữ liệu trong phạm vi xem.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (id,role_code,permission_code,effect,relation,default_scope)
SELECT gen_random_uuid(),r.code,p.code,'ALLOW',CASE WHEN p.code='contract.create' THEN 'ALL' ELSE 'ASSIGNED' END,'MODULE'
FROM roles r CROSS JOIN permission_definitions p
WHERE r.code IN ('CONTRACT_MANAGER','COMM_CONTRACT_MANAGER')
AND p.code IN ('contract.read','contract.create','contract.update','contract.allocate','contract.export')
ON CONFLICT (role_code,permission_code,relation) DO NOTHING;

ALTER TABLE supply_contracts ADD CONSTRAINT supply_contract_dates CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date);
ALTER TABLE supply_contracts ADD CONSTRAINT supply_contract_version CHECK (record_version > 0 AND local_revision >= 0);
ALTER TABLE supply_slots ADD CONSTRAINT supply_capacity_rule CHECK (capacity_mode IN ('UNKNOWN','UNRESTRICTED','EXCLUSIVE','SHARED_CAPACITY') AND (capacity_mode <> 'SHARED_CAPACITY' OR capacity >= 1));
ALTER TABLE supply_periods ADD CONSTRAINT supply_period_dates CHECK (start_date <= end_date);
ALTER TABLE supply_allocations ADD CONSTRAINT supply_allocation_scope CHECK (scope_kind IN ('CAP','ENTITLEMENT') AND limit_mode IN ('HARD_LIMIT','WARNING','REFERENCE') AND (scope_kind='CAP' OR slot_id IS NOT NULL));
ALTER TABLE supply_allocations ADD CONSTRAINT supply_allocation_version CHECK (record_version > 0);
