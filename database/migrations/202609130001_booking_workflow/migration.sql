ALTER TABLE "booking_records" ADD COLUMN "workflow" JSONB,
 ADD COLUMN "execution" TEXT NOT NULL DEFAULT 'NOT_STARTED',
 ADD COLUMN "report_periods" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_execution_valid" CHECK ("execution" IN ('NOT_STARTED','RUNNING','PAUSED','FINISHED','CANCELLED'));
ALTER TABLE "booking_records" DROP CONSTRAINT "booking_valid_states";
ALTER TABLE "booking_records" ADD CONSTRAINT "booking_valid_states" CHECK (state IN ('ACTIVE','PAUSED') AND report_state IN ('EMPTY','DRAFT','PENDING','RETURNED','ACCEPTED'));
CREATE TABLE "booking_workflow_policies" (
 "version" INTEGER PRIMARY KEY,
 "required" BOOLEAN NOT NULL,
 "actor_id" UUID NOT NULL REFERENCES "actors"("id") ON DELETE RESTRICT,
 "reason" TEXT NOT NULL,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
