-- Standalone, advisory single-image findings reports for Vusi Tools.
-- Deliberately independent of scans, checklist items, and formal inspections.
CREATE TABLE IF NOT EXISTS vusi_tools_image_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_file_id uuid NOT NULL REFERENCES evidence_files(id) ON DELETE RESTRICT,
  site_visit_id uuid REFERENCES site_visits(id) ON DELETE SET NULL,
  location_note text,
  performed_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vusi_tools_image_report_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES vusi_tools_image_reports(id) ON DELETE CASCADE,
  finding_description text NOT NULL,
  sans_reference text,
  severity text NOT NULL CHECK (severity IN ('info', 'minor', 'moderate', 'critical')),
  gemini_rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vusi_tools_image_reports_created
  ON vusi_tools_image_reports(performed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vusi_tools_image_reports_site_visit
  ON vusi_tools_image_reports(site_visit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vusi_tools_image_report_findings_report
  ON vusi_tools_image_report_findings(report_id, severity);
