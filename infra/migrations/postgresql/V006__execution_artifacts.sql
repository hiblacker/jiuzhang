ALTER TABLE dataset_run ADD COLUMN staging_table varchar(100);
ALTER TABLE dataset_run ADD COLUMN artifacts_deleted_at timestamptz;
UPDATE dataset_run r SET staging_table=s.physical_table FROM warehouse_snapshot s WHERE s.run_id=r.id;
CREATE INDEX dataset_run_artifact_cleanup_idx ON dataset_run(status,finished_at) WHERE artifacts_deleted_at IS NULL;
