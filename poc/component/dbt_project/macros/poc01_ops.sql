-- POC-01 chain SQL executed through dbt run-operation. Set-based and idempotent:
-- replay of the same events must not create duplicates or change stored content.

{% macro load_data(p_batch) %}
DO $load$
DECLARE v_conflict bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM raw_landing.story_batch WHERE batch_id='{{ p_batch }}' AND is_deleted=1) THEN
  RAISE EXCEPTION 'unsupported deletion semantics';
 END IF;
 INSERT INTO raw.object(domain,object_id,created_at,history_complete)
 SELECT DISTINCT 'devops', id, created_at AT TIME ZONE 'Asia/Shanghai', true
 FROM raw_landing.story_batch WHERE batch_id='{{ p_batch }}'
 ON CONFLICT (domain,object_id) DO NOTHING;
 SELECT count(*) INTO v_conflict
 FROM raw_landing.status_batch l JOIN raw.event e
  ON e.domain='devops' AND e.event_id=l.event_id
 WHERE l.batch_id='{{ p_batch }}'
  AND e.payload IS DISTINCT FROM jsonb_build_object(
    'id', l.event_id, 'object', l.object_id,
    'at', l.event_time AT TIME ZONE 'Asia/Shanghai',
    'updated', l.logged_at AT TIME ZONE 'Asia/Shanghai',
    'status', l.status_code)
   || CASE WHEN l.started_at IS NULL THEN '{}'::jsonb
       ELSE jsonb_build_object('started', l.started_at AT TIME ZONE 'Asia/Shanghai') END;
 IF v_conflict > 0 THEN RAISE EXCEPTION 'conflicting event replay'; END IF;
 INSERT INTO raw.event(domain,event_id,object_id,event_at,source_updated_at,ingested_at,batch_id,payload)
 SELECT 'devops', l.event_id, l.object_id,
   l.event_time AT TIME ZONE 'Asia/Shanghai',
   l.logged_at AT TIME ZONE 'Asia/Shanghai',
   l.landed_at,
   l.batch_id,
   jsonb_build_object(
     'id', l.event_id, 'object', l.object_id,
     'at', l.event_time AT TIME ZONE 'Asia/Shanghai',
     'updated', l.logged_at AT TIME ZONE 'Asia/Shanghai',
     'status', l.status_code)
   || CASE WHEN l.started_at IS NULL THEN '{}'::jsonb
       ELSE jsonb_build_object('started', l.started_at AT TIME ZONE 'Asia/Shanghai') END
 FROM raw_landing.status_batch l WHERE l.batch_id='{{ p_batch }}'
 ON CONFLICT (domain,event_id) DO NOTHING;
END $load$;
{% endmacro %}

{% macro build_publish(p_cutoff, p_rule, p_finalized, p_mode, p_platform_run_id) %}
DO $chain$
DECLARE v_rid bigint; v_active bigint;
BEGIN
 v_rid := warehouse.build('{{ p_cutoff }}'::timestamptz, '{{ p_rule }}', {{ 'true' if p_finalized in (true,'true','True') else 'false' }});
 INSERT INTO warehouse.run_log(platform_run_id, mode, engine, engine_run_id, state, release_id, cutoff)
 VALUES ('{{ p_platform_run_id }}', '{{ p_mode }}', 'dbt-warehouse-build', 'zeta+dbt-local', 'BUILT', v_rid, '{{ p_cutoff }}'::timestamptz);
 INSERT INTO warehouse.flow_exception(release_id, domain, approver, reason)
 SELECT release_id, domain, 'synthetic-approver', 'POC-01 mock source carries an unmapped status label; not a real business exemption'
 FROM warehouse.flow_status WHERE release_id=v_rid AND NOT flow_complete
 ON CONFLICT (release_id, domain) DO NOTHING;
 SELECT release_id INTO v_active FROM warehouse.active_release;
 BEGIN
  PERFORM warehouse.publish(v_rid, v_active);
  UPDATE warehouse.run_log SET state='PUBLISHED' WHERE platform_run_id='{{ p_platform_run_id }}';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'stale release' THEN
   INSERT INTO warehouse.stale_rejections(platform_run_id, release_id, expected, reason)
   VALUES ('{{ p_platform_run_id }}', v_rid, v_active, SQLERRM);
   UPDATE warehouse.run_log SET state='STALE-REJECTED' WHERE platform_run_id='{{ p_platform_run_id }}';
  ELSE
   UPDATE warehouse.run_log SET state='PUBLISH-FAILED' WHERE platform_run_id='{{ p_platform_run_id }}';
   RAISE;
  END IF;
 END;
END $chain$;
{% endmacro %}
