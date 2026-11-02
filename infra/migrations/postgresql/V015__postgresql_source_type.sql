ALTER TABLE source_connection DROP CONSTRAINT source_connection_source_type_check;
ALTER TABLE source_connection ADD CONSTRAINT source_connection_source_type_check
    CHECK (source_type IN ('MySQL', 'OceanBase', 'PostgreSQL', 'Excel'));
