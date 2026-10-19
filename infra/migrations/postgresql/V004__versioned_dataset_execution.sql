CREATE TABLE dataset (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id bigint NOT NULL REFERENCES source_connection(id),
    object_id bigint NOT NULL REFERENCES source_object(id),
    name varchar(120) NOT NULL UNIQUE,
    description varchar(2000) NOT NULL DEFAULT '',
    owner_label varchar(120) NOT NULL,
    tags jsonb NOT NULL DEFAULT '[]',
    definition jsonb NOT NULL,
    target_name varchar(64) NOT NULL UNIQUE,
    published_version integer NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'draft',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE governance_rule (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category varchar(16) NOT NULL CHECK(category IN ('quality','masking')),
    body jsonb NOT NULL,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dataset_version (
    dataset_id bigint NOT NULL REFERENCES dataset(id),
    version integer NOT NULL,
    body jsonb NOT NULL,
    source_table varchar(64) NOT NULL,
    source_columns jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(dataset_id,version)
);
CREATE TABLE dataset_run (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dataset_id bigint NOT NULL,
    dataset_version integer NOT NULL,
    retry_of bigint REFERENCES dataset_run(id),
    requested_by bigint NOT NULL REFERENCES account(id),
    idempotency_key varchar(100) NOT NULL,
    request_hash char(64) NOT NULL,
    allow_empty boolean NOT NULL DEFAULT false,
    status varchar(16) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','validating','publishing','succeeded','failed','blocked','canceled')),
    cancel_requested boolean NOT NULL DEFAULT false,
    lease_token varchar(80),
    lease_until timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(),
    execution_started_at timestamptz,
    finished_at timestamptz,
    row_count bigint NOT NULL DEFAULT 0 CHECK(row_count >= 0),
    error_code varchar(80) NOT NULL DEFAULT '',
    logs jsonb NOT NULL DEFAULT '[]',
    quality_results jsonb NOT NULL DEFAULT '[]',
    raw_object_key varchar(200),
    FOREIGN KEY(dataset_id,dataset_version) REFERENCES dataset_version(dataset_id,version),
    UNIQUE(requested_by,dataset_id,idempotency_key)
);
CREATE UNIQUE INDEX one_active_run_per_dataset ON dataset_run(dataset_id) WHERE status IN ('queued','running','validating','publishing');
CREATE TABLE warehouse_snapshot (
    run_id bigint PRIMARY KEY REFERENCES dataset_run(id),
    dataset_id bigint NOT NULL REFERENCES dataset(id),
    physical_table varchar(100) NOT NULL UNIQUE,
    fields jsonb NOT NULL,
    row_count bigint NOT NULL CHECK(row_count >= 0),
    published_at timestamptz NOT NULL DEFAULT now(),
    replaced_at timestamptz,
    deleted_at timestamptz
);
CREATE TABLE warehouse_target (
    dataset_id bigint PRIMARY KEY REFERENCES dataset(id),
    name varchar(64) NOT NULL UNIQUE,
    current_run_id bigint NOT NULL REFERENCES warehouse_snapshot(run_id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warehouse_query (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES account(id),
    dataset_id bigint NOT NULL REFERENCES dataset(id),
    run_id bigint NOT NULL REFERENCES warehouse_snapshot(run_id),
    body jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warehouse_export (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    query_id bigint NOT NULL REFERENCES warehouse_query(id),
    user_id bigint NOT NULL REFERENCES account(id),
    body jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dataset_publication (user_id bigint NOT NULL REFERENCES account(id),dataset_id bigint NOT NULL REFERENCES dataset(id),idempotency_key varchar(100) NOT NULL,request_hash char(64) NOT NULL,body jsonb NOT NULL,PRIMARY KEY(user_id,dataset_id,idempotency_key));
