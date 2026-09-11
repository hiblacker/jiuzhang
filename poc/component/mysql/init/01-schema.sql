-- Mock DevOps source schema. Synthetic data only; this server is a stand-in
-- for the real MySQL 8.1 source and carries no business content.
CREATE TABLE story (
 id varchar(64) NOT NULL PRIMARY KEY,
 project_id varchar(64) NOT NULL,
 object_type varchar(32) NOT NULL,
 status_code varchar(32) NOT NULL,
 is_deleted tinyint NOT NULL DEFAULT 0,
 created_at datetime NOT NULL,
 updated_at datetime NOT NULL,
 actual_start datetime NULL,
 actual_end datetime NULL,
 INDEX idx_story_updated (updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE status_log (
 event_id varchar(64) NOT NULL PRIMARY KEY,
 object_id varchar(64) NOT NULL,
 object_type varchar(32) NOT NULL,
 operation varchar(32) NOT NULL,
 status_code varchar(32) NOT NULL,
 started_at datetime NULL,
 event_time datetime NOT NULL,
 logged_at datetime NOT NULL,
 INDEX idx_log_logged (logged_at, event_id),
 INDEX idx_log_object (object_id, event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
