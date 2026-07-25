CREATE TABLE IF NOT EXISTS bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screenshot_path text NOT NULL,
  screenshot_mime_type text NOT NULL DEFAULT 'image/png',
  screenshot_size_bytes integer NOT NULL,
  comment text NOT NULL,
  page_url text NOT NULL,
  reported_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status_created_at
  ON bug_reports(status, created_at DESC);
