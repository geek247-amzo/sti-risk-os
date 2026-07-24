ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organizations_primary_contact_idx
  ON organizations(primary_contact_id);
