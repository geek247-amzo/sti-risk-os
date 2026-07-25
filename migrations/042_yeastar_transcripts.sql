-- E3: persist downloaded call audio and Gemini transcription results.
ALTER TABLE yeastar_calls
  ADD COLUMN IF NOT EXISTS audio_path text,
  ADD COLUMN IF NOT EXISTS audio_mime_type text,
  ADD COLUMN IF NOT EXISTS audio_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS transcription_status text NOT NULL DEFAULT 'pending'
    CHECK (transcription_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_model text,
  ADD COLUMN IF NOT EXISTS transcribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcription_error text;

CREATE INDEX IF NOT EXISTS idx_yeastar_calls_transcription_status
  ON yeastar_calls(transcription_status, call_time DESC);
