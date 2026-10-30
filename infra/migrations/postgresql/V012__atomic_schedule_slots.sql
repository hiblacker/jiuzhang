ALTER TABLE dataset_schedule ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE dataset_run ADD COLUMN scheduled_at timestamptz;
ALTER TABLE dataset_run ADD CONSTRAINT scheduled_time_trigger
    CHECK (scheduled_at IS NULL OR trigger = 'schedule');
CREATE UNIQUE INDEX one_scheduled_run_per_slot ON dataset_run(dataset_id, scheduled_at)
    WHERE trigger = 'schedule' AND scheduled_at IS NOT NULL;

CREATE TABLE dataset_schedule_slot (
    dataset_id bigint NOT NULL REFERENCES dataset_schedule(dataset_id),
    scheduled_at timestamptz NOT NULL,
    revision bigint NOT NULL,
    dataset_version integer NOT NULL,
    requested_by bigint NOT NULL REFERENCES account(id),
    schedule_snapshot jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    state varchar(16) NOT NULL CHECK (state IN ('pending', 'enqueued', 'skipped')),
    reason varchar(80) NOT NULL DEFAULT '',
    run_id bigint UNIQUE REFERENCES dataset_run(id),
    advanced_to timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dataset_id, scheduled_at),
    FOREIGN KEY (dataset_id, dataset_version) REFERENCES dataset_version(dataset_id, version),
    CHECK (expires_at > scheduled_at),
    CHECK ((state = 'enqueued') = (run_id IS NOT NULL)),
    CHECK (state <> 'skipped' OR reason <> '')
);
CREATE UNIQUE INDEX one_pending_slot_per_dataset ON dataset_schedule_slot(dataset_id) WHERE state = 'pending';
