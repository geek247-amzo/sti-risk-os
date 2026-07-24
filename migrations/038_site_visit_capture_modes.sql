ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS visit_type text
    CHECK (visit_type IS NULL OR visit_type IN ('maintenance', 'project')),
  ADD COLUMN IF NOT EXISTS client_po_id uuid REFERENCES client_pos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL;

ALTER TABLE evidence_files
  ADD COLUMN IF NOT EXISTS capture_phase text
    CHECK (capture_phase IS NULL OR capture_phase IN ('before', 'during', 'after'));

CREATE INDEX IF NOT EXISTS idx_site_visits_client_po
  ON site_visits(client_po_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_work_item
  ON site_visits(work_item_id);
CREATE INDEX IF NOT EXISTS idx_evidence_files_capture_phase
  ON evidence_files(site_visit_id, capture_phase, created_at);
