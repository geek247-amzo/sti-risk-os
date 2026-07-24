CREATE TABLE IF NOT EXISTS client_signoff_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('service_report', 'job_card')),
  target_id uuid NOT NULL,
  token_hash text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired', 'revoked')),
  expires_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_signoff_links_target
  ON client_signoff_links(target_type, target_id, status);

CREATE TABLE IF NOT EXISTS client_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signoff_link_id uuid NOT NULL REFERENCES client_signoff_links(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('service_report', 'job_card')),
  target_id uuid NOT NULL,
  signer_name text NOT NULL,
  signer_role text,
  signature_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_signatures_target
  ON client_signatures(target_type, target_id, signed_at DESC);

