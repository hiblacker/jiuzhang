CREATE SCHEMA warehouse;
REVOKE ALL ON SCHEMA warehouse FROM PUBLIC;
CREATE TABLE warehouse.project (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.identity (
  id TEXT PRIMARY KEY,
  token_sha256 CHAR(64) NOT NULL UNIQUE CHECK(token_sha256 ~ '^[0-9a-f]{64}$'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.project_member (
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  identity_id TEXT NOT NULL REFERENCES warehouse.identity(id),
  role TEXT NOT NULL CHECK(role IN ('OWNER','ENGINEER','VIEWER')),
  PRIMARY KEY(project_id, identity_id)
);
CREATE TABLE warehouse.project_source (
  source_id BIGINT PRIMARY KEY REFERENCES control.source_connection(id),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id)
);
CREATE TABLE warehouse.external_asset (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execution_id BIGINT NOT NULL REFERENCES lake.execution_attempt(id),
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  object_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('FILE','API')),
  business_date DATE NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('RAW_COMMITTED','PARSED','FAILED')),
  contract_sha256 CHAR(64) NOT NULL,
  schema_json JSONB NOT NULL,
  evidence JSONB NOT NULL,
  row_count BIGINT NOT NULL CHECK(row_count >= 0),
  byte_count BIGINT NOT NULL CHECK(byte_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(execution_id, object_key)
);
CREATE INDEX warehouse_asset_source_idx ON warehouse.external_asset(source_id, id DESC);
REVOKE ALL ON ALL TABLES IN SCHEMA warehouse FROM PUBLIC;
GRANT USAGE ON SCHEMA warehouse TO bydw_control_api;
GRANT SELECT, INSERT, UPDATE ON warehouse.project, warehouse.identity, warehouse.project_member TO bydw_control_api;
GRANT SELECT, INSERT ON warehouse.project_source, warehouse.external_asset TO bydw_control_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA warehouse TO bydw_control_api;
