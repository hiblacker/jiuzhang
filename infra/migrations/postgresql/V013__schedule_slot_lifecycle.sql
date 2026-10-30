ALTER TABLE dataset_schedule_slot
    DROP CONSTRAINT dataset_schedule_slot_dataset_id_fkey,
    DROP CONSTRAINT dataset_schedule_slot_dataset_id_dataset_version_fkey;
ALTER TABLE dataset_schedule_slot
    ADD CONSTRAINT dataset_schedule_slot_dataset_id_fkey
        FOREIGN KEY (dataset_id) REFERENCES dataset_schedule(dataset_id) ON DELETE CASCADE,
    ADD CONSTRAINT dataset_schedule_slot_dataset_id_dataset_version_fkey
        FOREIGN KEY (dataset_id, dataset_version) REFERENCES dataset_version(dataset_id, version) ON DELETE CASCADE;

CREATE INDEX dataset_schedule_slot_retention_idx ON dataset_schedule_slot(state, advanced_to);
