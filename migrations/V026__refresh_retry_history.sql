-- Keep every build and frozen input association when an operator retries a failed run.
ALTER TABLE warehouse.refresh_build DROP CONSTRAINT refresh_build_pkey;
ALTER TABLE warehouse.refresh_build ADD PRIMARY KEY(window_id,input_hash,build_id);
ALTER TABLE warehouse.refresh_build ADD COLUMN retry_of BIGINT REFERENCES warehouse.model_build(id);
CREATE UNIQUE INDEX refresh_retry_once_idx ON warehouse.refresh_build(retry_of) WHERE retry_of IS NOT NULL;
