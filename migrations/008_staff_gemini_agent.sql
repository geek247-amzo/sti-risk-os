ALTER TABLE embedding_documents
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz,
  ADD COLUMN IF NOT EXISTS embedding_error text;

ALTER TABLE staff_chat_sessions
  ADD COLUMN IF NOT EXISTS agent_session_id text;

UPDATE staff_chat_sessions
SET agent_session_id = COALESCE(agent_session_id, hermes_session_id)
WHERE hermes_session_id IS NOT NULL;

UPDATE staff_chat_sessions
SET title = 'New chat'
WHERE title = 'New Hermes chat';
