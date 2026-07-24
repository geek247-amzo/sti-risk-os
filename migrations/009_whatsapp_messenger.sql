CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  chat_id text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  display_name text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, chat_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
  source_inbound_event_id uuid REFERENCES inbound_events(id) ON DELETE SET NULL,
  ai_recommendation_id uuid REFERENCES ai_recommendations(id) ON DELETE SET NULL,
  communication_id uuid REFERENCES communications(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  message_body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'claimed', 'sent', 'failed', 'retryable_failed', 'cancelled')
  ),
  claimed_by text,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_claim
  ON whatsapp_outbox(status, next_attempt_at, lease_until, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_chat
  ON whatsapp_conversations(instance_id, chat_id);
