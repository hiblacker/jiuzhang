CREATE TABLE account (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username varchar(80) NOT NULL UNIQUE,
    display_name varchar(120) NOT NULL,
    password_hash varchar(512) NOT NULL,
    role varchar(16) NOT NULL CHECK (role IN ('admin', 'developer', 'viewer')),
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_session (
    token_hash char(64) PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES account(id),
    csrf_hash char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX account_session_user_idx ON account_session(user_id);
CREATE TABLE audit_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id bigint REFERENCES account(id),
    action varchar(80) NOT NULL,
    resource_type varchar(40) NOT NULL,
    resource_id varchar(80) NOT NULL,
    request_id varchar(80) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE login_throttle (
    subject_hash char(64) PRIMARY KEY,
    failures integer NOT NULL DEFAULT 0,
    blocked_until timestamptz NOT NULL DEFAULT now()
);
