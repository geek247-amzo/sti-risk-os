CREATE TABLE IF NOT EXISTS checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  category text NOT NULL,
  applicable_asset_type text,
  sans_standard text NOT NULL DEFAULT 'SANS 10139',
  effective_from date,
  effective_to date,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_family_id, version)
);

CREATE TABLE IF NOT EXISTS checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  item_text text NOT NULL,
  sans_clause text,
  response_type text NOT NULL DEFAULT 'pass_fail_na'
    CHECK (response_type IN ('pass_fail_na', 'pass_fail_defective', 'freeform', 'numeric')),
  required boolean NOT NULL DEFAULT true,
  photo_required boolean NOT NULL DEFAULT false,
  risk_weight integer NOT NULL DEFAULT 1 CHECK (risk_weight BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, position)
);

CREATE TABLE IF NOT EXISTS inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE RESTRICT,
  checklist_template_version integer NOT NULL CHECK (checklist_template_version > 0),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  service_report_id uuid REFERENCES service_reports(id) ON DELETE SET NULL,
  technician_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  computed_risk_level text NOT NULL DEFAULT 'low'
    CHECK (computed_risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_level_override text CHECK (risk_level_override IS NULL OR risk_level_override IN ('low', 'medium', 'high', 'critical')),
  risk_level_override_reason text,
  risk_level text NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  outcome text NOT NULL DEFAULT 'pass' CHECK (outcome IN ('pass', 'fail')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'voided')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (checklist_template_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS inspection_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  signer_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  signer_name text NOT NULL,
  signature_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id)
);

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS signature_id uuid REFERENCES inspection_signatures(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS inspection_item_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  checklist_template_item_id uuid NOT NULL REFERENCES checklist_template_items(id) ON DELETE RESTRICT,
  outcome text CHECK (outcome IS NULL OR outcome IN ('ok', 'defective', 'na')),
  comment text,
  na_reason text,
  numeric_value numeric,
  responded_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  responded_at timestamptz NOT NULL DEFAULT now(),
  ai_processed boolean NOT NULL DEFAULT false,
  UNIQUE (inspection_id, checklist_template_item_id)
);

ALTER TABLE evidence_files
  ADD COLUMN IF NOT EXISTS inspection_id uuid REFERENCES inspections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspection_item_response_id uuid REFERENCES inspection_item_responses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capture_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS gps_lat numeric(10,7),
  ADD COLUMN IF NOT EXISTS gps_lng numeric(10,7),
  ADD COLUMN IF NOT EXISTS location_text text;

CREATE INDEX IF NOT EXISTS idx_checklist_templates_lookup
  ON checklist_templates(status, category, applicable_asset_type);
CREATE INDEX IF NOT EXISTS idx_checklist_template_items_template
  ON checklist_template_items(template_id, position);
CREATE INDEX IF NOT EXISTS idx_inspections_asset_status
  ON inspections(asset_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_work_item
  ON inspections(work_item_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_responses_inspection
  ON inspection_item_responses(inspection_id);
CREATE INDEX IF NOT EXISTS idx_evidence_files_inspection
  ON evidence_files(inspection_id, inspection_item_response_id, created_at);
