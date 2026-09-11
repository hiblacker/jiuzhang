CREATE SCHEMA verification;
CREATE TABLE verification.result(label text PRIMARY KEY);
CREATE FUNCTION verification.assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF;
 INSERT INTO verification.result VALUES(label);
END $$;

SELECT raw.ingest('devops','synthetic-retry','2026-02-02 01:00+08',payload)
 FROM raw.event WHERE event_id='a1' AND domain='devops';
SELECT verification.assert((SELECT count(*)=15 FROM raw.event),'duplicate replay is idempotent');
SELECT verification.assert((SELECT batch_id='synthetic-batch-1' FROM raw.event WHERE event_id='a1'),
 'duplicate preserves first ingestion lineage');
DO $$ BEGIN
 BEGIN
  PERFORM raw.ingest('devops','bad','2026-02-02 00:00+08',
   (SELECT payload || '{"status":"reopened"}'::jsonb FROM raw.event WHERE event_id='a1'));
  RAISE EXCEPTION 'expected conflict rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'conflicting event replay' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'conflicting replay rejected');
 BEGIN
  PERFORM raw.ingest('devops','bad','2026-02-02 00:00+08','1'::jsonb);
  RAISE EXCEPTION 'expected malformed envelope rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'invalid event envelope' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'JSON scalar is not a state transition');
END $$;
SELECT warehouse.build('2026-02-02 00:00+08', :'rule_version') AS r1 \gset
SELECT verification.assert((SELECT state='READY' FROM warehouse.release WHERE release_id=:r1),'build validates before publishing');
SELECT verification.assert((SELECT completion_events=4 AND completed_objects=3 AND duration_sum_seconds=21600
 AND valid_samples=2 AND duration_mean_seconds=10800 AND inventory=1
 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01' AND domain='devops' AND team='alpha'),
 'monthly golden flow distinct duration and inventory');
SELECT verification.assert((SELECT completed_objects=1 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01-30' AND domain='devops' AND team='alpha')
 AND (SELECT completed_objects=3 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01-31' AND domain='devops' AND team='alpha'),
 'monthly distinct is not the sum of daily distincts');
SELECT verification.assert((SELECT inventory=3 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01-30' AND domain='devops' AND team='alpha')
 AND (SELECT inventory=1 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01' AND domain='devops' AND team='alpha'),
 'monthly inventory is period end not sum of days');
SELECT verification.assert((SELECT count(*)=2 FROM warehouse.quality WHERE release_id=:r1 AND issue IN ('missing_start','negative_duration')),
 'missing and negative durations are quarantined from denominator');
SELECT verification.assert((SELECT duration_mean_seconds IS NULL AND duration_reason='no_valid_samples'
 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01' AND team='uncertain'),
 'zero denominator returns null with reason');
SELECT verification.assert((SELECT inventory IS NULL AND inventory_reason IS NOT NULL FROM warehouse.metric
 WHERE release_id=:r1 AND period_id='2026-01' AND team='uncertain'),
 'unknown status and missing history do not fabricate zero inventory');
SELECT verification.assert((SELECT count(*)=2 FROM warehouse.quality WHERE release_id=:r1 AND issue='incomplete_snapshot'),
 'incomplete snapshot is observable');
SELECT verification.assert((SELECT state='done' AND team='alpha' FROM warehouse.snapshot_detail
 WHERE release_id=:r1 AND period_id='2026-01' AND domain='devops' AND object_id='A')
 AND (SELECT team='beta' FROM warehouse.event_detail WHERE release_id=:r1 AND event_id='a4'),
 'Shanghai midnight and team half-open boundary');
SELECT verification.assert((SELECT completion_events=1 AND duration_sum_seconds=7200
 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-02-01' AND domain='devops' AND team='beta'),
 'February events excluded from January');
SELECT verification.assert((SELECT completion_events=1 AND completed_objects=1 AND duration_mean_seconds=10800
 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01' AND domain='helpdesk' AND team='service'),
 'second domain reuses shared calculation model');
SELECT verification.assert((SELECT inventory=1 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01' AND team='UNKNOWN'),
 'missing team is explicit UNKNOWN without losing object');
-- Flow gate: the devops domain carries a synthetic unknown state and incomplete
-- history, so the first publication attempt must be rejected until an approved
-- exemption exists; the failed attempt must leave a retryable state.
DO $$ BEGIN
 BEGIN
  PERFORM warehouse.publish((SELECT max(release_id) FROM warehouse.release),NULL);
  RAISE EXCEPTION 'expected flow gate';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'flow integrity exception required' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'publish blocks on incomplete flow integrity');
END $$;
SELECT verification.assert((SELECT state='READY' FROM warehouse.release WHERE release_id=:r1)
 AND (SELECT release_id IS NULL FROM warehouse.active_release),
 'failed publish preserves ready state for retry');
INSERT INTO warehouse.flow_exception(release_id,domain,approver,reason)
 VALUES(:r1,'devops','synthetic-approver','synthetic unknown state and incomplete history; not a real exemption');
SELECT warehouse.publish(:r1,NULL);
SELECT verification.assert((SELECT release_id=:r1 FROM warehouse.active_release),
 'publish recovers after per-domain flow exception');

DO $$ BEGIN
 BEGIN
  UPDATE warehouse.metric SET completion_events=999 WHERE release_id=1;
  RAISE EXCEPTION 'expected immutable content';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'release contents immutable after build' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'published values cannot be changed');
 BEGIN
  UPDATE warehouse.release SET state='BUILDING' WHERE release_id=1;
  RAISE EXCEPTION 'expected immutable state';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'invalid release transition' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'published release cannot return to building');
 BEGIN
  INSERT INTO raw.team_history VALUES('devops','A','overlap','2026-01-31 00:00+08','2026-02-02 00:00+08');
  PERFORM warehouse.build('2026-02-02 00:00+08','invalid');
  RAISE EXCEPTION 'expected overlap rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'overlapping team history' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'overlapping team history hard fails and rolls back');
 BEGIN
  PERFORM raw.ingest('devops','delete-test','2026-02-01 00:00+08',
   '{"id":"delete","object":"A","at":"2026-01-31T22:00:00+08:00","updated":"2026-01-31T22:00:00+08:00","status":"done","operation":"delete"}');
  PERFORM warehouse.build('2026-02-02 00:00+08','invalid');
  RAISE EXCEPTION 'expected delete rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'unsupported deletion semantics' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'undefined deletion semantics blocks publication');
 BEGIN
  PERFORM raw.ingest('devops','order-test','2026-02-01 00:00+08',
   (SELECT payload || '{"id":"ambiguous"}'::jsonb FROM raw.event WHERE event_id='a1'));
  PERFORM warehouse.build('2026-02-02 00:00+08','invalid');
  RAISE EXCEPTION 'expected ordering rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'ambiguous event ordering' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'ambiguous same-time transitions rejected');
END $$;
SELECT verification.assert((SELECT release_id=:r1 FROM warehouse.active_release),'failed builds preserve active release');

-- Late event belongs to January despite arriving in February.
SELECT raw.ingest('devops','synthetic-late','2026-02-03 00:00+08',
 '{"id":"f1","object":"F","at":"2026-01-31T16:00:00+08:00","updated":"2026-02-02T18:00:00+08:00","status":"done","started":"2026-01-31T10:00:00+08:00"}');
SELECT warehouse.build('2026-02-02 00:00+08', :'rule_version') AS old_candidate \gset
SELECT verification.assert((SELECT completion_events=4 FROM warehouse.metric WHERE release_id=:old_candidate AND period_id='2026-01' AND team='alpha'),
 'fixed ingestion cutoff excludes late arrival');
SELECT warehouse.build('2026-02-04 00:00+08', :'rule_version',true) AS closed \gset
SELECT verification.assert((SELECT completion_events=5 AND completed_objects=4 AND duration_sum_seconds=43200
 AND valid_samples=3 AND duration_mean_seconds=14400 AND inventory=0
 FROM warehouse.metric WHERE release_id=:closed AND period_id='2026-01' AND team='alpha'),
 'late arrival rebuilds affected month with correct denominator and end stock');
DO $$ BEGIN
 BEGIN
  PERFORM warehouse.publish((SELECT max(release_id) FROM warehouse.release),1);
  RAISE EXCEPTION 'expected approval gate';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'approval required' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'initial month close requires approval');
END $$;
INSERT INTO warehouse.approval(release_id,approver,reason) VALUES(:closed,'synthetic-approver','simulated first month close; not user acceptance');
DO $$ BEGIN
 BEGIN
  PERFORM warehouse.publish((SELECT max(release_id) FROM warehouse.release),1);
  RAISE EXCEPTION 'expected flow gate after approval';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'flow integrity exception required' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'flow exception still required after month close approval');
END $$;
INSERT INTO warehouse.flow_exception(release_id,domain,approver,reason) VALUES(:closed,'devops','synthetic-approver','simulated month close exemption; not a real exemption');
SELECT warehouse.publish(:closed,:r1);
SELECT verification.assert((SELECT release_id=:closed FROM warehouse.active_release),
 'finalized month publishes with approval and flow exception');
DO $$ BEGIN
 BEGIN
  PERFORM warehouse.publish(2,3);
  RAISE EXCEPTION 'expected stale guard';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'stale release' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'older ready run cannot overwrite newer release');
END $$;
SELECT warehouse.build('2026-02-05 00:00+08', :'rule_version',true) AS revision \gset
DO $$ BEGIN
 BEGIN
  PERFORM warehouse.publish((SELECT max(release_id) FROM warehouse.release),3);
  RAISE EXCEPTION 'expected revision approval';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'approval required' THEN RAISE; END IF;
 END;
 PERFORM verification.assert(true,'closed month revision requires separate approval');
END $$;
INSERT INTO warehouse.approval(release_id,approver,reason) VALUES(:revision,'synthetic-approver','simulated month B revision; not user acceptance');
INSERT INTO warehouse.flow_exception(release_id,domain,approver,reason) VALUES(:revision,'devops','synthetic-approver','simulated month B revision exemption; not a real exemption');
SELECT warehouse.publish(:revision,:closed);
SELECT verification.assert((SELECT count(*)=3 FROM warehouse.release WHERE state='PUBLISHED')
 AND (SELECT completion_events=4 FROM warehouse.metric WHERE release_id=:r1 AND period_id='2026-01' AND team='alpha'),
 'month B revisions retain immutable earlier published results');

-- Independent execution and publication identities. The worker only reaches ingest and
-- build through SECURITY DEFINER functions; the publisher only reaches publish plus the
-- approval/exemption tables. Neither has direct table access on raw or warehouse data.
GRANT USAGE ON SCHEMA verification TO p0_worker,p0_publisher;
GRANT INSERT ON verification.result TO p0_worker,p0_publisher;
SET SESSION AUTHORIZATION p0_worker;
SELECT warehouse.build('2026-02-05 12:00+08', :'rule_version', true) AS worker_built \gset
DO $$ BEGIN
 BEGIN
  PERFORM warehouse.publish((SELECT max(release_id) FROM warehouse.release),NULL);
  RAISE EXCEPTION 'publish unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'worker cannot publish');
 BEGIN
  INSERT INTO warehouse.approval(release_id,approver,reason)
   SELECT max(release_id),'synthetic-approver','should fail' FROM warehouse.release;
  RAISE EXCEPTION 'approval unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'worker cannot approve releases');
 BEGIN
  PERFORM 1 FROM raw.event;
  RAISE EXCEPTION 'raw unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'worker cannot read raw or warehouse tables directly');
 BEGIN
  PERFORM 1 FROM reporting.metrics;
  RAISE EXCEPTION 'reporting unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'worker cannot read reporting data');
END $$;
RESET SESSION AUTHORIZATION;
SELECT verification.assert((SELECT state='READY' FROM warehouse.release WHERE release_id=:worker_built),
 'worker builds release independently');
SET SESSION AUTHORIZATION p0_publisher;
INSERT INTO warehouse.approval(release_id,approver,reason) VALUES(:worker_built,'synthetic-approver','simulated publisher approval; not user acceptance');
INSERT INTO warehouse.flow_exception(release_id,domain,approver,reason) VALUES(:worker_built,'devops','synthetic-approver','simulated publisher flow exemption; not a real exemption');
SELECT warehouse.publish(:worker_built,(SELECT release_id FROM warehouse.active_release));
DO $$ BEGIN
 BEGIN
  PERFORM warehouse.build('2026-02-05 13:00+08','invalid');
  RAISE EXCEPTION 'build unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'publisher cannot build');
 BEGIN
  PERFORM raw.ingest('devops','pub-test','2026-02-05 13:00+08',
   '{"id":"px","object":"A","at":"2026-02-05T13:00:00+08:00","updated":"2026-02-05T13:00:00+08:00","status":"todo"}');
  RAISE EXCEPTION 'ingest unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'publisher cannot ingest events');
 BEGIN
  UPDATE warehouse.release SET state='PUBLISHED' WHERE release_id=(SELECT max(release_id) FROM warehouse.release);
  RAISE EXCEPTION 'release state unexpectedly writable';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'publisher cannot alter release state directly');
 BEGIN
  PERFORM 1 FROM raw.event;
  RAISE EXCEPTION 'raw unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'publisher cannot read raw data');
END $$;
RESET SESSION AUTHORIZATION;
SELECT verification.assert((SELECT release_id=:worker_built FROM warehouse.active_release),
 'publisher approves and publishes worker release');
REVOKE ALL ON SCHEMA verification FROM p0_worker,p0_publisher;
REVOKE ALL ON verification.result FROM p0_worker,p0_publisher;

-- session_user is the database identity, not a caller-controlled tenant setting.
GRANT USAGE ON SCHEMA verification TO p0_report_a,p0_report_b;
GRANT INSERT ON verification.result TO p0_report_a,p0_report_b;
SET SESSION AUTHORIZATION p0_report_a;
SELECT verification.assert(NOT EXISTS(SELECT FROM reporting.metrics WHERE domain<>'devops' OR team<>'alpha'),
 'reporter A only sees authorized aggregate scope');
SELECT verification.assert(NOT EXISTS(SELECT FROM reporting.events WHERE domain<>'devops' OR team<>'alpha')
 AND NOT EXISTS(SELECT FROM reporting.snapshots WHERE domain<>'devops' OR team<>'alpha'),
 'drilldown and snapshots share aggregate authorization');
SELECT verification.assert((SELECT count(*)=4 FROM reporting.events WHERE release_id=:r1 AND state='done'
 AND event_at>='2026-01-01 00:00+08' AND event_at<'2026-02-01 00:00+08'),
 'pinned old release drilldown stays consistent after revision');
SELECT verification.assert(EXISTS(SELECT 1 FROM reporting.release_flow
  WHERE release_id=:revision AND domain='devops' AND NOT flow_complete)
 AND NOT EXISTS(SELECT 1 FROM reporting.release_flow WHERE domain<>'devops'),
 'reporter sees per-domain flow completeness');
DO $$ BEGIN
 BEGIN
  PERFORM 1 FROM raw.event;
  RAISE EXCEPTION 'raw unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'reporter cannot read raw or internal data');
 BEGIN
  PERFORM warehouse.publish(2,4);
  RAISE EXCEPTION 'publish unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'reporter cannot publish');
 BEGIN
  SET ROLE postgres;
  RAISE EXCEPTION 'role escalation unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM verification.assert(true,'reporter cannot elevate role');
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION p0_report_b;
SELECT verification.assert((SELECT count(*)=4 FROM reporting.metrics WHERE period_id='2026-01')
 AND NOT EXISTS(SELECT FROM reporting.metrics WHERE domain<>'helpdesk'),
 'reporter B sees second domain only');
RESET SESSION AUTHORIZATION;
REVOKE ALL ON SCHEMA verification FROM p0_report_a,p0_report_b;
REVOKE ALL ON verification.result FROM p0_report_a,p0_report_b;
