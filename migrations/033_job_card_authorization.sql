ALTER TABLE job_cards
  ADD COLUMN IF NOT EXISTS authorized_by text;

