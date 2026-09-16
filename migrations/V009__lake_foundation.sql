CREATE SCHEMA IF NOT EXISTS lake;

REVOKE ALL ON SCHEMA lake FROM PUBLIC;

CREATE TABLE lake.inventory (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  plan_version BIGINT NOT NULL CHECK (plan_version >= 1),
  observed_at TIMESTAMPTZ NOT NULL,
  source_scope JSONB NOT NULL,
  object_count BIGINT NOT NULL CHECK (object_count >= 0),
  schema_sha256 CHAR(64) NOT NULL CHECK (schema_sha256 ~ '^[0-9a-f]{64}$'),
  state VARCHAR(20) NOT NULL CHECK (state IN ('DISCOVERED','ACTIVE','SUPERSEDED','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, plan_version)
);

CREATE TABLE lake.source_object (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_id BIGINT NOT NULL REFERENCES lake.inventory(id),
  object_name VARCHAR(256) NOT NULL,
  object_type VARCHAR(30) NOT NULL CHECK (object_type IN ('TABLE','VIEW','FILE_SET','API_RESOURCE')),
  schema_json JSONB NOT NULL,
  primary_key_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  strategy VARCHAR(30) NOT NULL CHECK (strategy IN ('FULL_SNAPSHOT','UPDATED_AT_KEYSET','CDC','FILE_VERSION','API_CURSOR')),
  state VARCHAR(20) NOT NULL CHECK (state IN ('READY','BLOCKED','DISABLED')),
  UNIQUE (inventory_id, object_name)
);

CREATE TABLE lake.system_run (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  plan_version BIGINT NOT NULL,
  run_key VARCHAR(160) NOT NULL,
  scheduled_window_start TIMESTAMPTZ,
  scheduled_window_end TIMESTAMPTZ,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('FULL','DAILY','BACKFILL','FILE_SCAN','API_PULL')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  state VARCHAR(20) NOT NULL CHECK (state IN ('PLANNED','RUNNING','COMPLETE','INCOMPLETE','FAILED','CANCELLED')),
  consistency VARCHAR(40),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code VARCHAR(120),
  UNIQUE (source_id, plan_version, run_key, attempt, revision)
);

CREATE TABLE lake.object_run (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_run_id BIGINT NOT NULL REFERENCES lake.system_run(id),
  source_object_id BIGINT NOT NULL REFERENCES lake.source_object(id),
  state VARCHAR(20) NOT NULL CHECK (state IN ('PENDING','WAITING_READY','READING','RAW_COMMITTED','PARSED','FAILED')),
  row_count BIGINT NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  byte_count BIGINT NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  source_started_at TIMESTAMPTZ,
  source_finished_at TIMESTAMPTZ,
  raw_path TEXT,
  raw_sha256 CHAR(64) CHECK (raw_sha256 IS NULL OR raw_sha256 ~ '^[0-9a-f]{64}$'),
  schema_sha256 CHAR(64) CHECK (schema_sha256 IS NULL OR schema_sha256 ~ '^[0-9a-f]{64}$'),
  error_code VARCHAR(120),
  UNIQUE (system_run_id, source_object_id)
);

CREATE TABLE lake.delivery_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  source_object_id BIGINT,
  scheduled_window_start TIMESTAMPTZ NOT NULL,
  scheduled_window_end TIMESTAMPTZ NOT NULL,
  delivery_kind VARCHAR(20) NOT NULL CHECK (delivery_kind IN ('DATABASE','FILE','API')),
  expected_state VARCHAR(30) NOT NULL CHECK (expected_state IN ('EXPECTED','NOT_EXPECTED','OPTIONAL')),
  observed_state VARCHAR(30) NOT NULL CHECK (observed_state IN ('NOT_OBSERVED','WAITING_READY','RECEIVED','EMPTY_CONFIRMED','MISSING','OVERDUE','DUPLICATE','LATE','REVISED','FAILED')),
  received_at TIMESTAMPTZ,
  actual_data_at TIMESTAMPTZ,
  run_id BIGINT REFERENCES lake.system_run(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE lake.raw_object (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_run_id BIGINT NOT NULL REFERENCES lake.object_run(id),
  object_version VARCHAR(160) NOT NULL,
  storage_path TEXT NOT NULL,
  format VARCHAR(30) NOT NULL CHECK (format IN ('JSONL','CSV','XLSX','JSON','PARQUET','API_RESPONSE')),
  byte_count BIGINT NOT NULL CHECK (byte_count >= 0),
  row_count BIGINT NOT NULL CHECK (row_count >= 0),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state VARCHAR(20) NOT NULL CHECK (state IN ('STAGED','COMMITTED','QUARANTINED','EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (object_run_id, object_version)
);

CREATE TABLE lake.active_run (
  source_id BIGINT PRIMARY KEY REFERENCES control.source_connection(id),
  run_id BIGINT NOT NULL REFERENCES lake.system_run(id),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX lake_system_run_window_idx ON lake.system_run(source_id, scheduled_window_start, state);
CREATE INDEX lake_object_run_state_idx ON lake.object_run(system_run_id, state);
CREATE INDEX lake_delivery_ledger_window_idx ON lake.delivery_ledger(source_id, scheduled_window_start, observed_state);
-- PostgreSQL treats NULLs as distinct in a normal UNIQUE constraint.  A
-- source-level delivery has no source_object_id, so coalesce it for replay
-- idempotency while preserving NULL as the logical value in the row.
CREATE UNIQUE INDEX lake_delivery_ledger_delivery_uk
  ON lake.delivery_ledger(source_id, COALESCE(source_object_id, 0),
                          scheduled_window_start, scheduled_window_end, delivery_kind);
CREATE INDEX lake_raw_object_hash_idx ON lake.raw_object(sha256);
