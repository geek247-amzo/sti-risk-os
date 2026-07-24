ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS line_type text;

ALTER TABLE quote_line_items
  ADD CONSTRAINT quote_line_items_line_type_check
  CHECK (line_type IS NULL OR line_type IN ('technology', 'labor_travel_accommodation', 'sla'));

