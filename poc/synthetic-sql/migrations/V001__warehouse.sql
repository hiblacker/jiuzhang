CREATE SCHEMA raw;
CREATE SCHEMA model;
CREATE SCHEMA warehouse;
CREATE SCHEMA reporting;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE raw.object (
 domain text NOT NULL, object_id text NOT NULL, created_at timestamptz NOT NULL,
 history_complete boolean NOT NULL,
 PRIMARY KEY(domain, object_id)
);
CREATE TABLE raw.team_history (
 domain text NOT NULL, object_id text NOT NULL, team text NOT NULL,
 valid_from timestamptz NOT NULL, valid_to timestamptz,
 PRIMARY KEY(domain,object_id,valid_from),
 FOREIGN KEY(domain,object_id) REFERENCES raw.object,
 CHECK(valid_to IS NULL OR valid_to > valid_from)
);
CREATE TABLE raw.event (
 domain text NOT NULL, event_id text NOT NULL, object_id text NOT NULL,
 event_at timestamptz NOT NULL, source_updated_at timestamptz NOT NULL,
 ingested_at timestamptz NOT NULL, batch_id text NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(domain,event_id),
 FOREIGN KEY(domain,object_id) REFERENCES raw.object,
 CHECK(jsonb_typeof(payload)='object')
);
-- Values enter via typed arguments; no generated SQL or arbitrary query surface.
CREATE FUNCTION raw.ingest(p_domain text, p_batch text, p_ingested timestamptz, p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE stored jsonb;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
   OR NOT (p_payload ?& ARRAY['id','object','at','updated','status'])
   OR jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'invalid event envelope';
 END IF;
 INSERT INTO raw.event VALUES(p_domain,p_payload->>'id',p_payload->>'object',
   (p_payload->>'at')::timestamptz,(p_payload->>'updated')::timestamptz,
   p_ingested,p_batch,p_payload) ON CONFLICT DO NOTHING;
 SELECT payload INTO stored FROM raw.event WHERE domain=p_domain AND event_id=p_payload->>'id';
 IF stored IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'conflicting event replay'; END IF;
END $$;
CREATE TABLE model.status_map (
 domain text NOT NULL, source_status text NOT NULL,
 canonical_status text NOT NULL CHECK(canonical_status IN ('open','done')),
 PRIMARY KEY(domain,source_status)
);
CREATE TABLE model.period (
 period_id text PRIMARY KEY, grain text NOT NULL CHECK(grain IN ('day','month')),
 start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 CHECK(end_at>start_at)
);
CREATE VIEW model.canonical_event AS
SELECT e.*,COALESCE(m.canonical_status,'unknown') AS state,
 (e.payload->>'started')::timestamptz AS started_at
FROM raw.event e LEFT JOIN model.status_map m
 ON m.domain=e.domain AND m.source_status=e.payload->>'status';

CREATE TABLE warehouse.release (
 release_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 input_cutoff timestamptz NOT NULL, rule_version text NOT NULL,
 state text NOT NULL DEFAULT 'BUILDING' CHECK(state IN ('BUILDING','READY','PUBLISHED')),
 finalized boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.active_release (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 release_id bigint REFERENCES warehouse.release
);
INSERT INTO warehouse.active_release VALUES(true,NULL);
CREATE TABLE warehouse.approval (
 release_id bigint PRIMARY KEY REFERENCES warehouse.release,
 approver text NOT NULL CHECK(length(approver)>0),
 reason text NOT NULL CHECK(length(reason)>0), approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE warehouse.event_detail (
 release_id bigint NOT NULL REFERENCES warehouse.release,
 domain text NOT NULL, event_id text NOT NULL, object_id text NOT NULL,
 team text NOT NULL, state text NOT NULL,
 event_at timestamptz NOT NULL, source_updated_at timestamptz NOT NULL,
 ingested_at timestamptz NOT NULL, batch_id text NOT NULL,
 duration_seconds numeric, duration_reason text,
 PRIMARY KEY(release_id,domain,event_id)
);
CREATE TABLE warehouse.snapshot_detail (
 release_id bigint NOT NULL REFERENCES warehouse.release,
 period_id text NOT NULL REFERENCES model.period,
 domain text NOT NULL, object_id text NOT NULL, team text NOT NULL,
 state text NOT NULL, complete boolean NOT NULL,
 PRIMARY KEY(release_id,period_id,domain,object_id)
);
CREATE TABLE warehouse.metric (
 release_id bigint NOT NULL REFERENCES warehouse.release,
 period_id text NOT NULL REFERENCES model.period, domain text NOT NULL, team text NOT NULL,
 completion_events bigint NOT NULL, completed_objects bigint NOT NULL,
 duration_sum_seconds numeric NOT NULL, valid_samples bigint NOT NULL,
 duration_mean_seconds numeric, duration_reason text,
 inventory bigint, inventory_reason text,
 PRIMARY KEY(release_id,period_id,domain,team)
);
CREATE TABLE warehouse.quality (
 release_id bigint NOT NULL REFERENCES warehouse.release,
 domain text NOT NULL, object_id text NOT NULL, issue text NOT NULL,
 event_id text,
 severity text NOT NULL CHECK(severity IN ('warning','error'))
);
CREATE FUNCTION warehouse.require_building() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid bigint;
BEGIN
 rid:=CASE WHEN TG_OP='DELETE' THEN OLD.release_id ELSE NEW.release_id END;
 IF TG_OP='UPDATE' AND OLD.release_id<>NEW.release_id THEN
   RAISE EXCEPTION 'release reassignment forbidden';
 END IF;
 IF (SELECT state FROM warehouse.release WHERE release_id=rid)<>'BUILDING' THEN
   RAISE EXCEPTION 'release contents immutable after build';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER immutable_metrics BEFORE INSERT OR UPDATE OR DELETE ON warehouse.metric
 FOR EACH ROW EXECUTE FUNCTION warehouse.require_building();
CREATE TRIGGER immutable_events BEFORE INSERT OR UPDATE OR DELETE ON warehouse.event_detail
 FOR EACH ROW EXECUTE FUNCTION warehouse.require_building();
CREATE TRIGGER immutable_snapshots BEFORE INSERT OR UPDATE OR DELETE ON warehouse.snapshot_detail
 FOR EACH ROW EXECUTE FUNCTION warehouse.require_building();
CREATE TRIGGER immutable_quality BEFORE INSERT OR UPDATE OR DELETE ON warehouse.quality
 FOR EACH ROW EXECUTE FUNCTION warehouse.require_building();

CREATE FUNCTION warehouse.publish(p_release bigint,p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE current_id bigint; candidate warehouse.release; previous warehouse.release;
BEGIN
 SELECT release_id INTO current_id FROM warehouse.active_release WHERE singleton FOR UPDATE;
 IF current_id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'publication compare-and-swap failed'; END IF;
 SELECT * INTO candidate FROM warehouse.release WHERE release_id=p_release FOR UPDATE;
 IF NOT FOUND OR candidate.state<>'READY' THEN RAISE EXCEPTION 'release not ready'; END IF;
 IF current_id IS NOT NULL THEN
  SELECT * INTO previous FROM warehouse.release WHERE release_id=current_id;
  IF candidate.release_id<=current_id OR candidate.input_cutoff<previous.input_cutoff THEN
   RAISE EXCEPTION 'stale release';
  END IF;
  IF previous.finalized AND NOT candidate.finalized THEN RAISE EXCEPTION 'cannot reopen finalized month'; END IF;
 END IF;
 IF candidate.finalized AND NOT EXISTS(SELECT 1 FROM warehouse.approval WHERE release_id=p_release) THEN
  RAISE EXCEPTION 'approval required';
 END IF;
 UPDATE warehouse.release SET state='PUBLISHED' WHERE release_id=p_release;
 UPDATE warehouse.active_release SET release_id=p_release WHERE singleton;
END $$;

-- Reporting identities are separate from ETL ownership. No LOGIN/password provisioned in P0.
-- Roles are cluster-global; repeat runs keep the same non-login role identities.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='p0_report_a') THEN CREATE ROLE p0_report_a NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='p0_report_b') THEN CREATE ROLE p0_report_b NOLOGIN; END IF;
END $$;
CREATE TABLE warehouse.report_scope (
 principal name NOT NULL, domain text NOT NULL, team text NOT NULL,
 PRIMARY KEY(principal,domain,team)
);
CREATE VIEW reporting.metrics WITH (security_barrier=true) AS
SELECT m.* FROM warehouse.metric m JOIN warehouse.release r USING(release_id)
WHERE r.state='PUBLISHED' AND EXISTS(SELECT 1 FROM warehouse.report_scope s
 WHERE s.principal=session_user AND s.domain=m.domain AND s.team=m.team);
CREATE VIEW reporting.events WITH (security_barrier=true) AS
SELECT e.* FROM warehouse.event_detail e JOIN warehouse.release r USING(release_id)
WHERE r.state='PUBLISHED' AND EXISTS(SELECT 1 FROM warehouse.report_scope s
 WHERE s.principal=session_user AND s.domain=e.domain AND s.team=e.team);
CREATE VIEW reporting.snapshots WITH (security_barrier=true) AS
SELECT d.* FROM warehouse.snapshot_detail d JOIN warehouse.release r USING(release_id)
WHERE r.state='PUBLISHED' AND EXISTS(SELECT 1 FROM warehouse.report_scope s
 WHERE s.principal=session_user AND s.domain=d.domain AND s.team=d.team);
CREATE VIEW reporting.current_release AS SELECT a.release_id FROM warehouse.active_release a
WHERE EXISTS(SELECT 1 FROM warehouse.report_scope s WHERE s.principal=session_user);
GRANT USAGE ON SCHEMA reporting TO p0_report_a,p0_report_b;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO p0_report_a,p0_report_b;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA raw,warehouse FROM PUBLIC;
