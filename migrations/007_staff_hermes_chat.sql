CREATE TABLE IF NOT EXISTS staff_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  hermes_session_id text UNIQUE,
  title text NOT NULL DEFAULT 'New Hermes chat',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);

CREATE TABLE IF NOT EXISTS staff_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES staff_chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES staff_chat_sessions(id) ON DELETE CASCADE,
  message_id uuid REFERENCES staff_chat_messages(id) ON DELETE SET NULL,
  uploader_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  stored_path text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes integer NOT NULL,
  extracted_text text,
  status text NOT NULL DEFAULT 'ready',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_chat_sessions_user_updated
  ON staff_chat_sessions(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_chat_messages_session_created
  ON staff_chat_messages(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_staff_chat_attachments_session_created
  ON staff_chat_attachments(session_id, created_at DESC);
