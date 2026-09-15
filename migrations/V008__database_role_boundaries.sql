DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bydw_control_api') THEN
    CREATE ROLE bydw_control_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bydw_ingestion_worker') THEN
    CREATE ROLE bydw_ingestion_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bydw_control_api_login') THEN
    CREATE ROLE bydw_control_api_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bydw_ingestion_worker_login') THEN
    CREATE ROLE bydw_ingestion_worker_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END;
$$;

GRANT bydw_control_api TO bydw_control_api_login;
GRANT bydw_ingestion_worker TO bydw_ingestion_worker_login;

REVOKE ALL ON SCHEMA control FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA control FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA control FROM PUBLIC;

GRANT USAGE ON SCHEMA control TO bydw_control_api;
GRANT SELECT, INSERT ON control.source_connection TO bydw_control_api;
GRANT SELECT, INSERT, UPDATE ON control.ingestion_job TO bydw_control_api;
GRANT SELECT, INSERT, UPDATE ON control.ingestion_batch TO bydw_control_api;
GRANT INSERT ON control.audit_log TO bydw_control_api;
GRANT USAGE ON SEQUENCE control.source_connection_id_seq TO bydw_control_api;
GRANT USAGE ON SEQUENCE control.ingestion_job_id_seq TO bydw_control_api;
GRANT USAGE ON SEQUENCE control.ingestion_batch_id_seq TO bydw_control_api;
GRANT USAGE ON SEQUENCE control.audit_log_id_seq TO bydw_control_api;

REVOKE ALL ON SCHEMA raw FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA raw FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA raw FROM PUBLIC;
GRANT USAGE ON SCHEMA raw TO bydw_control_api, bydw_ingestion_worker;
GRANT SELECT ON raw.ingestion_batch_manifest TO bydw_control_api;
GRANT EXECUTE ON FUNCTION raw.ingest_record(
  BIGINT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO bydw_ingestion_worker;
GRANT EXECUTE ON FUNCTION raw.seal_ingestion_batch(BIGINT, TEXT, TEXT)
  TO bydw_ingestion_worker;

REVOKE ALL ON TABLE raw.ingestion_record
  FROM bydw_control_api, bydw_ingestion_worker,
       bydw_control_api_login, bydw_ingestion_worker_login;
REVOKE ALL ON TABLE control.source_connection, control.ingestion_job,
  control.ingestion_batch, control.audit_log
  FROM bydw_ingestion_worker, bydw_ingestion_worker_login;
REVOKE ALL ON FUNCTION raw.ingest_record(
  BIGINT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM bydw_control_api, bydw_control_api_login;
REVOKE ALL ON FUNCTION raw.seal_ingestion_batch(BIGINT, TEXT, TEXT)
  FROM bydw_control_api, bydw_control_api_login;

DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO bydw_control_api, bydw_ingestion_worker, '
    || 'bydw_control_api_login, bydw_ingestion_worker_login',
    current_database());
END;
$$;
