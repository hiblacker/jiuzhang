CREATE TABLE warehouse.refresh_plan (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id BIGINT NOT NULL UNIQUE REFERENCES warehouse.dataset(id),
  active_version INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','PAUSED')),
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.refresh_plan_version (
  plan_id BIGINT NOT NULL REFERENCES warehouse.refresh_plan(id),
  version INTEGER NOT NULL,
  model_version INTEGER NOT NULL,
  config JSONB NOT NULL,
  operational_owner TEXT NOT NULL,
  service_identity TEXT NOT NULL REFERENCES warehouse.identity(id),
  approved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(plan_id,version)
);
CREATE TABLE warehouse.refresh_window (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id BIGINT NOT NULL,
  plan_version INTEGER NOT NULL,
  business_date DATE NOT NULL,
  state TEXT NOT NULL DEFAULT 'WAITING_INPUTS',
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_inputs JSONB,
  input_hash CHAR(64),
  build_id BIGINT REFERENCES warehouse.model_build(id),
  release_id BIGINT REFERENCES warehouse.dataset_release(id),
  checked_at TIMESTAMPTZ,
  FOREIGN KEY(plan_id,plan_version) REFERENCES warehouse.refresh_plan_version(plan_id,version),
  UNIQUE(plan_id,plan_version,business_date)
);
CREATE TABLE warehouse.refresh_build (
  window_id BIGINT NOT NULL REFERENCES warehouse.refresh_window(id),
  input_hash CHAR(64) NOT NULL,
  build_id BIGINT NOT NULL UNIQUE REFERENCES warehouse.model_build(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(window_id,input_hash)
);
CREATE INDEX refresh_window_state_idx ON warehouse.refresh_window(state,id);
REVOKE ALL ON warehouse.refresh_plan,warehouse.refresh_plan_version,warehouse.refresh_window,warehouse.refresh_build FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON warehouse.refresh_plan,warehouse.refresh_window TO bydw_control_api;
GRANT SELECT,INSERT ON warehouse.refresh_plan_version,warehouse.refresh_build TO bydw_control_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA warehouse TO bydw_control_api;
