-- Scope correction: exploitation is assigned at slot/item level, not the contract header.
-- This column was introduced earlier in this unfinished delivery and never populated.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM supply_contracts WHERE operator_actor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Unexpected contract operator assignments; reconcile before removing the unused header field';
  END IF;
END $$;
ALTER TABLE supply_contracts DROP COLUMN operator_actor_id;
