-- E2: retain idempotent Yeastar CDR and recording metadata for the pull-based sync.
-- Audio files remain on the PBX until a later, separately scoped retention decision.
CREATE TABLE IF NOT EXISTS yeastar_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_uid text NOT NULL UNIQUE,
  provider_cdr_id text,
  provider_recording_id text,
  call_time timestamptz,
  call_type text,
  call_from text,
  call_from_name text,
  call_from_number text,
  call_to text,
  call_to_name text,
  call_to_number text,
  disposition text,
  duration_seconds integer,
  recording_file text,
  recording_size_bytes bigint,
  raw_cdr jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_recording jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yeastar_calls_call_time ON yeastar_calls(call_time DESC);
CREATE INDEX IF NOT EXISTS idx_yeastar_calls_from_number ON yeastar_calls(call_from_number);
CREATE INDEX IF NOT EXISTS idx_yeastar_calls_to_number ON yeastar_calls(call_to_number);

CREATE TABLE IF NOT EXISTS yeastar_sync_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_successful_poll_at timestamptz,
  poll_interval_minutes integer NOT NULL DEFAULT 20 CHECK (poll_interval_minutes BETWEEN 15 AND 30),
  backfill_minutes integer NOT NULL DEFAULT 120 CHECK (backfill_minutes BETWEEN 15 AND 10080),
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO yeastar_sync_state (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;
