ALTER TABLE control.ingestion_job
  ADD COLUMN delete_spec JSONB NOT NULL DEFAULT '{"mode":"NONE"}'::jsonb,
  ADD COLUMN version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX ingestion_job_source_id_id_idx
  ON control.ingestion_job(source_id, id);

CREATE INDEX ingestion_batch_job_id_started_at_idx
  ON control.ingestion_batch(job_id, started_at DESC, id DESC);
