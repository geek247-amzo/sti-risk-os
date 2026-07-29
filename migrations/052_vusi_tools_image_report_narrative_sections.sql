ALTER TABLE vusi_tools_image_reports
  ADD COLUMN IF NOT EXISTS main_concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority_actions jsonb NOT NULL DEFAULT '[]'::jsonb;
