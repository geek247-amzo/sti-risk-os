CREATE TABLE IF NOT EXISTS quote_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  source_quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_templates_active ON quote_templates(active);
CREATE INDEX IF NOT EXISTS idx_quote_templates_updated_at ON quote_templates(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_templates_organization_id ON quote_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_quote_templates_site_id ON quote_templates(site_id);
