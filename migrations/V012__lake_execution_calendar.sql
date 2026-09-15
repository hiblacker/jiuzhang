-- The calendar owns expected windows; adapters own execution. Definitions are
-- immutable versions, and every retry receives a new fenced lease.
CREATE TABLE lake.ingestion_plan (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL UNIQUE REFERENCES control.source_connection(id),
  active_version INTEGER NOT NULL CHECK (active_version > 0),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE','PAUSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE lake.plan_version (
  plan_id BIGINT NOT NULL REFERENCES lake.ingestion_plan(id),
  version INTEGER NOT NULL CHECK (version > 0),
  inventory_version BIGINT,
  kind TEXT NOT NULL CHECK (kind IN ('MYSQL_SNAPSHOT','FILE_SCAN','REST_PULL')),
  runtime_ref TEXT NOT NULL,
  contract JSONB NOT NULL,
  timezone TEXT NOT NULL,
  trigger_time TIME NOT NULL,
  start_date DATE NOT NULL,
  historical_read BOOLEAN NOT NULL,
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 8),
  timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds BETWEEN 30 AND 86400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(plan_id, version)
);
CREATE TABLE lake.execution_window (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id BIGINT NOT NULL,
  plan_version INTEGER NOT NULL,
  business_date DATE NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL CHECK(window_end > window_start),
  revision INTEGER NOT NULL CHECK(revision > 0),
  mode TEXT NOT NULL CHECK(mode IN ('SCHEDULED','MANUAL','BACKFILL')),
  state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETE','INCOMPLETE','FAILED','CANCELLED','MISSING')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(plan_id, plan_version) REFERENCES lake.plan_version(plan_id, version),
  UNIQUE(plan_id, plan_version, business_date, revision)
);
CREATE TABLE lake.execution_attempt (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  window_id BIGINT NOT NULL REFERENCES lake.execution_window(id),
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETE','INCOMPLETE','FAILED','CANCELLED')),
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  result JSONB,
  completion JSONB,
  not_before TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  system_run_id BIGINT REFERENCES lake.system_run(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(window_id, attempt)
);
CREATE INDEX lake_execution_queue_idx ON lake.execution_attempt(state, created_at);
CREATE INDEX lake_execution_lease_idx ON lake.execution_attempt(lease_expires_at) WHERE state = 'RUNNING';
REVOKE ALL ON lake.ingestion_plan, lake.plan_version, lake.execution_window, lake.execution_attempt FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON lake.ingestion_plan, lake.execution_window, lake.execution_attempt TO bydw_control_api;
GRANT SELECT, INSERT ON lake.plan_version TO bydw_control_api;
GRANT USAGE ON SEQUENCE lake.ingestion_plan_id_seq, lake.execution_window_id_seq, lake.execution_attempt_id_seq TO bydw_control_api;
