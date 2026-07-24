ALTER TABLE subcontractor_pos
  ADD COLUMN IF NOT EXISTS job_link_id uuid REFERENCES job_links(id) ON DELETE SET NULL;

