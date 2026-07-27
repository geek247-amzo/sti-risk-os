-- Field work can be owned by an internal staff member or assigned directly to
-- a subcontractor. Keep owner_id for internal ownership and add the external
-- assignment alongside it; subcontractor POs remain a separate financial record.
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_subcontractor_id ON work_items(subcontractor_id);
