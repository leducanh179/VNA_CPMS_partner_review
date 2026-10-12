-- Add reviewable recovery requests without changing existing decisions or effective states.
ALTER TABLE campaign_change_requests DROP CONSTRAINT campaign_change_valid;
ALTER TABLE campaign_change_requests ADD CONSTRAINT campaign_change_valid CHECK (
  kind IN ('EDIT','PAUSE','CANCEL','PLAN','RESUME','RESTORE') AND state IN ('PENDING','APPROVED','REJECTED','SUPERSEDED') AND
  subject_revision > 0 AND campaign_record_version > 0 AND record_version > 0 AND
  length(btrim(reason)) > 0 AND payload_hash ~ '^[0-9a-f]{64}$' AND
  ((state = 'PENDING' AND decided_at IS NULL AND decided_by_actor_id IS NULL) OR
   (state <> 'PENDING' AND decided_at IS NOT NULL AND decided_by_actor_id IS NOT NULL)));
