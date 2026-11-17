ALTER TABLE drivers
  ADD COLUMN status_changed_at timestamptz;

UPDATE drivers SET status_changed_at = updated_at;

ALTER TABLE drivers
  ALTER COLUMN status_changed_at SET DEFAULT now(),
  ALTER COLUMN status_changed_at SET NOT NULL;
