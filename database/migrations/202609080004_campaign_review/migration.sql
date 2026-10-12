-- AlterTable
ALTER TABLE "campaign_workflows" ADD COLUMN     "operational_state" TEXT NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "campaign_change_requests" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "subject_revision" INTEGER NOT NULL,
    "campaign_record_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "before_snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by_actor_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_actor_id" UUID,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaign_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_plans" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "subject_revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "tasks" JSONB NOT NULL,
    "created_by_actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_change_requests_workflow_id_state_idx" ON "campaign_change_requests"("workflow_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_change_requests_requested_by_actor_id_idempotency__key" ON "campaign_change_requests"("requested_by_actor_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_plans_workflow_id_number_key" ON "campaign_plans"("workflow_id", "number");

-- AddForeignKey
ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "campaign_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_requested_by_actor_id_fkey" FOREIGN KEY ("requested_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_decided_by_actor_id_fkey" FOREIGN KEY ("decided_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plans" ADD CONSTRAINT "campaign_plans_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "campaign_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plans" ADD CONSTRAINT "campaign_plans_created_by_actor_id_fkey" FOREIGN KEY ("created_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE campaign_workflows ADD CONSTRAINT workflow_operational_state_valid CHECK (operational_state IN ('ACTIVE','PAUSED','CANCELLED'));
ALTER TABLE campaign_change_requests ADD CONSTRAINT campaign_change_valid CHECK (
  kind IN ('EDIT','PAUSE','CANCEL','PLAN') AND state IN ('PENDING','APPROVED','REJECTED','SUPERSEDED') AND
  subject_revision > 0 AND campaign_record_version > 0 AND record_version > 0 AND
  length(btrim(reason)) > 0 AND payload_hash ~ '^[0-9a-f]{64}$' AND
  ((state = 'PENDING' AND decided_at IS NULL AND decided_by_actor_id IS NULL) OR
   (state <> 'PENDING' AND decided_at IS NOT NULL AND decided_by_actor_id IS NOT NULL)));
CREATE UNIQUE INDEX campaign_pending_change ON campaign_change_requests(workflow_id,kind) WHERE state = 'PENDING';
ALTER TABLE campaign_plans ADD CONSTRAINT campaign_plan_valid CHECK (number > 0 AND subject_revision > 0 AND length(btrim(title)) > 0 AND length(btrim(objective)) > 0 AND jsonb_typeof(tasks) = 'array' AND jsonb_array_length(tasks) BETWEEN 1 AND 50);
CREATE TRIGGER immutable_campaign_plan BEFORE UPDATE OR DELETE ON campaign_plans FOR EACH ROW EXECUTE FUNCTION cpms_workflow_history_immutable();
CREATE FUNCTION cpms_campaign_change_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'PENDING' THEN RAISE EXCEPTION 'Change request history is append-only' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(OLD) - ARRAY['state','record_version','decided_by_actor_id','decision_reason','decided_at']) IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['state','record_version','decided_by_actor_id','decision_reason','decided_at']) OR NEW.state = 'PENDING' OR NEW.record_version <> OLD.record_version + 1 THEN
    RAISE EXCEPTION 'Only a final decision may update a pending request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_campaign_change BEFORE UPDATE OR DELETE ON campaign_change_requests FOR EACH ROW EXECUTE FUNCTION cpms_campaign_change_immutable();
