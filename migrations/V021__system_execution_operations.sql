ALTER TABLE warehouse.business_system ADD COLUMN max_parallel INTEGER NOT NULL DEFAULT 2 CHECK(max_parallel BETWEEN 1 AND 100);
ALTER TABLE warehouse.business_system ADD COLUMN last_claimed_at TIMESTAMPTZ;
ALTER TABLE lake.ingestion_plan ADD COLUMN last_claimed_at TIMESTAMPTZ;
ALTER TABLE lake.ingestion_plan ADD COLUMN dispatch_reason TEXT;
CREATE TABLE warehouse.resource_request_budget (
  resource_group TEXT PRIMARY KEY,
  next_allowed_at TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON warehouse.resource_request_budget FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON warehouse.resource_request_budget TO bydw_control_api;
CREATE TABLE warehouse.bulk_operation (
  id UUID PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('PAUSE','RESUME','RETIRE','RETRY','CANCEL')),
  targets JSONB NOT NULL,
  preview JSONB NOT NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PREVIEW' CHECK(state IN ('PREVIEW','COMPLETE')),
  results JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE warehouse.system_delivery_agreement (
  instance_id BIGINT NOT NULL REFERENCES warehouse.system_instance(id),
  project_id BIGINT NOT NULL REFERENCES warehouse.project(id),
  version INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  effective_from DATE NOT NULL,
  contract JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(instance_id,project_id,version)
);
CREATE TABLE warehouse.bulk_operation_item (
  operation_id UUID NOT NULL REFERENCES warehouse.bulk_operation(id),
  item_index INTEGER NOT NULL,
  result JSONB NOT NULL,
  PRIMARY KEY(operation_id,item_index)
);
CREATE TABLE warehouse.system_delivery_window (
  instance_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  business_date DATE NOT NULL,
  agreement_version INTEGER NOT NULL,
  expected JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(instance_id,project_id,business_date),
  FOREIGN KEY(instance_id,project_id,agreement_version) REFERENCES warehouse.system_delivery_agreement(instance_id,project_id,version)
);
REVOKE ALL ON warehouse.bulk_operation,warehouse.system_delivery_agreement,warehouse.system_delivery_window FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON warehouse.bulk_operation TO bydw_control_api;
GRANT SELECT,INSERT ON warehouse.system_delivery_agreement,warehouse.system_delivery_window TO bydw_control_api;
REVOKE ALL ON warehouse.bulk_operation_item FROM PUBLIC;
GRANT SELECT,INSERT ON warehouse.bulk_operation_item TO bydw_control_api;
