CREATE SCHEMA raw;

REVOKE ALL ON SCHEMA raw FROM PUBLIC;

ALTER TABLE control.ingestion_batch
  ADD CONSTRAINT ingestion_batch_id_job_id_uk UNIQUE (id, job_id);

CREATE TABLE raw.ingestion_record (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id BIGINT NOT NULL,
  job_id BIGINT NOT NULL,
  source_record_key JSONB NOT NULL
    CHECK (jsonb_typeof(source_record_key) = 'object' AND source_record_key <> '{}'::jsonb),
  source_updated_at TIMESTAMPTZ,
  event_time TIMESTAMPTZ,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_checksum VARCHAR(64) NOT NULL CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ingestion_record_batch_job_fk
    FOREIGN KEY (batch_id, job_id) REFERENCES control.ingestion_batch(id, job_id),
  CONSTRAINT ingestion_record_batch_key_uk UNIQUE (batch_id, source_record_key)
);

CREATE INDEX ingestion_record_job_source_updated_idx
  ON raw.ingestion_record(job_id, source_updated_at, id);

CREATE TABLE raw.ingestion_batch_manifest (
  batch_id BIGINT PRIMARY KEY,
  job_id BIGINT NOT NULL,
  record_count BIGINT NOT NULL CHECK (record_count >= 0),
  checksum VARCHAR(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  writer_principal VARCHAR(200) NOT NULL
    CHECK (writer_principal ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  sealed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ingestion_batch_manifest_batch_job_fk
    FOREIGN KEY (batch_id, job_id) REFERENCES control.ingestion_batch(id, job_id)
);

REVOKE ALL ON ALL TABLES IN SCHEMA raw FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA raw FROM PUBLIC;

CREATE FUNCTION raw.ingest_record(
  p_batch_id BIGINT,
  p_source_record_key JSONB,
  p_payload JSONB,
  p_payload_checksum TEXT,
  p_source_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_event_time TIMESTAMPTZ DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job_id BIGINT;
  v_state VARCHAR(20);
  v_inserted BIGINT;
  v_existing_payload JSONB;
  v_existing_checksum VARCHAR(64);
BEGIN
  IF p_batch_id IS NULL OR p_batch_id < 1
     OR p_source_record_key IS NULL
     OR jsonb_typeof(p_source_record_key) <> 'object'
     OR p_source_record_key = '{}'::jsonb
     OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload_checksum IS NULL
     OR p_payload_checksum !~ '^[0-9A-Fa-f]{64}$' THEN
    RAISE EXCEPTION 'RAW_INVALID_RECORD' USING ERRCODE = '22023';
  END IF;

  SELECT job_id, state
    INTO v_job_id, v_state
    FROM control.ingestion_batch
    WHERE id = p_batch_id
    FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RAW_BATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_state <> 'RUNNING' THEN
    RAISE EXCEPTION 'RAW_BATCH_NOT_RUNNING' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM raw.ingestion_batch_manifest WHERE batch_id = p_batch_id) THEN
    RAISE EXCEPTION 'RAW_BATCH_ALREADY_SEALED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO raw.ingestion_record(
      batch_id, job_id, source_record_key, source_updated_at, event_time, payload, payload_checksum)
    VALUES (
      p_batch_id, v_job_id, p_source_record_key, p_source_updated_at, p_event_time,
      p_payload, lower(p_payload_checksum))
    ON CONFLICT (batch_id, source_record_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    RETURN 'INSERTED';
  END IF;

  SELECT payload, payload_checksum
    INTO v_existing_payload, v_existing_checksum
    FROM raw.ingestion_record
    WHERE batch_id = p_batch_id AND source_record_key = p_source_record_key;
  IF v_existing_payload = p_payload AND v_existing_checksum = lower(p_payload_checksum) THEN
    RETURN 'REPLAYED';
  END IF;
  RAISE EXCEPTION 'RAW_RECORD_CONFLICT' USING ERRCODE = '23505';
END;
$$;

CREATE FUNCTION raw.seal_ingestion_batch(
  p_batch_id BIGINT,
  p_checksum TEXT,
  p_writer_principal TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job_id BIGINT;
  v_state VARCHAR(20);
  v_record_count BIGINT;
  v_existing_count BIGINT;
  v_existing_checksum VARCHAR(64);
  v_existing_principal VARCHAR(200);
BEGIN
  IF p_batch_id IS NULL OR p_batch_id < 1
     OR p_checksum IS NULL OR p_checksum !~ '^[0-9A-Fa-f]{64}$'
     OR p_writer_principal IS NULL
     OR p_writer_principal !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' THEN
    RAISE EXCEPTION 'RAW_INVALID_MANIFEST' USING ERRCODE = '22023';
  END IF;

  SELECT job_id, state
    INTO v_job_id, v_state
    FROM control.ingestion_batch
    WHERE id = p_batch_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RAW_BATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_state <> 'RUNNING' THEN
    RAISE EXCEPTION 'RAW_BATCH_NOT_RUNNING' USING ERRCODE = 'P0001';
  END IF;

  SELECT record_count, checksum, writer_principal
    INTO v_existing_count, v_existing_checksum, v_existing_principal
    FROM raw.ingestion_batch_manifest
    WHERE batch_id = p_batch_id;
  IF FOUND THEN
    IF v_existing_checksum = lower(p_checksum)
       AND v_existing_principal = p_writer_principal THEN
      RETURN v_existing_count;
    END IF;
    RAISE EXCEPTION 'RAW_MANIFEST_CONFLICT' USING ERRCODE = '23505';
  END IF;

  SELECT count(*) INTO v_record_count
    FROM raw.ingestion_record
    WHERE batch_id = p_batch_id;

  INSERT INTO raw.ingestion_batch_manifest(
      batch_id, job_id, record_count, checksum, writer_principal)
    VALUES (p_batch_id, v_job_id, v_record_count, lower(p_checksum), p_writer_principal);
  RETURN v_record_count;
END;
$$;

REVOKE ALL ON FUNCTION raw.ingest_record(BIGINT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.seal_ingestion_batch(BIGINT, TEXT, TEXT)
  FROM PUBLIC;
