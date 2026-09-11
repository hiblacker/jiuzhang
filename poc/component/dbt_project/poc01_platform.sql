-- POC-01 platform objects layered on the P0 warehouse core (V001-V003 stay untouched).
CREATE SCHEMA raw_landing;
CREATE TABLE raw_landing.story_batch (
 id varchar(64) NOT NULL, project_id varchar(64) NOT NULL, object_type varchar(32) NOT NULL,
 status_code varchar(32) NOT NULL, is_deleted smallint NOT NULL DEFAULT 0,
 created_at timestamp NOT NULL, updated_at timestamp NOT NULL,
 actual_start timestamp NULL, actual_end timestamp NULL,
 batch_id text NOT NULL, landed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE raw_landing.status_batch (
 event_id varchar(64) NOT NULL, object_id varchar(64) NOT NULL, object_type varchar(32) NOT NULL,
 operation varchar(32) NOT NULL, status_code varchar(32) NOT NULL,
 started_at timestamp NULL, event_time timestamp NOT NULL, logged_at timestamp NOT NULL,
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
