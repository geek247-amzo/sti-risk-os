ALTER TABLE project_qr_identities
  ADD COLUMN IF NOT EXISTS token_ciphertext text;
