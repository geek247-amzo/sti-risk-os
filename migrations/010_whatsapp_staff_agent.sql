CREATE TABLE IF NOT EXISTS whatsapp_approved_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  permission_tier text NOT NULL DEFAULT 'staff' CHECK (permission_tier IN ('agent', 'staff', 'admin')),
  allowed_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone_e164)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_approved_users_user_id
  ON whatsapp_approved_users(user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_approved_users_status
  ON whatsapp_approved_users(status);

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS approved_user_id uuid REFERENCES whatsapp_approved_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_staff_user_id
  ON whatsapp_conversations(staff_user_id);
