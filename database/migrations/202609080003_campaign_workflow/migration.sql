-- AlterTable
ALTER TABLE "campaign_participants" ADD COLUMN     "workflow_assignment_id" UUID;

-- CreateTable
CREATE TABLE "workflow_policy_state" (
    "key" TEXT NOT NULL,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "comm_department_id" UUID,
    "demo_initialized_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_policy_state_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "approval_policy_versions" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "scope_key" TEXT NOT NULL,
    "campaign_id" UUID,
    "preset" TEXT,
    "enforcement" TEXT,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "approval_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_workflows" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "current_revision_id" UUID,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_workflow_revisions" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "subject_revision" INTEGER NOT NULL,
    "subject_snapshot" JSONB NOT NULL,
    "policy_version_id" UUID NOT NULL,
    "policy_source" TEXT NOT NULL,
    "route" TEXT,
    "state" TEXT NOT NULL,
    "scope_revision" INTEGER NOT NULL DEFAULT 1,
    "receiving_department_id" UUID,
    "receiving_division_id" UUID,
    "submitted_by_actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaign_workflow_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_workflow_steps" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "assignee_actor_id" UUID,
    "pool" TEXT NOT NULL DEFAULT 'ANY_ONE',
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "step_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaign_workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_workflow_commands" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "original_actor_id" UUID NOT NULL,
    "context_mode" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_workflow_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_workflow_decisions" (
    "id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "subject_revision" INTEGER NOT NULL,
    "policy_version_id" UUID NOT NULL,
    "step_version" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "original_actor_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_workflow_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_workflow_assignments" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "functional_role" TEXT NOT NULL,
    "responsibility" TEXT NOT NULL,
    "assigned_by_actor_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "decision_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3),
    "record_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "campaign_workflow_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_cooperation_requests" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "source_org_id" UUID NOT NULL,
    "target_org_id" UUID NOT NULL,
    "target_actor_id" UUID,
    "requested_by_actor_id" UUID NOT NULL,
    "responded_by_actor_id" UUID,
    "command_id" UUID NOT NULL,
    "response_command_id" UUID,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "response_reason" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaign_cooperation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_policy_versions_version_key" ON "approval_policy_versions"("version");

-- CreateIndex
CREATE INDEX "approval_policy_versions_scope_key_effective_from_version_idx" ON "approval_policy_versions"("scope_key", "effective_from", "version");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workflows_campaign_id_key" ON "campaign_workflows"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workflows_current_revision_id_key" ON "campaign_workflows"("current_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workflows_current_revision_id_id_key" ON "campaign_workflows"("current_revision_id", "id");

-- CreateIndex
CREATE INDEX "campaign_workflow_revisions_state_idx" ON "campaign_workflow_revisions"("state");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workflow_revisions_workflow_id_number_key" ON "campaign_workflow_revisions"("workflow_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workflow_revisions_id_workflow_id_key" ON "campaign_workflow_revisions"("id", "workflow_id");

-- CreateIndex
CREATE INDEX "campaign_workflow_steps_state_org_id_assignee_actor_id_idx" ON "campaign_workflow_steps"("state", "org_id", "assignee_actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workflow_steps_revision_id_kind_org_id_key" ON "campaign_workflow_steps"("revision_id", "kind", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workflow_commands_actor_id_idempotency_key_key" ON "campaign_workflow_commands"("actor_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workflow_decisions_step_id_key" ON "campaign_workflow_decisions"("step_id");

-- CreateIndex
CREATE INDEX "campaign_workflow_assignments_workflow_id_ends_at_idx" ON "campaign_workflow_assignments"("workflow_id", "ends_at");

-- CreateIndex
CREATE INDEX "campaign_workflow_assignments_actor_id_ends_at_idx" ON "campaign_workflow_assignments"("actor_id", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_cooperation_requests_command_id_key" ON "campaign_cooperation_requests"("command_id");

-- CreateIndex
CREATE INDEX "campaign_cooperation_requests_response_command_id_idx" ON "campaign_cooperation_requests"("response_command_id");

-- CreateIndex
CREATE INDEX "campaign_cooperation_requests_target_org_id_state_idx" ON "campaign_cooperation_requests"("target_org_id", "state");

-- CreateIndex
CREATE INDEX "campaign_cooperation_requests_workflow_id_state_idx" ON "campaign_cooperation_requests"("workflow_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_participants_workflow_assignment_id_key" ON "campaign_participants"("workflow_assignment_id");

-- AddForeignKey
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_workflow_assignment_id_fkey" FOREIGN KEY ("workflow_assignment_id") REFERENCES "campaign_workflow_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_policy_state" ADD CONSTRAINT "workflow_policy_state_comm_department_id_fkey" FOREIGN KEY ("comm_department_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policy_versions" ADD CONSTRAINT "approval_policy_versions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policy_versions" ADD CONSTRAINT "approval_policy_versions_created_by_actor_id_fkey" FOREIGN KEY ("created_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflows" ADD CONSTRAINT "campaign_workflows_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflows" ADD CONSTRAINT "campaign_workflows_current_revision_id_id_fkey" FOREIGN KEY ("current_revision_id", "id") REFERENCES "campaign_workflow_revisions"("id", "workflow_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_revisions" ADD CONSTRAINT "campaign_workflow_revisions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "campaign_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_revisions" ADD CONSTRAINT "campaign_workflow_revisions_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "approval_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_revisions" ADD CONSTRAINT "campaign_workflow_revisions_receiving_department_id_fkey" FOREIGN KEY ("receiving_department_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_revisions" ADD CONSTRAINT "campaign_workflow_revisions_receiving_division_id_fkey" FOREIGN KEY ("receiving_division_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_revisions" ADD CONSTRAINT "campaign_workflow_revisions_submitted_by_actor_id_fkey" FOREIGN KEY ("submitted_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_steps" ADD CONSTRAINT "campaign_workflow_steps_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "campaign_workflow_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_steps" ADD CONSTRAINT "campaign_workflow_steps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_steps" ADD CONSTRAINT "campaign_workflow_steps_assignee_actor_id_fkey" FOREIGN KEY ("assignee_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_steps" ADD CONSTRAINT "campaign_workflow_steps_created_by_actor_id_fkey" FOREIGN KEY ("created_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_commands" ADD CONSTRAINT "campaign_workflow_commands_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_commands" ADD CONSTRAINT "campaign_workflow_commands_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_commands" ADD CONSTRAINT "campaign_workflow_commands_original_actor_id_fkey" FOREIGN KEY ("original_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_decisions" ADD CONSTRAINT "campaign_workflow_decisions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "campaign_workflow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_decisions" ADD CONSTRAINT "campaign_workflow_decisions_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "campaign_workflow_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_decisions" ADD CONSTRAINT "campaign_workflow_decisions_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "approval_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_decisions" ADD CONSTRAINT "campaign_workflow_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_decisions" ADD CONSTRAINT "campaign_workflow_decisions_original_actor_id_fkey" FOREIGN KEY ("original_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_decisions" ADD CONSTRAINT "campaign_workflow_decisions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_assignments" ADD CONSTRAINT "campaign_workflow_assignments_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "campaign_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_assignments" ADD CONSTRAINT "campaign_workflow_assignments_revision_id_workflow_id_fkey" FOREIGN KEY ("revision_id", "workflow_id") REFERENCES "campaign_workflow_revisions"("id", "workflow_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_assignments" ADD CONSTRAINT "campaign_workflow_assignments_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_assignments" ADD CONSTRAINT "campaign_workflow_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_assignments" ADD CONSTRAINT "campaign_workflow_assignments_assigned_by_actor_id_fkey" FOREIGN KEY ("assigned_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_assignments" ADD CONSTRAINT "campaign_workflow_assignments_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "campaign_workflow_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_workflow_assignments" ADD CONSTRAINT "campaign_workflow_assignments_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "campaign_workflow_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "campaign_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_revision_id_workflow_id_fkey" FOREIGN KEY ("revision_id", "workflow_id") REFERENCES "campaign_workflow_revisions"("id", "workflow_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_source_org_id_fkey" FOREIGN KEY ("source_org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_target_org_id_fkey" FOREIGN KEY ("target_org_id") REFERENCES "employment_org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_requested_by_actor_id_fkey" FOREIGN KEY ("requested_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_target_actor_id_fkey" FOREIGN KEY ("target_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_responded_by_actor_id_fkey" FOREIGN KEY ("responded_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "campaign_workflow_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cooperation_requests" ADD CONSTRAINT "campaign_cooperation_requests_response_command_id_fkey" FOREIGN KEY ("response_command_id") REFERENCES "campaign_workflow_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Additive workflow history. No legacy content, lifecycle, authorship or assignment is backfilled.
ALTER TABLE workflow_policy_state ADD CONSTRAINT workflow_policy_positive_version CHECK (record_version > 0);
ALTER TABLE approval_policy_versions ADD CONSTRAINT approval_policy_valid CHECK (
  version > 0 AND length(btrim(reason)) > 0 AND
  ((campaign_id IS NULL AND scope_key = 'SYSTEM' AND preset IS NOT NULL) OR
   (campaign_id IS NOT NULL AND scope_key = 'CAMPAIGN:' || campaign_id::text)) AND
  ((preset IS NULL AND enforcement IS NULL) OR
   (preset IS NOT NULL AND enforcement IS NOT NULL AND ((preset = 'NO_APPROVAL' AND enforcement = 'NONE') OR
   (preset IN ('STANDARD','DEPARTMENT_REQUIRED','DIVISION_ONLY') AND enforcement = 'HARD')))));
ALTER TABLE campaign_workflows ADD CONSTRAINT workflow_positive_version CHECK (record_version > 0);
ALTER TABLE campaign_workflow_revisions ADD CONSTRAINT workflow_revision_valid CHECK (
  number > 0 AND subject_revision > 0 AND scope_revision > 0 AND
  policy_source IN ('SYSTEM_DEFAULT','CAMPAIGN_OVERRIDE') AND
  (route IS NULL OR route IN ('DEPARTMENT','DIVISION','NONE')) AND
  state IN ('DRAFT','PENDING','APPROVED','NO_APPROVAL','RETURNED','REJECTED','CANCELLED','SUPERSEDED','NEEDS_ROUTING','NEEDS_ASSIGNEE'));
ALTER TABLE campaign_workflow_steps ADD CONSTRAINT workflow_step_valid CHECK (
  step_version > 0 AND pool = 'ANY_ONE' AND kind IN ('DEPARTMENT_APPROVAL','DIVISION_ACCEPT_AND_ASSIGN') AND
  state IN ('PENDING','COMPLETED','SKIPPED_BY_ADMIN','CANCELLED','SUPERSEDED'));
ALTER TABLE campaign_workflow_commands ADD CONSTRAINT workflow_command_valid CHECK (
  context_mode IN ('DIRECT','DEMO_IMPERSONATION') AND payload_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE campaign_workflow_decisions ADD CONSTRAINT workflow_decision_valid CHECK (
  subject_revision > 0 AND step_version > 0 AND kind IN ('APPROVED_BY_LEADER','RETURNED','REJECTED','SKIPPED_BY_ADMIN') AND
  (kind = 'APPROVED_BY_LEADER' OR length(btrim(reason)) > 0));
ALTER TABLE campaign_workflow_assignments ADD CONSTRAINT workflow_assignment_valid CHECK (
  record_version > 0 AND functional_role IN ('DEPARTMENT_LEADER','DIVISION_LEADER','CAMPAIGN_MANAGER') AND
  responsibility IN ('LEAD','COOP') AND (ends_at IS NULL OR ends_at >= starts_at));
CREATE UNIQUE INDEX workflow_active_assignment ON campaign_workflow_assignments (workflow_id,actor_id,org_id,functional_role) WHERE ends_at IS NULL;
CREATE UNIQUE INDEX workflow_active_lead_cm ON campaign_workflow_assignments (workflow_id,org_id) WHERE ends_at IS NULL AND functional_role = 'CAMPAIGN_MANAGER' AND responsibility = 'LEAD';
CREATE UNIQUE INDEX workflow_active_lead_division ON campaign_workflow_assignments (workflow_id) WHERE ends_at IS NULL AND functional_role = 'DIVISION_LEADER' AND responsibility = 'LEAD';
CREATE UNIQUE INDEX workflow_active_lead_department ON campaign_workflow_assignments (workflow_id) WHERE ends_at IS NULL AND functional_role = 'DEPARTMENT_LEADER' AND responsibility = 'LEAD';
ALTER TABLE campaign_cooperation_requests ADD CONSTRAINT workflow_cooperation_valid CHECK (
  record_version > 0 AND source_org_id <> target_org_id AND length(btrim(reason)) > 0 AND
  state IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','SUPERSEDED') AND
  ((state = 'PENDING' AND responded_at IS NULL AND responded_by_actor_id IS NULL AND response_command_id IS NULL) OR
   (state <> 'PENDING' AND responded_at IS NOT NULL AND responded_by_actor_id IS NOT NULL AND response_command_id IS NOT NULL)));
CREATE UNIQUE INDEX workflow_pending_cooperation ON campaign_cooperation_requests (workflow_id,target_org_id) WHERE state = 'PENDING';

-- Historical policy and decisions are append-only, including during retries and restarts.
CREATE FUNCTION cpms_workflow_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Workflow history is append-only' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER immutable_approval_policy BEFORE UPDATE OR DELETE ON approval_policy_versions FOR EACH ROW EXECUTE FUNCTION cpms_workflow_history_immutable();
CREATE TRIGGER immutable_workflow_decision BEFORE UPDATE OR DELETE ON campaign_workflow_decisions FOR EACH ROW EXECUTE FUNCTION cpms_workflow_history_immutable();
CREATE FUNCTION cpms_workflow_revision_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Workflow revision history is append-only' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(OLD) - ARRAY['state','closed_at','scope_revision']) IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['state','closed_at','scope_revision']) THEN
    RAISE EXCEPTION 'Create a new revision to change the approval subject or policy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_workflow_subject BEFORE UPDATE OR DELETE ON campaign_workflow_revisions FOR EACH ROW EXECUTE FUNCTION cpms_workflow_revision_snapshot_immutable();

CREATE FUNCTION cpms_workflow_decision_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM campaign_workflow_steps s JOIN campaign_workflow_revisions r ON r.id = s.revision_id
    JOIN campaign_workflows w ON w.id = r.workflow_id
    JOIN campaign_workflow_commands c ON c.id = NEW.command_id
    WHERE s.id = NEW.step_id AND s.state = 'PENDING' AND w.current_revision_id = r.id
      AND s.step_version = NEW.step_version AND s.org_id = NEW.org_id
      AND r.subject_revision = NEW.subject_revision AND r.policy_version_id = NEW.policy_version_id
      AND c.campaign_id = w.campaign_id AND c.actor_id = NEW.actor_id AND c.original_actor_id = NEW.original_actor_id
  ) THEN RAISE EXCEPTION 'Decision does not match the current task, subject or command' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_workflow_decision BEFORE INSERT ON campaign_workflow_decisions FOR EACH ROW EXECUTE FUNCTION cpms_workflow_decision_consistency();
