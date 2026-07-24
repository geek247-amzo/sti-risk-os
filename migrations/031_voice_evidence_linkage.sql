ALTER TABLE evidence_files
  ADD COLUMN IF NOT EXISTS site_visit_id uuid REFERENCES site_visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_measurement_id uuid REFERENCES area_measurements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audio_duration numeric(12,3),
  ADD COLUMN IF NOT EXISTS recording_format text,
  ADD COLUMN IF NOT EXISTS transcription_status text DEFAULT 'not_requested';

ALTER TABLE evidence_files
  ADD CONSTRAINT evidence_files_audio_duration_check
    CHECK (audio_duration IS NULL OR audio_duration >= 0),
  ADD CONSTRAINT evidence_files_transcription_status_check
    CHECK (transcription_status IS NULL OR transcription_status IN ('not_requested', 'queued', 'processing', 'completed', 'failed')),
  ADD CONSTRAINT evidence_files_voice_visit_required_check
    CHECK (evidence_type <> 'voice' OR site_visit_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_evidence_files_site_visit
  ON evidence_files(site_visit_id, evidence_type, created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_files_area
  ON evidence_files(area_id, created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_files_area_measurement
  ON evidence_files(area_measurement_id);
