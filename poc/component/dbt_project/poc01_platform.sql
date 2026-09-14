-- POC-01 platform objects layered on the P0 warehouse core (V001-V003 stay untouched).
CREATE SCHEMA raw_landing;

-- Fixed synthetic domain configuration for POC-01. These records deliberately
-- live beside the mock source contract; they are not inferred from real DevOps
-- labels or current memberships.
INSERT INTO model.status_map(domain, source_status, canonical_status) VALUES
 ('devops', 'todo', 'open'),
 ('devops', 'done', 'done'),
 ('devops', 'reopened', 'open')
ON CONFLICT (domain, source_status) DO NOTHING;
INSERT INTO model.period(period_id, grain, start_at, end_at) VALUES
 ('2026-09-01', 'day', '2026-09-01 00:00:00+08', '2026-09-02 00:00:00+08'),
 ('2026-09-02', 'day', '2026-09-02 00:00:00+08', '2026-09-03 00:00:00+08'),
 ('2026-09-03', 'day', '2026-09-03 00:00:00+08', '2026-09-04 00:00:00+08'),
 ('2026-09', 'month', '2026-09-01 00:00:00+08', '2026-10-01 00:00:00+08')
ON CONFLICT (period_id) DO NOTHING;

CREATE TABLE raw_landing.story_batch (
 id varchar(64) NOT NULL, project_id varchar(64) NOT NULL, object_type varchar(32) NOT NULL,
 status_code varchar(32) NOT NULL, is_deleted smallint NOT NULL DEFAULT 0,
 -- JDBC transports MySQL DATETIME as text in this experiment. Conversion to
 -- Shanghai business time is explicit in the controlled load macro below.
 created_at text NOT NULL, updated_at text NOT NULL,
 actual_start text NULL, actual_end text NULL,
 batch_id text NOT NULL, landed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE raw_landing.status_batch (
 event_id varchar(64) NOT NULL, object_id varchar(64) NOT NULL, object_type varchar(32) NOT NULL,
 operation varchar(32) NOT NULL, status_code varchar(32) NOT NULL,
 started_at text NULL, event_time text NOT NULL, logged_at text NOT NULL,
 batch_id text NOT NULL, landed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouse.ingestion_state (
 state_key text PRIMARY KEY,
 cursor timestamptz NOT NULL,
 batch_id text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO warehouse.ingestion_state VALUES
 ('story','1970-01-01 00:00:00+08','none',now()),
 ('status_log','1970-01-01 00:00:00+08','none',now());

CREATE TABLE warehouse.run_log (
 platform_run_id text PRIMARY KEY,
 mode text NOT NULL,
 engine text NOT NULL,
 engine_run_id text,
 state text NOT NULL,
 release_id bigint,
 cutoff timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warehouse.stale_rejections (
 platform_run_id text NOT NULL,
 release_id bigint NOT NULL,
 expected bigint,
 reason text NOT NULL,
 rejected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(platform_run_id, release_id)
);
