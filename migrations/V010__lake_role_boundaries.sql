-- Lake metadata is separate from the legacy RAW function boundary. The API
-- can register administrator-approved inventories and read evidence; only the
-- worker can append/advance run and raw-object evidence.
REVOKE ALL ON SCHEMA lake FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA lake FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA lake FROM PUBLIC;

GRANT USAGE ON SCHEMA lake TO bydw_control_api, bydw_ingestion_worker;
GRANT SELECT, INSERT, UPDATE ON lake.inventory, lake.source_object TO bydw_control_api;
GRANT SELECT ON lake.inventory, lake.source_object, lake.system_run,
  lake.object_run, lake.delivery_ledger, lake.raw_object, lake.active_run
  TO bydw_control_api;
GRANT SELECT, INSERT, UPDATE ON lake.system_run, lake.object_run,
  lake.delivery_ledger, lake.raw_object TO bydw_ingestion_worker;
GRANT SELECT ON lake.inventory, lake.source_object, lake.active_run
  TO bydw_ingestion_worker;
GRANT USAGE ON SEQUENCE lake.system_run_id_seq, lake.object_run_id_seq,
  lake.delivery_ledger_id_seq, lake.raw_object_id_seq
  TO bydw_ingestion_worker;
GRANT USAGE ON SEQUENCE lake.inventory_id_seq, lake.source_object_id_seq
  TO bydw_control_api;
