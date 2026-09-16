-- Preserve the exact approved adapter contract alongside the immutable inventory.
-- Existing inventories continue to use their private bootstrap configuration.
ALTER TABLE lake.inventory ADD COLUMN runtime_json JSONB;
ALTER TABLE lake.inventory ADD COLUMN approved_execution_id BIGINT REFERENCES lake.execution_attempt(id);
CREATE UNIQUE INDEX lake_inventory_approved_execution_idx ON lake.inventory(approved_execution_id)
  WHERE approved_execution_id IS NOT NULL;
GRANT UPDATE(runtime_json, approved_execution_id) ON lake.inventory TO bydw_control_api;
