ALTER TABLE control.ingestion_job
  ADD COLUMN checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN checkpoint_version BIGINT NOT NULL DEFAULT 0 CHECK (checkpoint_version >= 0);

ALTER TABLE control.ingestion_batch
  ADD COLUMN run_key VARCHAR(120),
  ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  ADD COLUMN error_code VARCHAR(80),
  ADD COLUMN diagnostic_ref VARCHAR(300),
  ADD COLUMN checkpoint_version BIGINT,
  ADD COLUMN committed_at TIMESTAMPTZ;

UPDATE control.ingestion_batch
  SET run_key = 'legacy-' || id
  WHERE run_key IS NULL;

ALTER TABLE control.ingestion_batch
  ALTER COLUMN run_key SET NOT NULL;

ALTER TABLE control.ingestion_batch
  ADD CONSTRAINT ingestion_batch_job_run_key_uk UNIQUE (job_id, run_key);

CREATE INDEX ingestion_batch_state_started_at_idx
  ON control.ingestion_batch(state, started_at DESC, id DESC);
