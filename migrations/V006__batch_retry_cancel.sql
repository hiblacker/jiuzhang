ALTER TABLE control.ingestion_batch
  DROP CONSTRAINT ingestion_batch_job_run_key_uk;

ALTER TABLE control.ingestion_batch
  ADD CONSTRAINT ingestion_batch_job_run_attempt_uk
  UNIQUE (job_id, run_key, attempt);

CREATE INDEX ingestion_batch_job_run_attempt_idx
  ON control.ingestion_batch(job_id, run_key, attempt DESC, id DESC);
