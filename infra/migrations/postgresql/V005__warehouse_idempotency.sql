CREATE TABLE warehouse_receipt (
 user_id bigint NOT NULL REFERENCES account(id),
 resource_type varchar(16) NOT NULL CHECK(resource_type IN ('queries','exports')),
 idempotency_key varchar(100) NOT NULL,
 request_hash char(64) NOT NULL,
 resource_id bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,resource_type,idempotency_key)
);
CREATE INDEX warehouse_query_owner ON warehouse_query(user_id,id DESC);
CREATE INDEX warehouse_export_owner ON warehouse_export(user_id,id DESC);
