-- Synthetic PostgreSQL source only. Never execute against the platform metadata database.
CREATE SCHEMA IF NOT EXISTS "Retail";
CREATE TABLE IF NOT EXISTS "Retail"."Orders" (
    id bigint PRIMARY KEY,
    amount numeric(20,4) NOT NULL,
    active boolean NOT NULL,
    label varchar(64),
    happened_at timestamptz NOT NULL,
    local_at timestamp(6) NOT NULL,
    event_date date NOT NULL,
    document jsonb NOT NULL,
    entity_uuid uuid NOT NULL
);
COMMENT ON COLUMN "Retail"."Orders".amount IS 'Synthetic exact decimal';
CREATE TABLE IF NOT EXISTS "Retail".no_key (id bigint, amount numeric(20,4));
CREATE TABLE IF NOT EXISTS "Retail".orders (id bigint);
CREATE TABLE IF NOT EXISTS public."Orders" (id bigint);
TRUNCATE "Retail"."Orders", "Retail".no_key, "Retail".orders, public."Orders";
INSERT INTO "Retail"."Orders"
SELECT 9007199254740993::bigint+g,12345.6700,g%2=0,
       CASE WHEN g=1 THEN NULL ELSE 'before' END,
       '2026-11-02 09:30:00+08'::timestamptz,'2026-11-02 09:30:00.123456'::timestamp,
       '2026-11-02'::date,'{"kind":"synthetic"}'::jsonb,md5(g::text)::uuid
FROM generate_series(1,1201) g;
INSERT INTO "Retail".no_key SELECT id,amount FROM "Retail"."Orders";
INSERT INTO "Retail".orders VALUES(-1);
INSERT INTO public."Orders" VALUES(-2);
