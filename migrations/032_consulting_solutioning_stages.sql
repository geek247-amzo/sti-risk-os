ALTER TABLE service_reports
  ADD COLUMN IF NOT EXISTS site_visit_id uuid REFERENCES site_visits(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS consulting_solutioning_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_visit_id uuid NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  container_id uuid NOT NULL REFERENCES containers(id) ON DELETE RESTRICT,
  stage_type text NOT NULL CHECK (stage_type IN ('consulting', 'solutioning')),
  tier text NOT NULL CHECK (tier IN ('level_1', 'level_2', 'level_3')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'delivered', 'pending_charge', 'charged', 'waived', 'cancelled')),
  service_report_id uuid REFERENCES service_reports(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  price_cents integer,
  currency char(3) NOT NULL DEFAULT 'ZAR',
  notes text,
  delivered_at timestamptz,
  charged_at timestamptz,
  waived_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consulting_stages_visit
  ON consulting_solutioning_stages(site_visit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consulting_stages_container
  ON consulting_solutioning_stages(container_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consulting_stages_project
  ON consulting_solutioning_stages(project_id, status);
CREATE INDEX IF NOT EXISTS idx_consulting_stages_report
  ON consulting_solutioning_stages(service_report_id);

