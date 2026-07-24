CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS site_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  asset_type text NOT NULL DEFAULT 'system',
  manufacturer text,
  model text,
  system_family text,
  notes text,
  installed_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_code text UNIQUE NOT NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'part',
  manufacturer text,
  system_family text,
  default_unit_cost_cents integer NOT NULL DEFAULT 0,
  default_unit_price_cents integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text UNIQUE NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'pending_technical_review',
      'approved_internal',
      'sent_to_client',
      'accepted',
      'rejected'
    )
  ),
  currency char(3) NOT NULL DEFAULT 'ZAR',
  subtotal_cents integer NOT NULL DEFAULT 0,
  total_cost_cents integer NOT NULL DEFAULT 0,
  total_value_cents integer NOT NULL DEFAULT 0,
  margin_cents integer NOT NULL DEFAULT 0,
  margin_percent numeric(6,2) NOT NULL DEFAULT 0,
  valid_until date,
  client_reference text,
  notes text,
  approved_at timestamptz,
  sent_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  part_id uuid REFERENCES parts(id) ON DELETE SET NULL,
  part_code text,
  description text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_cost_cents integer NOT NULL DEFAULT 0,
  unit_price_cents integer NOT NULL DEFAULT 0,
  total_cost_cents integer NOT NULL DEFAULT 0,
  total_price_cents integer NOT NULL DEFAULT 0,
  markup_percent numeric(6,2) NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('green', 'amber', 'red')),
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  implicated_line_item_ids uuid[] NOT NULL DEFAULT '{}',
  tool_call_id uuid REFERENCES tool_calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_organization_id ON sites(organization_id);
CREATE INDEX IF NOT EXISTS idx_site_assets_site_id ON site_assets(site_id);
CREATE INDEX IF NOT EXISTS idx_parts_part_code ON parts(part_code);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_organization_id ON quotes(organization_id);
CREATE INDEX IF NOT EXISTS idx_quotes_site_id ON quotes(site_id);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote_id ON quote_line_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_validations_quote_id ON quote_validations(quote_id);

INSERT INTO parts (
  part_code, description, category, manufacturer, system_family,
  default_unit_cost_cents, default_unit_price_cents
)
VALUES
  ('APOLLO-S65-SD', 'Apollo Series 65 optical smoke detector', 'detector', 'Apollo', 'apollo', 38000, 62000),
  ('APOLLO-XP95-MCP', 'Apollo XP95 manual call point', 'call_point', 'Apollo', 'apollo', 42000, 69000),
  ('ZITON-ZP755', 'Ziton addressable optical smoke detector', 'detector', 'Ziton', 'ziton', 41000, 68000),
  ('ZITON-ZP785', 'Ziton addressable heat detector', 'detector', 'Ziton', 'ziton', 43000, 71000),
  ('C-TEC-EP203', 'C-TEC conventional fire alarm panel', 'panel', 'C-TEC', 'ctec', 620000, 930000),
  ('GEN-CABLE-FR', 'Fire-rated detection cable per metre', 'cable', 'Generic', 'generic', 1800, 3200),
  ('GEN-COMMISSION', 'Commissioning and technical validation labour', 'labour', 'STI Risk', 'service', 0, 125000)
ON CONFLICT (part_code) DO UPDATE SET
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  manufacturer = EXCLUDED.manufacturer,
  system_family = EXCLUDED.system_family,
  default_unit_cost_cents = EXCLUDED.default_unit_cost_cents,
  default_unit_price_cents = EXCLUDED.default_unit_price_cents,
  active = true,
  updated_at = now();
