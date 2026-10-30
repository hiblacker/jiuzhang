CREATE TABLE source_file_cleanup (
    object_key varchar(100) PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);
