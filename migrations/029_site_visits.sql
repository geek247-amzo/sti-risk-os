CREATE TABLE IF NOT EXISTS site_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  container_id uuid NOT NULL REFERENCES containers(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  building_id uuid REFERENCES buildings(id) ON DELETE SET NULL,
  floor_id uuid REFERENCES floors(id) ON DELETE SET NULL,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  capture_mode text NOT NULL
    CHECK (capture_mode IN ('technician_submitted', 'client_self_service_submitted')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'submitted', 'staff_reviewed')),
  submitted_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  submitted_by_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(submitted_by_user_id, submitted_by_contact_id) <= 1)
);

CREATE INDEX IF NOT EXISTS idx_site_visits_organization
  ON site_visits(organization_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_container
  ON site_visits(container_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_project
  ON site_visits(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_site
  ON site_visits(site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_review_queue
  ON site_visits(capture_mode, status, submitted_at DESC);
