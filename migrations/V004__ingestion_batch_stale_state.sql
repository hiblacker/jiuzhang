ALTER TABLE control.ingestion_batch
  DROP CONSTRAINT ingestion_batch_state_check;

ALTER TABLE control.ingestion_batch
  ADD CONSTRAINT ingestion_batch_state_check
  CHECK (state IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','STALE'));
