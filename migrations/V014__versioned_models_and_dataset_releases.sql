CREATE TABLE warehouse.dataset (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active_model_version INTEGER NOT NULL DEFAULT 0,
  active_release_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id, code)
);
CREATE TABLE warehouse.model_version (
  dataset_id BIGINT NOT NULL REFERENCES warehouse.dataset(id),
  version INTEGER NOT NULL CHECK(version > 0),
  runtime_ref TEXT NOT NULL,
  git_revision CHAR(40) NOT NULL CHECK(git_revision ~ '^[0-9a-f]{40}$'),
  bundle_sha256 CHAR(64) NOT NULL CHECK(bundle_sha256 ~ '^[0-9a-f]{64}$'),
  contract JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(dataset_id, version)
);
CREATE TABLE warehouse.model_build (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id BIGINT NOT NULL REFERENCES warehouse.dataset(id),
  model_version INTEGER NOT NULL,
  expected_release_id BIGINT,
  inputs JSONB NOT NULL,
  watermark JSONB NOT NULL,
  request_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','READY','REJECTED','FAILED','CANCELLED')),
  lease_token UUID,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  frozen_at TIMESTAMPTZ,
  schema_name TEXT UNIQUE,
  result JSONB,
  completion JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(dataset_id, model_version) REFERENCES warehouse.model_version(dataset_id, version),
  UNIQUE(dataset_id, request_key)
);
CREATE INDEX warehouse_build_queue_idx ON warehouse.model_build(state, id);
CREATE TABLE warehouse.dataset_release (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id BIGINT NOT NULL REFERENCES warehouse.dataset(id),
  build_id BIGINT NOT NULL UNIQUE REFERENCES warehouse.model_build(id),
  model_version INTEGER NOT NULL,
  previous_release_id BIGINT REFERENCES warehouse.dataset_release(id),
  published_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE warehouse.dataset ADD FOREIGN KEY(active_release_id) REFERENCES warehouse.dataset_release(id);
CREATE TABLE warehouse.dataset_policy (
  dataset_id BIGINT NOT NULL REFERENCES warehouse.dataset(id),
  identity_id TEXT NOT NULL REFERENCES warehouse.identity(id),
  columns_json JSONB NOT NULL,
  row_equals JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY(dataset_id, identity_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA warehouse FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON warehouse.dataset, warehouse.model_build, warehouse.dataset_policy TO bydw_control_api;
GRANT SELECT, INSERT ON warehouse.model_version, warehouse.dataset_release TO bydw_control_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA warehouse TO bydw_control_api;

CREATE ROLE bydw_model_builder NOLOGIN;
CREATE ROLE bydw_model_worker_login NOLOGIN IN ROLE bydw_model_builder;
CREATE ROLE bydw_dataset_owner NOLOGIN;
CREATE ROLE bydw_dataset_reader NOLOGIN;
GRANT bydw_dataset_reader TO bydw_control_api;
GRANT USAGE ON SCHEMA warehouse TO bydw_model_builder;

-- A model worker can only create a schema for its currently leased build.
-- Publication transfers ownership away from the execution role.
CREATE FUNCTION warehouse.allocate_build(p_build BIGINT, p_token UUID) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, warehouse AS $$
DECLARE b warehouse.model_build; v_schema TEXT;
BEGIN
  SELECT * INTO b FROM warehouse.model_build WHERE id = p_build FOR UPDATE;
  IF NOT FOUND OR b.state <> 'RUNNING' OR b.lease_token IS DISTINCT FROM p_token
    OR b.lease_expires_at <= clock_timestamp() OR b.cancel_requested OR b.frozen_at IS NOT NULL
  THEN RAISE EXCEPTION 'MODEL_LEASE_LOST'; END IF;
  v_schema := 'build_' || b.id;
  IF b.schema_name IS NOT NULL THEN RETURN b.schema_name; END IF;
  EXECUTE format('CREATE SCHEMA %I AUTHORIZATION bydw_model_builder', v_schema);
  UPDATE warehouse.model_build SET schema_name = v_schema WHERE id = p_build;
  RETURN v_schema;
END $$;
CREATE FUNCTION warehouse.freeze_build(p_build BIGINT, p_token UUID) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, warehouse AS $$
DECLARE b warehouse.model_build; r RECORD;
BEGIN
  SELECT * INTO b FROM warehouse.model_build WHERE id = p_build FOR UPDATE;
  IF NOT FOUND OR b.state <> 'RUNNING' OR b.lease_token IS DISTINCT FROM p_token
    OR b.lease_expires_at <= clock_timestamp() OR b.cancel_requested OR b.schema_name IS NULL
  THEN RAISE EXCEPTION 'MODEL_LEASE_LOST'; END IF;
  IF b.frozen_at IS NOT NULL THEN RETURN b.schema_name; END IF;
  -- Reject writable helpers whose ownership would outlive the build.
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = b.schema_name)
  THEN RAISE EXCEPTION 'MODEL_FUNCTION_NOT_ALLOWED'; END IF;
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = b.schema_name AND c.relkind IN ('r','v','m','S')
  LOOP
    IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO bydw_dataset_owner', b.schema_name, r.relname);
    ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW %I.%I OWNER TO bydw_dataset_owner', b.schema_name, r.relname);
    ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO bydw_dataset_owner', b.schema_name, r.relname);
    ELSE EXECUTE format('ALTER TABLE %I.%I OWNER TO bydw_dataset_owner', b.schema_name, r.relname); END IF;
  END LOOP;
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC, bydw_model_builder', b.schema_name);
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, bydw_model_builder', b.schema_name);
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO bydw_dataset_reader', b.schema_name);
  EXECUTE format('ALTER SCHEMA %I OWNER TO bydw_dataset_owner', b.schema_name);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, bydw_model_builder', b.schema_name);
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO bydw_dataset_reader', b.schema_name);
  UPDATE warehouse.model_build SET frozen_at = clock_timestamp() WHERE id = p_build;
  RETURN b.schema_name;
END $$;
REVOKE ALL ON FUNCTION warehouse.allocate_build(BIGINT,UUID), warehouse.freeze_build(BIGINT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION warehouse.allocate_build(BIGINT,UUID), warehouse.freeze_build(BIGINT,UUID) TO bydw_model_builder;
