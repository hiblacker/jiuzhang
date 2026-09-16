CREATE TABLE warehouse.model_repository (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  worker_ids JSONB NOT NULL,
  project_paths JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.model_repository_project (
  repository_code TEXT NOT NULL REFERENCES warehouse.model_repository(code),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(repository_code,project_id)
);
CREATE TABLE warehouse.model_package_request (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  repository_code TEXT NOT NULL REFERENCES warehouse.model_repository(code),
  project_path TEXT NOT NULL,
  requested_revision TEXT NOT NULL,
  request_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','COMPLETE','FAILED')),
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  UNIQUE(project_id,request_key)
);
CREATE TABLE warehouse.model_package (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id BIGINT NOT NULL UNIQUE REFERENCES warehouse.model_package_request(id),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  repository_code TEXT NOT NULL REFERENCES warehouse.model_repository(code),
  project_path TEXT NOT NULL,
  git_revision CHAR(40) NOT NULL CHECK(git_revision ~ '^[0-9a-f]{40}$'),
  bundle_sha256 CHAR(64) NOT NULL CHECK(bundle_sha256 ~ '^[0-9a-f]{64}$'),
  contract JSONB NOT NULL,
  file_count INTEGER NOT NULL CHECK(file_count BETWEEN 1 AND 500),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE warehouse.model_version ADD COLUMN package_id BIGINT REFERENCES warehouse.model_package(id);
ALTER TABLE warehouse.model_build ADD COLUMN requested_by TEXT;
REVOKE ALL ON warehouse.model_repository,warehouse.model_repository_project,warehouse.model_package_request,warehouse.model_package FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON warehouse.model_repository,warehouse.model_repository_project,warehouse.model_package_request TO bydw_control_api;
GRANT SELECT,INSERT ON warehouse.model_package TO bydw_control_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA warehouse TO bydw_control_api;
-- Preserve the field types against which existing grants were defined.
ALTER TABLE warehouse.dataset_policy ADD COLUMN field_types JSONB;
UPDATE warehouse.dataset_policy p SET field_types=(
  SELECT jsonb_object_agg(f->>'name',f->>'type') FROM warehouse.dataset d
  JOIN warehouse.model_version v ON v.dataset_id=d.id AND v.version=d.active_model_version,
  LATERAL jsonb_array_elements(v.contract->'fields') f WHERE d.id=p.dataset_id
);
