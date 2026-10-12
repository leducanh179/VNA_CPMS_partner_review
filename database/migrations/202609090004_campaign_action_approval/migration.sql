-- Existing append-only versions keep the mandatory gates; no campaign/decision is rewritten.
ALTER TABLE approval_policy_versions ADD COLUMN required_approvals jsonb NOT NULL DEFAULT
  '{"DEPLOY":true,"EDIT":true,"PAUSE":true,"RESUME":true,"CANCEL":true,"PURGE":true}'::jsonb;
ALTER TABLE approval_policy_versions ADD CONSTRAINT required_approvals_valid CHECK (
  jsonb_typeof(required_approvals) = 'object' AND
  required_approvals ?& ARRAY['DEPLOY','EDIT','PAUSE','RESUME','CANCEL','PURGE'] AND
  (required_approvals - ARRAY['DEPLOY','EDIT','PAUSE','RESUME','CANCEL','PURGE']) = '{}'::jsonb AND
  jsonb_typeof(required_approvals->'DEPLOY') = 'boolean' AND jsonb_typeof(required_approvals->'EDIT') = 'boolean' AND
  jsonb_typeof(required_approvals->'PAUSE') = 'boolean' AND jsonb_typeof(required_approvals->'RESUME') = 'boolean' AND
  jsonb_typeof(required_approvals->'CANCEL') = 'boolean' AND jsonb_typeof(required_approvals->'PURGE') = 'boolean'
);
ALTER TABLE campaign_change_requests DROP CONSTRAINT campaign_change_valid;
ALTER TABLE campaign_change_requests ADD CONSTRAINT campaign_change_valid CHECK (
  kind IN ('EDIT','PAUSE','CANCEL','PLAN','RESUME','RESTORE','PURGE') AND state IN ('PENDING','APPROVED','REJECTED','SUPERSEDED') AND
  subject_revision > 0 AND campaign_record_version > 0 AND record_version > 0 AND
  length(btrim(reason)) > 0 AND payload_hash ~ '^[0-9a-f]{64}$' AND
  ((state = 'PENDING' AND decided_at IS NULL AND decided_by_actor_id IS NULL) OR
   (state <> 'PENDING' AND decided_at IS NOT NULL AND decided_by_actor_id IS NOT NULL)));
