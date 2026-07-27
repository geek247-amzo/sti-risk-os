-- Projects are operational work for a specific customer site. Keep the legacy
-- deal relationship for historical CRM context, but make the site link explicit
-- for all newly created projects.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_site_id ON projects(site_id);
