ALTER TABLE client_signoff_links
  DROP CONSTRAINT IF EXISTS client_signoff_links_target_type_check;

ALTER TABLE client_signoff_links
  ADD CONSTRAINT client_signoff_links_target_type_check
  CHECK (target_type IN ('service_report', 'job_card', 'quote'));

ALTER TABLE client_signatures
  DROP CONSTRAINT IF EXISTS client_signatures_target_type_check;

ALTER TABLE client_signatures
  ADD CONSTRAINT client_signatures_target_type_check
  CHECK (target_type IN ('service_report', 'job_card', 'quote'));
