-- Additive only. NULL action maps retain each legacy policy's behavior.
ALTER TABLE "booking_workflow_policies" ADD COLUMN "actions" JSONB;
ALTER TABLE "booking_records" ADD COLUMN "lifecycle_request" JSONB;
