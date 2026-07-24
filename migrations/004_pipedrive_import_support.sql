ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS pipedrive_id text;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pipedrive_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_pipedrive_id
  ON organizations(pipedrive_id)
  WHERE pipedrive_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_pipedrive_id
  ON contacts(pipedrive_id)
  WHERE pipedrive_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_pipedrive_id
  ON deals(pipedrive_id)
  WHERE pipedrive_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pipedrive_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  leads_file text,
  deals_file text,
  leads_imported integer NOT NULL DEFAULT 0,
  deals_imported integer NOT NULL DEFAULT 0,
  organizations_imported integer NOT NULL DEFAULT 0,
  contacts_imported integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
