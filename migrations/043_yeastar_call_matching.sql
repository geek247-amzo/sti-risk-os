-- E4: link calls to staff extensions/customers and persist self-service tagging rules.
CREATE TABLE IF NOT EXISTS yeastar_extension_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_extension text UNIQUE NOT NULL,
  provider_name text,
  provider_email citext,
  app_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yeastar_call_personal_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_number text UNIQUE NOT NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE yeastar_calls
  ADD COLUMN IF NOT EXISTS staff_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_number text,
  ADD COLUMN IF NOT EXISTS tag_status text NOT NULL DEFAULT 'untagged'
    CHECK (tag_status IN ('untagged', 'matched', 'personal')),
  ADD COLUMN IF NOT EXISTS tagged_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tagged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_yeastar_calls_staff_user ON yeastar_calls(staff_user_id, call_time DESC);
CREATE INDEX IF NOT EXISTS idx_yeastar_calls_tag_status ON yeastar_calls(tag_status, call_time DESC);
CREATE INDEX IF NOT EXISTS idx_yeastar_calls_contact ON yeastar_calls(contact_id);
