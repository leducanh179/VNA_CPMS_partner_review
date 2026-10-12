-- Keep immutable decision rows and all other validation. Only rejection opinions become optional.
BEGIN;
ALTER TABLE campaign_workflow_decisions DROP CONSTRAINT workflow_decision_valid;
ALTER TABLE campaign_workflow_decisions ADD CONSTRAINT workflow_decision_valid CHECK (
  subject_revision > 0 AND step_version > 0 AND kind IN ('APPROVED_BY_LEADER','RETURNED','REJECTED','SKIPPED_BY_ADMIN') AND
  (kind IN ('APPROVED_BY_LEADER','REJECTED') OR length(btrim(reason)) > 0));
COMMIT;
