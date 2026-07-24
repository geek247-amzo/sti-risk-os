CREATE TABLE IF NOT EXISTS inspection_response_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_item_response_id uuid NOT NULL REFERENCES inspection_item_responses(id) ON DELETE CASCADE,
  location text,
  issue_description text NOT NULL,
  remediation_action text,
  quantity numeric(12,2),
  materials text,
  ai_model text,
  ai_confidence numeric(5,4),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inspection_item_responses
  ADD COLUMN IF NOT EXISTS ai_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_processing_error text;

CREATE INDEX IF NOT EXISTS idx_inspection_findings_response
  ON inspection_response_findings(inspection_item_response_id, created_at);
