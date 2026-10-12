CREATE TABLE "material_comments" (
  "id" UUID NOT NULL,
  "material_id" TEXT NOT NULL,
  "author_actor_id" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "parent_id" UUID,
  "record_version" INTEGER NOT NULL DEFAULT 1,
  "edited_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "material_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "material_comments_material_id_created_at_idx" ON "material_comments"("material_id", "created_at");
CREATE INDEX "material_comments_parent_id_idx" ON "material_comments"("parent_id");
ALTER TABLE "material_comments" ADD CONSTRAINT "material_comments_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_records"("material_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_comments" ADD CONSTRAINT "material_comments_author_actor_id_fkey" FOREIGN KEY ("author_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_comments" ADD CONSTRAINT "material_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "material_comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
