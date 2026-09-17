CREATE TABLE warehouse.business_system (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  business_owner TEXT NOT NULL,
  technical_owner TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  managing_project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  lifecycle TEXT NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle IN ('DRAFT','ONBOARDING','ACTIVE','PAUSED','RETIRED')),
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.system_project (
  system_id BIGINT NOT NULL REFERENCES warehouse.business_system(id),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  PRIMARY KEY(system_id,project_id)
);
CREATE TABLE warehouse.system_instance (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_id BIGINT NOT NULL REFERENCES warehouse.business_system(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  environment TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  lifecycle TEXT NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle IN ('DRAFT','ONBOARDING','ACTIVE','PAUSED','RETIRED')),
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(system_id,code)
);
CREATE TABLE warehouse.instance_project (
  instance_id BIGINT NOT NULL REFERENCES warehouse.system_instance(id),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  PRIMARY KEY(instance_id,project_id)
);
CREATE INDEX system_project_lookup_idx ON warehouse.system_project(project_id,system_id);
CREATE INDEX instance_project_lookup_idx ON warehouse.instance_project(project_id,instance_id);
REVOKE ALL ON warehouse.business_system,warehouse.system_project,warehouse.system_instance,warehouse.instance_project FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON warehouse.business_system,warehouse.system_instance TO bydw_control_api;
GRANT SELECT,INSERT ON warehouse.system_project,warehouse.instance_project TO bydw_control_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA warehouse TO bydw_control_api;
