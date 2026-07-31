-- Phase 6 quick notes. Notes are separate from evidence metadata so one evidence item
-- can have multiple typed observations and safety flags.
CREATE TABLE IF NOT EXISTS site_visit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_visit_id uuid NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  evidence_file_id uuid REFERENCES evidence_files(id) ON DELETE SET NULL,
  note_type text NOT NULL CHECK (note_type IN ('voice', 'typed', 'question', 'recommendation', 'missing_information')),
  body text NOT NULL,
  is_urgent boolean NOT NULL DEFAULT false,
  is_immediate_danger boolean NOT NULL DEFAULT false,
  needs_specialist_review boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_visit_notes_visit
  ON site_visit_notes(site_visit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visit_notes_danger
  ON site_visit_notes(is_immediate_danger, is_urgent, created_at DESC);
