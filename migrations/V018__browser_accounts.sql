-- Additive browser credentials. Existing service tokens retain their own lifecycle.
CREATE TABLE warehouse.browser_account (
  identity_id TEXT PRIMARY KEY REFERENCES warehouse.identity(id),
  password_hash TEXT,
  display_name TEXT NOT NULL,
  platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  credential_epoch BIGINT NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.account_invitation (
  token_sha256 CHAR(64) PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES warehouse.browser_account(identity_id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX account_invitation_identity_idx ON warehouse.account_invitation(identity_id);
REVOKE ALL ON warehouse.browser_account, warehouse.account_invitation FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON warehouse.browser_account, warehouse.account_invitation TO bydw_control_api;
