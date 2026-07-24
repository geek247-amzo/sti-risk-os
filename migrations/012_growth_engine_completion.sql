ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lemlist_event_id uuid REFERENCES lemlist_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_contact_id ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_lemlist_event_id ON tasks(lemlist_event_id);
