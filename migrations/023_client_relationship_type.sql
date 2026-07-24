ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS relationship_type text NOT NULL DEFAULT 'end_user';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_relationship_type_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_relationship_type_check
  CHECK (relationship_type IN ('strategic', 'collaborative', 'end_user'));

