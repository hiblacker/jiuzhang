ALTER TABLE account_session ADD COLUMN last_seen timestamptz NOT NULL DEFAULT now();
ALTER TABLE account_session ADD COLUMN csrf_token varchar(43) NOT NULL DEFAULT '';
ALTER TABLE login_throttle ADD COLUMN window_start timestamptz NOT NULL DEFAULT now();
