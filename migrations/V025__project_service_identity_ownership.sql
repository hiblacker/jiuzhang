CREATE TABLE warehouse.service_identity_owner (
  identity_id TEXT PRIMARY KEY REFERENCES warehouse.identity(id),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  created_by TEXT NOT NULL,
  token_revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON warehouse.service_identity_owner FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON warehouse.service_identity_owner TO bydw_control_api;
