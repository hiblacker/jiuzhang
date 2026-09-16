CREATE TABLE warehouse.query_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL,
  dataset_id BIGINT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('QUERY','EXPORT')),
  release_id BIGINT,
  policy_revision BIGINT,
  request_id TEXT NOT NULL,
  fields JSONB NOT NULL,
  filter_sha256 CHAR(64) NOT NULL,
  returned_rows INTEGER,
  elapsed_ms BIGINT NOT NULL,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX query_audit_project_idx ON warehouse.query_audit(project_id,id DESC);
CREATE TABLE warehouse.operational_incident (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  logical_key TEXT NOT NULL,
  category TEXT NOT NULL,
  source_id BIGINT REFERENCES control.source_connection(id),
  dataset_id BIGINT REFERENCES warehouse.dataset(id),
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','ACKNOWLEDGED','RECOVERED')),
  owner_identity TEXT,
  acknowledged_by TEXT,
  acknowledgment_reason TEXT,
  acknowledged_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  recovery_reference TEXT,
  recovered_at TIMESTAMPTZ,
  revision BIGINT NOT NULL DEFAULT 1,
  UNIQUE(project_id,logical_key,category)
);
CREATE TABLE warehouse.incident_observation (
  incident_id BIGINT NOT NULL REFERENCES warehouse.operational_incident(id),
  observation_key TEXT NOT NULL,
  state TEXT NOT NULL,
  details JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(incident_id,observation_key)
);
CREATE TABLE warehouse.worker_observation (
  environment_code TEXT NOT NULL REFERENCES warehouse.execution_environment(code),
  worker_id TEXT NOT NULL,
  protocol INTEGER NOT NULL,
  metrics JSONB NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment_code,worker_id)
);
REVOKE ALL ON warehouse.query_audit,warehouse.operational_incident,warehouse.incident_observation,warehouse.worker_observation FROM PUBLIC;
GRANT SELECT,INSERT ON warehouse.query_audit,warehouse.incident_observation TO bydw_control_api;
GRANT SELECT,INSERT,UPDATE ON warehouse.operational_incident,warehouse.worker_observation TO bydw_control_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA warehouse TO bydw_control_api;
