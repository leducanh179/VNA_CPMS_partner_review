-- Reuse the existing immutable audit-history guard.
CREATE TRIGGER immutable_qctt_plan_item_revision BEFORE UPDATE OR DELETE ON qctt_plan_item_revisions
FOR EACH ROW EXECUTE FUNCTION cpms_workflow_history_immutable();
CREATE TRIGGER immutable_qctt_plan_command BEFORE UPDATE OR DELETE ON qctt_plan_commands
FOR EACH ROW EXECUTE FUNCTION cpms_workflow_history_immutable();
