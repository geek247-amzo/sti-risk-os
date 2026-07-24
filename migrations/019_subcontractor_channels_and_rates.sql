ALTER TABLE subcontractors
  ADD COLUMN IF NOT EXISTS preferred_channel text;

UPDATE subcontractors
SET preferred_channel = CASE
  WHEN preferred_channel IS NOT NULL THEN preferred_channel
  WHEN COALESCE(phone, '') <> '' THEN 'whatsapp'
  ELSE 'email'
END;

ALTER TABLE subcontractors
  ALTER COLUMN preferred_channel SET NOT NULL;

ALTER TABLE subcontractors
  ADD CONSTRAINT subcontractors_preferred_channel_check
  CHECK (preferred_channel IN ('whatsapp', 'email'));

