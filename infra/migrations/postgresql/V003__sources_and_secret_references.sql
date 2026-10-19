CREATE TABLE source_connection (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(120) NOT NULL UNIQUE,
    description varchar(2000) NOT NULL DEFAULT '',
    owner_label varchar(120) NOT NULL,
    created_by bigint NOT NULL REFERENCES account(id),
    tags jsonb NOT NULL DEFAULT '[]',
    settings jsonb NOT NULL,
    connection_username varchar(120) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'offline' CHECK (status IN ('connected','warning','offline')),
    object_count integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE source_secret (
    source_id bigint PRIMARY KEY REFERENCES source_connection(id) ON DELETE CASCADE,
    ciphertext text NOT NULL
);
CREATE TABLE source_object (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id bigint NOT NULL REFERENCES source_connection(id) ON DELETE CASCADE,
    name varchar(64) NOT NULL,
    schema_contract jsonb NOT NULL,
    discovered_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(source_id,name)
);
