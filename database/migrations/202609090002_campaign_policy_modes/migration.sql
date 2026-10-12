-- Extend the append-only approval policy catalog with the Campaign governance
-- modes exposed by System administration. Existing policy rows remain valid.
ALTER TABLE approval_policy_versions DROP CONSTRAINT IF EXISTS approval_policy_valid;

ALTER TABLE approval_policy_versions ADD CONSTRAINT approval_policy_valid CHECK (
  version > 0 AND length(btrim(reason)) > 0 AND
  ((campaign_id IS NULL AND scope_key = 'SYSTEM' AND preset IS NOT NULL) OR
   (campaign_id IS NOT NULL AND scope_key = 'CAMPAIGN:' || campaign_id::text)) AND
  ((preset IS NULL AND enforcement IS NULL) OR
   (preset IS NOT NULL AND enforcement IS NOT NULL AND (
     (preset IN ('NO_APPROVAL','NO_APPROVAL_LEVEL_1_ONLY') AND enforcement = 'NONE') OR
     (preset IN ('STANDARD','DEPARTMENT_REQUIRED','DIVISION_ONLY','DIVISION_LEVEL_1_ONLY') AND enforcement = 'HARD')
   )))
);
