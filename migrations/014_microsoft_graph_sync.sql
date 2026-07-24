CREATE TABLE IF NOT EXISTS microsoft_user_tokens (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_id text,
  scopes text[] NOT NULL DEFAULT '{}',
  access_token_cipher text,
  refresh_token_cipher text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_microsoft_user_tokens_expires
  ON microsoft_user_tokens(expires_at);
