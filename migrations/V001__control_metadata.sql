CREATE TABLE control.source_connection (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  source_type VARCHAR(40) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_ref VARCHAR(200) NOT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control.ingestion_job (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES control.source_connection(id),
  object_name VARCHAR(100) NOT NULL,
  strategy VARCHAR(30) NOT NULL CHECK (strategy IN ('FULL','UPDATED_AT_KEYSET','RECONCILIATION')),
  cursor_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  state VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','DISABLED')),
  UNIQUE(source_id, object_name)
);

CREATE TABLE control.ingestion_batch (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES control.ingestion_job(id),
  cursor_from JSONB,
  cursor_to JSONB,
  state VARCHAR(20) NOT NULL CHECK (state IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  row_count BIGINT NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  checksum VARCHAR(128),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE control.dataset_version (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_code VARCHAR(100) NOT NULL,
  version VARCHAR(30) NOT NULL,
  grain TEXT NOT NULL,
  schema JSONB NOT NULL,
  policy_ref VARCHAR(200) NOT NULL,
  state VARCHAR(20) NOT NULL CHECK (state IN ('DRAFT','REVIEW','RELEASED','RETIRED')),
  UNIQUE(dataset_code, version)
);

CREATE TABLE control.dataset_release (
  id UUID PRIMARY KEY,
  dataset_version_id BIGINT NOT NULL REFERENCES control.dataset_version(id),
  manifest JSONB NOT NULL,
  watermark JSONB NOT NULL,
  state VARCHAR(20) NOT NULL CHECK (state IN ('BUILDING','VALIDATING','READY','PUBLISHED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control.dataset_active_release (
  dataset_code VARCHAR(100) PRIMARY KEY,
  release_id UUID NOT NULL REFERENCES control.dataset_release(id),
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control.audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  principal VARCHAR(200) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(300) NOT NULL,
  result VARCHAR(30) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
