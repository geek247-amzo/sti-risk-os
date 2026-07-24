ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS site_code text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, name)
);

CREATE TABLE IF NOT EXISTS floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name text NOT NULL,
  level_number integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_id, name)
);

CREATE TABLE IF NOT EXISTS areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  building_id uuid REFERENCES buildings(id) ON DELETE SET NULL,
  floor_id uuid REFERENCES floors(id) ON DELETE SET NULL,
  name text NOT NULL,
  area_type text NOT NULL DEFAULT 'area',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, name)
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  building_id uuid REFERENCES buildings(id) ON DELETE SET NULL,
  floor_id uuid REFERENCES floors(id) ON DELETE SET NULL,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  legacy_site_asset_id uuid REFERENCES site_assets(id) ON DELETE SET NULL,
  asset_tag text,
  name text NOT NULL,
  asset_type text NOT NULL DEFAULT 'asset',
  manufacturer text,
  model text,
  serial_number text,
  system_family text,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'functional', 'non_functional', 'at_risk', 'decommissioned')),
  installed_on date,
  last_serviced_on date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  building_id uuid REFERENCES buildings(id) ON DELETE SET NULL,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  title text NOT NULL,
  work_type text NOT NULL DEFAULT 'service',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'quoted', 'po_received', 'scheduled', 'on_site', 'report_pending', 'complete', 'invoiced', 'cancelled')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  scope text,
  scheduled_for date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_pos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  po_number text,
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'sales_order_draft', 'processed', 'cancelled')),
  currency char(3) NOT NULL DEFAULT 'ZAR',
  amount_cents integer NOT NULL DEFAULT 0,
  received_on date NOT NULL DEFAULT current_date,
  file_name text,
  file_path text,
  extracted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  client_po_id uuid REFERENCES client_pos(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  sales_order_number text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready_for_sage', 'synced', 'cancelled')),
  sage_reference text,
  total_cents integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subcontractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  primary_contact_name text,
  email citext,
  phone text,
  region text,
  work_types text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
  compliance_status text NOT NULL DEFAULT 'unknown' CHECK (compliance_status IN ('unknown', 'pending', 'approved', 'expired')),
  rate_card jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subcontractor_pos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  client_po_id uuid REFERENCES client_pos(id) ON DELETE SET NULL,
  po_number text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'accepted', 'complete', 'invoiced', 'paid', 'cancelled')),
  amount_cents integer NOT NULL DEFAULT 0,
  issued_on date,
  due_on date,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES work_items(id) ON DELETE CASCADE,
  subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL,
  token_hash text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired', 'revoked')),
  expires_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS field_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  job_link_id uuid REFERENCES job_links(id) ON DELETE SET NULL,
  subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL,
  submitted_by_name text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'needs_review', 'approved', 'rejected')),
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  fault_notes text,
  recommendations text,
  quote_line_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS job_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  field_submission_id uuid REFERENCES field_submissions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'missing' CHECK (status IN ('missing', 'uploaded', 'signed', 'approved', 'rejected')),
  signed_by_name text,
  signed_at timestamptz,
  file_name text,
  file_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  field_submission_id uuid REFERENCES field_submissions(id) ON DELETE SET NULL,
  report_type text NOT NULL DEFAULT 'site_visit',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_vusi_approval', 'approved', 'sent_to_client', 'archived')),
  title text NOT NULL,
  summary text,
  report_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_file_path text,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  field_submission_id uuid REFERENCES field_submissions(id) ON DELETE SET NULL,
  report_id uuid REFERENCES service_reports(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  evidence_type text NOT NULL DEFAULT 'file',
  file_name text NOT NULL,
  file_path text,
  mime_type text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  report_id uuid REFERENCES service_reports(id) ON DELETE SET NULL,
  title text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'monitoring', 'quoted', 'resolved', 'accepted_by_client')),
  description text,
  recommended_action text,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  risk_id uuid REFERENCES risks(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'quote_required', 'quoted', 'approved', 'declined', 'complete')),
  description text,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'executed')),
  title text NOT NULL,
  summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL DEFAULT 'steve',
  requested_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approval_request_id uuid REFERENCES approval_requests(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'executed', 'rejected', 'failed')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO subcontractors (name, primary_contact_name, region, work_types, compliance_status, notes)
VALUES
  ('Hank', 'Hank', 'Gauteng', ARRAY['fire systems', 'services'], 'pending', 'Priority subcontractor candidate from STI operating model.'),
  ('Louis', 'Louis', 'National', ARRAY['technical support'], 'pending', 'Technical support subcontractor candidate.'),
  ('Clem Roy', 'Clem Roy', 'Western Cape', ARRAY['field services'], 'pending', 'Field services subcontractor candidate.')
ON CONFLICT (name) DO UPDATE SET
  region = EXCLUDED.region,
  work_types = EXCLUDED.work_types,
  updated_at = now();

CREATE INDEX IF NOT EXISTS idx_buildings_site_id ON buildings(site_id);
CREATE INDEX IF NOT EXISTS idx_floors_building_id ON floors(building_id);
CREATE INDEX IF NOT EXISTS idx_areas_site_id ON areas(site_id);
CREATE INDEX IF NOT EXISTS idx_assets_site_id ON assets(site_id);
CREATE INDEX IF NOT EXISTS idx_assets_organization_id ON assets(organization_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_organization_id ON work_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_work_items_project_id ON work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_client_pos_status ON client_pos(status);
CREATE INDEX IF NOT EXISTS idx_client_pos_quote_id ON client_pos(quote_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_subcontractor_pos_status ON subcontractor_pos(status);
CREATE INDEX IF NOT EXISTS idx_field_submissions_work_item_id ON field_submissions(work_item_id);
CREATE INDEX IF NOT EXISTS idx_job_cards_work_item_id ON job_cards(work_item_id);
CREATE INDEX IF NOT EXISTS idx_service_reports_status ON service_reports(status);
CREATE INDEX IF NOT EXISTS idx_evidence_files_work_item_id ON evidence_files(work_item_id);
CREATE INDEX IF NOT EXISTS idx_risks_status ON risks(status);
CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_agent_actions_status ON agent_actions(status);
