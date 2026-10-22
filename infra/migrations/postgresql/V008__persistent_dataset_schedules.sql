CREATE TABLE dataset_schedule (
    dataset_id bigint PRIMARY KEY REFERENCES dataset(id) ON DELETE CASCADE,
    owner_id bigint REFERENCES account(id),
    enabled boolean NOT NULL DEFAULT true,
    name varchar(120) NOT NULL,
    description varchar(2000) NOT NULL DEFAULT '',
    owner_label varchar(120) NOT NULL DEFAULT '',
    tags jsonb NOT NULL DEFAULT '[]',
    schedule jsonb NOT NULL,
    next_run_at timestamptz,
    last_success_run_id bigint,
    last_success_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dataset_run ADD COLUMN task_id bigint;
ALTER TABLE dataset_run ADD COLUMN trigger varchar(16) NOT NULL DEFAULT 'manual'
    CHECK (trigger IN ('manual','schedule','retry','backfill'));
ALTER TABLE dataset_run ADD COLUMN business_date date;
ALTER TABLE dataset_run ADD CONSTRAINT dataset_run_task_fk
    FOREIGN KEY (task_id) REFERENCES dataset_schedule(dataset_id);
ALTER TABLE dataset_schedule ADD CONSTRAINT dataset_schedule_last_run_fk
    FOREIGN KEY (last_success_run_id) REFERENCES dataset_run(id);

INSERT INTO dataset_schedule(dataset_id, owner_id, name, description, owner_label, tags, schedule)
SELECT d.id,
       (SELECT min(id) FROM account),
       d.name,
       d.description,
       d.owner_label,
       d.tags,
       COALESCE(d.definition->'schedule',
         '{"mode":"manual","cron":"0 9 * * *","intervalMinutes":60,"timezone":"Asia/Shanghai","retries":0,"timeoutSeconds":600,"concurrency":1,"dependencies":[]}'::jsonb)
FROM dataset d
WHERE d.published_version > 0
ON CONFLICT (dataset_id) DO NOTHING;

CREATE INDEX dataset_schedule_due_idx
    ON dataset_schedule(enabled, next_run_at)
    WHERE enabled;
CREATE INDEX dataset_run_task_idx ON dataset_run(task_id, id DESC);
