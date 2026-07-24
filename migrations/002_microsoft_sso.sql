ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS microsoft_subject text,
  ADD COLUMN IF NOT EXISTS microsoft_tenant_id text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

ALTER TABLE app_users
  ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_microsoft_subject
  ON app_users(microsoft_subject)
  WHERE microsoft_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS oauth_states (
  state text PRIMARY KEY,
  code_verifier text NOT NULL,
  nonce text NOT NULL,
  return_to text NOT NULL DEFAULT '/staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
