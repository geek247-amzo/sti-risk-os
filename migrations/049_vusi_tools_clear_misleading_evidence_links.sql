-- Results are item assessments over the whole scan photo set. A single
-- evidence_file_id cannot truthfully identify which photo informed a result.
-- The uploaded evidence remains grouped by metadata.scan_id on evidence_files.
UPDATE vusi_tools_scan_results
SET evidence_file_id = NULL
WHERE evidence_file_id IS NOT NULL;
