CREATE TABLE IF NOT EXISTS microsoft_email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  to_recipients text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  status text NOT NULL DEFAULT 'ai_draft'
    CHECK (status IN ('ai_draft', 'needs_edits', 'outlook_created', 'archived')),
  source_email_id text,
  outlook_message_id text,
  prompt text,
  edit_instructions text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_microsoft_email_drafts_user_updated
  ON microsoft_email_drafts(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_microsoft_email_drafts_status
  ON microsoft_email_drafts(status);
