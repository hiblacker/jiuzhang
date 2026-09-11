-- Slice 2: per-domain flow integrity gate with approved exemptions, and separated
-- execution/publisher/report identities. Forward-only; V001/V002 stay untouched.
CREATE TABLE warehouse.flow_status (
 release_id bigint NOT NULL REFERENCES warehouse.release,
 domain text NOT NULL,
 flow_complete boolean NOT NULL,
 PRIMARY KEY(release_id,domain)
);
CREATE TRIGGER immutable_flow_status BEFORE INSERT OR UPDATE OR DELETE ON warehouse.flow_status
 FOR EACH ROW EXECUTE FUNCTION warehouse.require_building();
CREATE TABLE warehouse.flow_exception (
 release_id bigint NOT NULL REFERENCES warehouse.release,
 domain text NOT NULL,
 approver text NOT NULL CHECK(length(approver)>0),
 reason text NOT NULL CHECK(length(reason)>0),
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(release_id,domain)
);

-- Supersedes the V001 publisher. Staleness and approval are decided before the flow
-- gate so existing rejections keep their messages; an incomplete domain without a
-- recorded exemption can never reach PUBLISHED.
CREATE OR REPLACE FUNCTION warehouse.publish(p_release bigint,p_expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF EXISTS(SELECT 1 FROM warehouse.metric m WHERE m.release_id=p_release
  AND NOT EXISTS(SELECT 1 FROM warehouse.flow_status f WHERE f.release_id=p_release AND f.domain=m.domain)) THEN
  RAISE EXCEPTION 'flow integrity not assessed';
 END IF;
 IF EXISTS(SELECT 1 FROM warehouse.flow_status f WHERE f.release_id=p_release AND NOT f.flow_complete
  AND NOT EXISTS(SELECT 1 FROM warehouse.flow_exception x WHERE x.release_id=f.release_id AND x.domain=f.domain)) THEN
  RAISE EXCEPTION 'flow integrity exception required';
 END IF;
 UPDATE warehouse.release SET state='PUBLISHED' WHERE release_id=p_release;
 UPDATE warehouse.active_release SET release_id=p_release WHERE singleton;
END $$;
REVOKE ALL ON FUNCTION warehouse.publish(bigint,bigint) FROM PUBLIC;

-- Ingest becomes the only write path the worker can reach; table grants stay with the
-- function owner so no role reads or writes raw/warehouse tables directly.
ALTER FUNCTION raw.ingest(text,text,timestamptz,jsonb) SECURITY DEFINER;
REVOKE ALL ON FUNCTION raw.ingest(text,text,timestamptz,jsonb) FROM PUBLIC;

-- Cluster-global service identities; report roles become real login identities with
-- runtime-injected SCRAM passwords. No passwords live in migration files or argv.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='p0_worker') THEN CREATE ROLE p0_worker NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='p0_publisher') THEN CREATE ROLE p0_publisher NOLOGIN; END IF;
END $$;
ALTER ROLE p0_report_a LOGIN;
ALTER ROLE p0_report_b LOGIN;

GRANT USAGE ON SCHEMA raw, warehouse TO p0_worker;
GRANT EXECUTE ON FUNCTION raw.ingest(text,text,timestamptz,jsonb) TO p0_worker;
GRANT USAGE ON SCHEMA warehouse TO p0_publisher;
GRANT EXECUTE ON FUNCTION warehouse.publish(bigint,bigint) TO p0_publisher;
GRANT SELECT ON warehouse.release, warehouse.metric, warehouse.flow_status, warehouse.active_release TO p0_publisher;
GRANT INSERT ON warehouse.approval, warehouse.flow_exception TO p0_publisher;

-- Report consumers can see whether each published domain's flow is complete, scoped by
-- the same authorization as metrics; incomplete flow is visible, never fabricated.
CREATE VIEW reporting.release_flow WITH (security_barrier=true) AS
SELECT f.release_id,f.domain,f.flow_complete FROM warehouse.flow_status f
JOIN warehouse.release r USING(release_id)
WHERE r.state='PUBLISHED' AND EXISTS(SELECT 1 FROM warehouse.report_scope s
 WHERE s.principal=session_user AND s.domain=f.domain);
GRANT SELECT ON reporting.release_flow TO p0_report_a,p0_report_b;
