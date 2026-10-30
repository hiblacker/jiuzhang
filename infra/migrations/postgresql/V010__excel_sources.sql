CREATE TABLE source_file (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id bigint NOT NULL REFERENCES account(id),
    file_name varchar(255) NOT NULL,
    object_key varchar(100) NOT NULL UNIQUE,
    byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE source_connection ADD COLUMN source_type varchar(16) NOT NULL DEFAULT 'MySQL'
    CHECK (source_type IN ('MySQL', 'Excel'));
ALTER TABLE source_connection ADD COLUMN file_id bigint REFERENCES source_file(id);
ALTER TABLE source_connection ADD CONSTRAINT source_file_type
    CHECK ((source_type = 'Excel') = (file_id IS NOT NULL));
ALTER TABLE dataset_version ADD COLUMN source_file_id bigint REFERENCES source_file(id);
CREATE INDEX source_file_created_idx ON source_file(created_at);
