ALTER TABLE control.ingestion_batch
  ADD COLUMN lease_owner VARCHAR(200),
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN last_heartbeat_at TIMESTAMPTZ;

UPDATE control.ingestion_batch
  SET state = 'FAILED',
      error_code = 'LEASE_MIGRATION_REQUIRED',
      finished_at = statement_timestamp()
  WHERE state = 'RUNNING';

ALTER TABLE control.ingestion_batch
  ADD CONSTRAINT ingestion_batch_running_lease_check
  CHECK (
    state <> 'RUNNING'
    OR (
      lease_owner IS NOT NULL
      AND lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      AND lease_expires_at IS NOT NULL
      AND last_heartbeat_at IS NOT NULL
      AND lease_expires_at > last_heartbeat_at
    )
  );

CREATE INDEX ingestion_batch_expired_lease_idx
  ON control.ingestion_batch(lease_expires_at, id)
  WHERE state = 'RUNNING';

CREATE FUNCTION raw.enforce_active_batch_lease()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_state VARCHAR(20);
  v_lease_owner VARCHAR(200);
  v_lease_expires_at TIMESTAMPTZ;
BEGIN
  SELECT state, lease_owner, lease_expires_at
    INTO v_state, v_lease_owner, v_lease_expires_at
    FROM control.ingestion_batch
    WHERE id = NEW.batch_id
    FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RAW_BATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_state <> 'RUNNING' OR v_lease_expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'RAW_BATCH_LEASE_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'ingestion_batch_manifest' THEN
    IF NEW.writer_principal <> v_lease_owner THEN
      RAISE EXCEPTION 'RAW_BATCH_LEASE_OWNER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ingestion_record_active_lease_trigger
  BEFORE INSERT ON raw.ingestion_record
  FOR EACH ROW EXECUTE FUNCTION raw.enforce_active_batch_lease();

CREATE TRIGGER ingestion_batch_manifest_active_lease_trigger
  BEFORE INSERT ON raw.ingestion_batch_manifest
  FOR EACH ROW EXECUTE FUNCTION raw.enforce_active_batch_lease();

REVOKE ALL ON FUNCTION raw.enforce_active_batch_lease() FROM PUBLIC;
