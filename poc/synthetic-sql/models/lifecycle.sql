-- Shared lifecycle model. No DevOps table names or source status literals here.
CREATE FUNCTION warehouse.build(p_cutoff timestamptz,p_rule text,p_finalized boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rid bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM raw.team_history a JOIN raw.team_history b
  ON a.domain=b.domain AND a.object_id=b.object_id AND a.valid_from<b.valid_from
  AND (a.valid_to IS NULL OR a.valid_to>b.valid_from)) THEN
  RAISE EXCEPTION 'overlapping team history';
 END IF;
 IF EXISTS(SELECT 1 FROM raw.event WHERE ingested_at<p_cutoff AND payload->>'operation'='delete') THEN
  RAISE EXCEPTION 'unsupported deletion semantics';
 END IF;
 IF EXISTS(SELECT 1 FROM raw.event WHERE ingested_at<p_cutoff
  GROUP BY domain,object_id,event_at HAVING count(*)>1) THEN
  RAISE EXCEPTION 'ambiguous event ordering';
 END IF;
 INSERT INTO warehouse.release(input_cutoff,rule_version,finalized)
 VALUES(p_cutoff,p_rule,p_finalized) RETURNING release_id INTO rid;
 INSERT INTO warehouse.event_detail
 SELECT rid,e.domain,e.event_id,e.object_id,COALESCE(t.team,'UNKNOWN'),e.state,
  e.event_at,e.source_updated_at,e.ingested_at,e.batch_id,
  CASE WHEN e.state='done' AND e.started_at<=e.event_at
    THEN extract(epoch FROM e.event_at-e.started_at) END,
  CASE WHEN e.state<>'done' THEN NULL WHEN e.started_at IS NULL THEN 'missing_start'
    WHEN e.started_at>e.event_at THEN 'negative_duration' END
 FROM model.canonical_event e LEFT JOIN raw.team_history t
  ON t.domain=e.domain AND t.object_id=e.object_id AND t.valid_from<=e.event_at
  AND (t.valid_to IS NULL OR t.valid_to>e.event_at)
 WHERE e.ingested_at<p_cutoff;

 INSERT INTO warehouse.snapshot_detail
 SELECT rid,p.period_id,o.domain,o.object_id,COALESCE(t.team,'UNKNOWN'),COALESCE(last_event.state,'unknown'),
  o.history_complete AND last_event.state IS NOT NULL AND last_event.state<>'unknown' AND p.end_at<=p_cutoff
 FROM model.period p JOIN raw.object o ON o.created_at<p.end_at
 LEFT JOIN LATERAL (
  SELECT e.state FROM warehouse.event_detail e
  WHERE e.release_id=rid AND e.domain=o.domain AND e.object_id=o.object_id AND e.event_at<p.end_at
  ORDER BY e.event_at DESC LIMIT 1
 ) last_event ON true
 LEFT JOIN raw.team_history t ON t.domain=o.domain AND t.object_id=o.object_id
  AND t.valid_from<p.end_at AND (t.valid_to IS NULL OR t.valid_to>=p.end_at);

 INSERT INTO warehouse.quality
 SELECT rid,domain,object_id,duration_reason,event_id,'warning'
 FROM warehouse.event_detail WHERE release_id=rid AND duration_reason IS NOT NULL
 UNION ALL
 SELECT rid,domain,object_id,'unknown_state',event_id,'warning'
 FROM warehouse.event_detail WHERE release_id=rid AND state='unknown'
 UNION ALL
 SELECT rid,domain,object_id,'missing_team',event_id,'warning'
 FROM warehouse.event_detail WHERE release_id=rid AND team='UNKNOWN'
 UNION ALL
 SELECT DISTINCT rid,domain,object_id,'incomplete_snapshot',NULL,'warning'
 FROM warehouse.snapshot_detail WHERE release_id=rid AND NOT complete;

 -- Per-domain flow integrity: unknown states, unattributed objects or incomplete
 -- snapshots mark the domain incomplete; publication then needs an approved exemption.
 INSERT INTO warehouse.flow_status(release_id,domain,flow_complete)
 SELECT rid,d.domain,bool_and(d.ok)
 FROM (
  SELECT domain,(state<>'unknown' AND team<>'UNKNOWN') AS ok
   FROM warehouse.event_detail WHERE release_id=rid
  UNION ALL
  SELECT domain,complete FROM warehouse.snapshot_detail WHERE release_id=rid
 ) d GROUP BY d.domain;

 INSERT INTO warehouse.metric
 WITH flows AS (
  SELECT p.period_id,e.domain,e.team,count(*) AS events,count(DISTINCT e.object_id) AS objects,
   COALESCE(sum(e.duration_seconds),0) AS seconds,count(e.duration_seconds) AS samples
  FROM model.period p JOIN warehouse.event_detail e
   ON e.event_at>=p.start_at AND e.event_at<p.end_at AND e.release_id=rid AND e.state='done'
  GROUP BY p.period_id,e.domain,e.team
 ), stocks AS (
  SELECT period_id,domain,team,count(*) FILTER(WHERE state='open') AS inventory,bool_and(complete) AS complete
  FROM warehouse.snapshot_detail WHERE release_id=rid GROUP BY period_id,domain,team
 )
 SELECT rid,COALESCE(f.period_id,s.period_id),COALESCE(f.domain,s.domain),COALESCE(f.team,s.team),
  COALESCE(f.events,0),COALESCE(f.objects,0),COALESCE(f.seconds,0),COALESCE(f.samples,0),
  f.seconds/NULLIF(f.samples,0),CASE WHEN COALESCE(f.samples,0)=0 THEN 'no_valid_samples' END,
  CASE WHEN s.complete THEN s.inventory END,
  CASE WHEN s.complete IS DISTINCT FROM true THEN 'incomplete_history_or_period' END
 FROM flows f FULL JOIN stocks s USING(period_id,domain,team);

 -- A quality warning must not silently become zero or a fabricated duration, and every
 -- metric domain must have a flow verdict before the release can become READY.
 IF EXISTS(SELECT 1 FROM warehouse.metric m WHERE m.release_id=rid AND (
  m.completed_objects>m.completion_events OR m.valid_samples>m.completion_events OR m.duration_sum_seconds<0
  OR (m.valid_samples=0 AND m.duration_mean_seconds IS NOT NULL)
  OR (m.inventory IS NULL AND m.inventory_reason IS NULL)
  OR NOT EXISTS(SELECT 1 FROM warehouse.flow_status f WHERE f.release_id=rid AND f.domain=m.domain))) THEN
  RAISE EXCEPTION 'metric quality gate failed';
 END IF;
 UPDATE warehouse.release SET state='READY' WHERE release_id=rid;
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION warehouse.build(timestamptz,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION warehouse.build(timestamptz,text,boolean) TO p0_worker;
