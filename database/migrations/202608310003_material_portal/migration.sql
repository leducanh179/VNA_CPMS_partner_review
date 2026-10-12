CREATE TABLE "material_records" (
    "id" UUID NOT NULL,
    "material_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "material_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "material_portal_references" (
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "material_portal_references_pkey" PRIMARY KEY ("type", "key")
);

CREATE UNIQUE INDEX "material_records_material_id_key" ON "material_records"("material_id");
CREATE INDEX "material_records_is_deleted_updated_at_idx" ON "material_records"("is_deleted", "updated_at");
CREATE INDEX "material_portal_references_type_idx" ON "material_portal_references"("type");
