ALTER TABLE inspection_item_responses
  ADD COLUMN IF NOT EXISTS ai_compliance_result text
    CHECK (ai_compliance_result IS NULL OR ai_compliance_result IN ('plausible_match', 'unclear', 'mismatch')),
  ADD COLUMN IF NOT EXISTS ai_compliance_rationale text,
  ADD COLUMN IF NOT EXISTS ai_compliance_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_compliance_error text;

CREATE INDEX IF NOT EXISTS idx_inspection_response_compliance
  ON inspection_item_responses(ai_compliance_result, ai_compliance_checked_at);
