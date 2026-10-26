ALTER TABLE dataset_run ADD COLUMN schedule_snapshot jsonb;

UPDATE dataset_run r
SET schedule_snapshot = v.body->'definition'->'schedule'
FROM dataset_version v
WHERE v.dataset_id = r.dataset_id
  AND v.version = r.dataset_version
  AND r.schedule_snapshot IS NULL;

ALTER TABLE dataset_run
    ALTER COLUMN schedule_snapshot SET NOT NULL;
