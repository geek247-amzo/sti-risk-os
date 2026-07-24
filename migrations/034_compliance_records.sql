CREATE TABLE IF NOT EXISTS compliance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  site_visit_id uuid NOT NULL REFERENCES site_visits(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('green', 'red', 'yellow')),
  note text,
  service_report_id uuid REFERENCES service_reports(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  assessed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_records_area_history
  ON compliance_records(area_id, asset_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_records_visit
  ON compliance_records(site_visit_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_records_status
  ON compliance_records(status, assessed_at DESC);

