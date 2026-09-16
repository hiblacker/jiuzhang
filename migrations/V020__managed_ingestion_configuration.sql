CREATE TABLE warehouse.execution_environment (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  worker_ids JSONB NOT NULL CHECK(jsonb_typeof(worker_ids)='array'),
  max_parallel INTEGER NOT NULL CHECK(max_parallel BETWEEN 1 AND 100),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ
);
CREATE TABLE warehouse.ingest_resource (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  environment_code TEXT NOT NULL REFERENCES warehouse.execution_environment(code),
  kind TEXT NOT NULL CHECK(kind IN ('MYSQL_SNAPSHOT','FILE_SCAN','REST_PULL')),
  resource_group TEXT NOT NULL,
  max_parallel INTEGER NOT NULL CHECK(max_parallel BETWEEN 1 AND 100),
  max_bytes BIGINT NOT NULL CHECK(max_bytes>0),
  requests_per_second NUMERIC NOT NULL CHECK(requests_per_second BETWEEN 0.1 AND 100),
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE warehouse.resource_project (
  resource_id BIGINT NOT NULL REFERENCES warehouse.ingest_resource(id),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(resource_id,project_id)
);
CREATE TABLE warehouse.ingest_connection (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id BIGINT NOT NULL REFERENCES warehouse.system_instance(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  resource_id BIGINT NOT NULL REFERENCES warehouse.ingest_resource(id),
  managing_project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  active_version INTEGER NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle IN ('DRAFT','ONBOARDING','ACTIVE','PAUSED','RETIRED')),
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(instance_id,code)
);
CREATE TABLE warehouse.connection_version (
  connection_id BIGINT NOT NULL REFERENCES warehouse.ingest_connection(id),
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(connection_id,version)
);
CREATE TABLE warehouse.connection_project (
  connection_id BIGINT NOT NULL REFERENCES warehouse.ingest_connection(id),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(connection_id,project_id)
);
CREATE TABLE warehouse.ingest_channel (
  source_id BIGINT PRIMARY KEY REFERENCES control.source_connection(id),
  connection_id BIGINT NOT NULL REFERENCES warehouse.ingest_connection(id),
  name TEXT NOT NULL,
  active_version INTEGER NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle IN ('DRAFT','ONBOARDING','ACTIVE','PAUSED','RETIRED')),
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.channel_version (
  source_id BIGINT NOT NULL REFERENCES warehouse.ingest_channel(source_id),
  version INTEGER NOT NULL,
  connection_id BIGINT NOT NULL,
  connection_version INTEGER NOT NULL,
  config JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(source_id,version),
  FOREIGN KEY(connection_id,connection_version) REFERENCES warehouse.connection_version(connection_id,version)
);
CREATE TABLE warehouse.ingestion_probe (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL,
  channel_version INTEGER NOT NULL,
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  requested_by TEXT NOT NULL,
  request_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','COMPLETE','FAILED')),
  lease_token UUID,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  result JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  UNIQUE(source_id,request_key),
  FOREIGN KEY(source_id,channel_version) REFERENCES warehouse.channel_version(source_id,version)
);
CREATE INDEX ingestion_probe_queue_idx ON warehouse.ingestion_probe(state,id);
CREATE INDEX ingest_connection_instance_idx ON warehouse.ingest_connection(instance_id,id);
CREATE INDEX ingest_channel_connection_idx ON warehouse.ingest_channel(connection_id,source_id);
REVOKE ALL ON warehouse.execution_environment,warehouse.ingest_resource,warehouse.resource_project,
  warehouse.ingest_connection,warehouse.connection_version,warehouse.connection_project,
  warehouse.ingest_channel,warehouse.channel_version,warehouse.ingestion_probe FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON warehouse.execution_environment,warehouse.ingest_resource,warehouse.resource_project,
  warehouse.ingest_connection,warehouse.connection_project,warehouse.ingest_channel,warehouse.ingestion_probe TO bydw_control_api;
GRANT SELECT,INSERT ON warehouse.connection_version,warehouse.channel_version TO bydw_control_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA warehouse TO bydw_control_api;
