-- SQL ingestion (P0-b): typed datasources, connection tests, registered SQL, previews.
--
-- Additive only: no V001-V026 file is touched, no existing column is dropped or
-- retyped. Existing MYSQL_SNAPSHOT resources keep working with kind unchanged and
-- gain datasource_type='MYSQL'.

-- 1) A resource becomes a typed datasource: non-secret connection config, credential
--    reference, per-source limits and the last connection-test outcome.
ALTER TABLE warehouse.ingest_resource
  ADD COLUMN datasource_type TEXT,
  ADD COLUMN config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN credential_ref TEXT,
  ADD COLUMN statement_timeout_ms INTEGER NOT NULL DEFAULT 3600000,
  ADD COLUMN allowed_schemas JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN allowed_tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN last_tested_at TIMESTAMPTZ,
  ADD COLUMN last_test_state TEXT,
  ADD COLUMN last_test_detail JSONB;

-- The dialect only applies to database-family resources; file and REST resources must
-- not carry one, so that the connector catalogue stays unambiguous.
ALTER TABLE warehouse.ingest_resource
  ADD CONSTRAINT ingest_resource_datasource_type_check CHECK (
    (kind = 'MYSQL_SNAPSHOT' AND datasource_type IN
      ('MYSQL','POSTGRESQL','ORACLE','SQLSERVER','CLICKHOUSE','DORIS','STARROCKS','TIDB'))
    OR (kind <> 'MYSQL_SNAPSHOT' AND datasource_type IS NULL)),
  ADD CONSTRAINT ingest_resource_statement_timeout_check
    CHECK (statement_timeout_ms BETWEEN 1000 AND 86400000),
  ADD CONSTRAINT ingest_resource_test_state_check
    CHECK (last_test_state IS NULL OR last_test_state IN ('PASSED','FAILED'));

UPDATE warehouse.ingest_resource SET datasource_type = 'MYSQL' WHERE kind = 'MYSQL_SNAPSHOT';

-- 2) Connection-test requests. The worker proves reachability AND that the account is
--    read-only: a successful SELECT is not enough evidence on its own.
CREATE TABLE warehouse.resource_test_request (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id BIGINT NOT NULL REFERENCES warehouse.ingest_resource(id),
  environment_code TEXT NOT NULL REFERENCES warehouse.execution_environment(code),
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','PASSED','FAILED')),
  server_version TEXT,
  server_timezone TEXT,
  readable_schema_count INTEGER,
  read_only_verified BOOLEAN,
  latency_ms INTEGER,
  error_code TEXT,
  requested_by TEXT NOT NULL,
  request_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  UNIQUE(resource_id, request_key)
);
CREATE INDEX resource_test_request_queue_idx ON warehouse.resource_test_request(state, id);

-- 3) Registered SQL: one draft per channel, immutable enabled versions afterwards.
CREATE TABLE warehouse.extraction_sql_draft (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  sql_text TEXT NOT NULL,
  sql_sha256 CHAR(64) NOT NULL,
  parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  masked_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  grain TEXT,
  unique_key JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(source_id)
);
CREATE TABLE warehouse.extraction_sql_version (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  version INTEGER NOT NULL CHECK(version > 0),
  sql_text TEXT NOT NULL,
  sql_sha256 CHAR(64) NOT NULL,
  parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  masked_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  grain TEXT NOT NULL,
  unique_key JSONB NOT NULL,
  extraction_mode TEXT NOT NULL CHECK(extraction_mode IN ('FULL','UPDATED_AT_KEYSET')),
  watermark_column TEXT,
  state TEXT NOT NULL DEFAULT 'VALIDATED' CHECK(state IN ('VALIDATED','ENABLED','RETIRED')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  enabled_by TEXT,
  enabled_at TIMESTAMPTZ,
  reason TEXT,
  UNIQUE(source_id, version),
  CHECK (extraction_mode <> 'UPDATED_AT_KEYSET' OR watermark_column IS NOT NULL)
);
-- At most one enabled SQL version per channel: enabling a new version retires the old one
-- in the same transaction, so a running batch can never follow an ambiguous definition.
CREATE UNIQUE INDEX extraction_sql_version_enabled_idx
  ON warehouse.extraction_sql_version(source_id) WHERE state = 'ENABLED';

-- 4) Previews: requested from the console, executed by the worker, always capped.
CREATE TABLE warehouse.sql_preview_request (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  sql_version_id BIGINT REFERENCES warehouse.extraction_sql_version(id),
  sql_text TEXT NOT NULL,
  sql_sha256 CHAR(64) NOT NULL,
  limit_rows INTEGER NOT NULL DEFAULT 1000 CHECK(limit_rows BETWEEN 1 AND 1000),
  environment_code TEXT NOT NULL REFERENCES warehouse.execution_environment(code),
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
  columns JSONB,
  rows JSONB,
  truncated BOOLEAN,
  row_count INTEGER,
  elapsed_ms INTEGER,
  error_code TEXT,
  requested_by TEXT NOT NULL,
  request_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  UNIQUE(source_id, request_key)
);
CREATE INDEX sql_preview_request_queue_idx ON warehouse.sql_preview_request(state, id);
CREATE TABLE warehouse.sql_preview_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  preview_request_id BIGINT NOT NULL REFERENCES warehouse.sql_preview_request(id),
  identity TEXT NOT NULL,
  source_id BIGINT NOT NULL,
  sql_sha256 CHAR(64) NOT NULL,
  returned_rows INTEGER NOT NULL,
  masked BOOLEAN NOT NULL DEFAULT FALSE,
  elapsed_ms INTEGER,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 5) Which SeaTunnel job executed which attempt: needed by the run centre and by retry.
CREATE TABLE warehouse.seatunnel_job (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execution_attempt_id BIGINT REFERENCES lake.execution_attempt(id),
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  sql_version_id BIGINT REFERENCES warehouse.extraction_sql_version(id),
  job_id TEXT NOT NULL UNIQUE,
  job_mode TEXT NOT NULL CHECK(job_mode IN ('FULL','UPDATED_AT_KEYSET')),
  state TEXT NOT NULL,
  error_code TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ
);

REVOKE ALL ON warehouse.resource_test_request, warehouse.extraction_sql_draft,
  warehouse.extraction_sql_version, warehouse.sql_preview_request,
  warehouse.sql_preview_audit, warehouse.seatunnel_job FROM PUBLIC;

-- Control API: owns definitions, requests tests/previews and writes the audit trail.
GRANT SELECT, INSERT, UPDATE ON warehouse.resource_test_request TO bydw_control_api;
GRANT SELECT, INSERT, UPDATE ON warehouse.extraction_sql_draft TO bydw_control_api;
GRANT SELECT, INSERT, UPDATE ON warehouse.extraction_sql_version TO bydw_control_api;
GRANT SELECT, INSERT, UPDATE ON warehouse.sql_preview_request TO bydw_control_api;
GRANT SELECT, INSERT ON warehouse.sql_preview_audit TO bydw_control_api;
GRANT SELECT, INSERT, UPDATE ON warehouse.seatunnel_job TO bydw_control_api;

-- Ingestion worker: claims tests/previews, records job ids, never edits definitions.
GRANT SELECT, UPDATE ON warehouse.resource_test_request TO bydw_ingestion_worker;
GRANT SELECT, UPDATE ON warehouse.sql_preview_request TO bydw_ingestion_worker;
GRANT SELECT ON warehouse.extraction_sql_version TO bydw_ingestion_worker;
GRANT SELECT, INSERT, UPDATE ON warehouse.seatunnel_job TO bydw_ingestion_worker;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA warehouse TO bydw_control_api, bydw_ingestion_worker;
