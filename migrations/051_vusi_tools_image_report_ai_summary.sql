-- Store the two-stage advisory output for the single-image area report.
-- Deliberately independent of formal inspections and the fixed Vusi scan tables.
ALTER TABLE vusi_tools_image_reports
  ADD COLUMN IF NOT EXISTS image_description text,
  ADD COLUMN IF NOT EXISTS overview text,
  ADD COLUMN IF NOT EXISTS risk_level text CHECK (risk_level IN ('low', 'moderate', 'high', 'critical'));
