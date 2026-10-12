-- Additive lineage only; operational splits are authorized Application Service commands.
ALTER TABLE supply_allocations ADD COLUMN superseded_at TIMESTAMPTZ(3), ADD COLUMN split_from_id UUID;
CREATE INDEX supply_allocations_split_from_id_idx ON supply_allocations(split_from_id);
ALTER TABLE supply_allocations ADD CONSTRAINT supply_allocations_split_from_id_fkey
  FOREIGN KEY (split_from_id) REFERENCES supply_allocations(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE supply_allocations ADD CONSTRAINT supply_allocation_not_self_split CHECK (split_from_id IS NULL OR split_from_id <> id);
