-- Forward-only repair: HTTP Worker authentication does not change the API's DB
-- role. Keep table DML private and expose one bounded, audited commit function.
ALTER TABLE lake.inventory ADD COLUMN contract_json JSONB;
ALTER TABLE lake.system_run ADD COLUMN manifest_json JSONB;

REVOKE INSERT, UPDATE ON lake.system_run, lake.object_run, lake.delivery_ledger,
  lake.raw_object FROM bydw_ingestion_worker;
REVOKE UPDATE ON lake.inventory, lake.source_object FROM bydw_control_api;

CREATE FUNCTION lake.register_manifest(p JSONB, actor TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  sid BIGINT;
  inv BIGINT;
  rid BIGINT;
  oid BIGINT;
  orid BIGINT;
  prior lake.system_run%ROWTYPE;
  item JSONB;
  n BIGINT;
  total_rows BIGINT := 0;
  started TIMESTAMPTZ := (p->>'startedAt')::timestamptz;
  finished TIMESTAMPTZ := (p->>'finishedAt')::timestamptz;
  window_start TIMESTAMPTZ := (p->>'scheduledWindowStart')::timestamptz;
  window_end TIMESTAMPTZ := (p->>'scheduledWindowEnd')::timestamptz;
  outcome TEXT := p->>'state';
BEGIN
  IF actor IS NULL OR length(actor) NOT BETWEEN 1 AND 200
      OR started IS NULL OR p->>'runKey' IS NULL
      OR outcome IS NULL OR outcome NOT IN ('PLANNED','RUNNING','COMPLETE','INCOMPLETE','FAILED','CANCELLED')
      OR jsonb_typeof(p->'objects') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p->'objects') NOT BETWEEN 1 AND 10000
      OR (window_start IS NULL) <> (window_end IS NULL)
      OR window_start >= window_end
      OR (outcome = 'COMPLETE' AND (finished IS NULL OR finished < started)) THEN
    RAISE EXCEPTION 'LAKE_INVALID_MANIFEST';
  END IF;
  SELECT id INTO STRICT sid FROM control.source_connection WHERE code = p->>'sourceCode';
  -- Serialize all updates to one source, including competing first inserts.
  PERFORM pg_advisory_xact_lock(sid);
  SELECT id INTO inv FROM lake.inventory
    WHERE source_id = sid AND plan_version = (p->>'planVersion')::bigint AND state = 'ACTIVE';
  IF inv IS NULL THEN RAISE EXCEPTION 'LAKE_INVENTORY_NOT_REGISTERED'; END IF;
  SELECT count(DISTINCT value->>'objectName') INTO n FROM jsonb_array_elements(p->'objects');
  IF n <> jsonb_array_length(p->'objects') THEN RAISE EXCEPTION 'LAKE_DUPLICATE_OBJECT'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'objects') v
      WHERE NOT EXISTS (SELECT 1 FROM lake.source_object s WHERE s.inventory_id = inv AND s.object_name = v->>'objectName')) THEN
    RAISE EXCEPTION 'LAKE_UNKNOWN_OBJECT';
  END IF;
  IF outcome = 'COMPLETE' AND EXISTS (
      SELECT 1 FROM lake.source_object s WHERE s.inventory_id = inv AND s.required
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'objects') v
        WHERE v->>'objectName' = s.object_name AND v->>'state' = 'RAW_COMMITTED')) THEN
    RAISE EXCEPTION 'LAKE_REQUIRED_OBJECT_INCOMPLETE';
  END IF;
  SELECT * INTO prior FROM lake.system_run WHERE source_id = sid
    AND plan_version = (p->>'planVersion')::bigint AND run_key = p->>'runKey'
    AND attempt = (p->>'attempt')::int AND revision = (p->>'revision')::int FOR UPDATE;
  IF FOUND THEN
    rid := prior.id;
    IF prior.state IN ('COMPLETE','FAILED','CANCELLED','INCOMPLETE') THEN
      IF prior.manifest_json IS DISTINCT FROM p THEN RAISE EXCEPTION 'LAKE_RUN_IMMUTABLE'; END IF;
      RETURN rid;
    END IF;
    IF prior.started_at IS DISTINCT FROM started OR prior.mode IS DISTINCT FROM p->>'mode'
        OR prior.consistency IS DISTINCT FROM p->>'consistency'
        OR prior.scheduled_window_start IS DISTINCT FROM window_start
        OR prior.scheduled_window_end IS DISTINCT FROM window_end THEN
      RAISE EXCEPTION 'LAKE_RUN_IMMUTABLE';
    END IF;
    UPDATE lake.system_run SET state = outcome, finished_at = finished,
      error_code = p->>'errorCode', manifest_json = p WHERE id = rid;
  ELSE
    INSERT INTO lake.system_run(source_id, plan_version, run_key, scheduled_window_start,
        scheduled_window_end, mode, attempt, revision, state, consistency, started_at, finished_at, error_code, manifest_json)
      VALUES(sid, (p->>'planVersion')::bigint, p->>'runKey', window_start, window_end,
        p->>'mode', (p->>'attempt')::int, (p->>'revision')::int, outcome,
        p->>'consistency', started, finished, p->>'errorCode', p) RETURNING id INTO rid;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'objects') LOOP
    SELECT id INTO STRICT oid FROM lake.source_object WHERE inventory_id = inv AND object_name = item->>'objectName';
    IF item->>'state' = 'RAW_COMMITTED' AND (
        coalesce(item->>'rawPath','') = '' OR item->>'rawPath' ~ '(^/|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$))'
        OR coalesce(item->>'rawSha256','') !~ '^[0-9a-f]{64}$'
        OR coalesce(item->>'schemaSha256','') !~ '^[0-9a-f]{64}$') THEN
      RAISE EXCEPTION 'LAKE_INVALID_RAW_OBJECT';
    END IF;
    IF EXISTS (SELECT 1 FROM lake.object_run o WHERE o.system_run_id = rid AND o.source_object_id = oid
        AND o.state = 'RAW_COMMITTED' AND (o.raw_sha256 IS DISTINCT FROM item->>'rawSha256'
          OR o.raw_path IS DISTINCT FROM item->>'rawPath' OR item->>'state' <> 'RAW_COMMITTED'
          OR o.row_count IS DISTINCT FROM (item->>'rowCount')::bigint
          OR o.byte_count IS DISTINCT FROM (item->>'byteCount')::bigint
          OR o.schema_sha256 IS DISTINCT FROM item->>'schemaSha256'
          OR EXISTS (SELECT 1 FROM lake.raw_object r WHERE r.object_run_id = o.id
            AND r.format IS DISTINCT FROM item->>'format'))) THEN
      RAISE EXCEPTION 'LAKE_RAW_OBJECT_IMMUTABLE';
    END IF;
    INSERT INTO lake.object_run(system_run_id, source_object_id, state, row_count, byte_count,
        source_started_at, source_finished_at, raw_path, raw_sha256, schema_sha256, error_code)
      VALUES(rid, oid, item->>'state', (item->>'rowCount')::bigint, (item->>'byteCount')::bigint,
        started, finished, item->>'rawPath', item->>'rawSha256', item->>'schemaSha256', p->>'errorCode')
      ON CONFLICT(system_run_id, source_object_id) DO UPDATE SET state = EXCLUDED.state,
        row_count = EXCLUDED.row_count, byte_count = EXCLUDED.byte_count,
        source_finished_at = EXCLUDED.source_finished_at, raw_path = EXCLUDED.raw_path,
        raw_sha256 = EXCLUDED.raw_sha256, schema_sha256 = EXCLUDED.schema_sha256, error_code = EXCLUDED.error_code
      RETURNING id INTO orid;
    total_rows := total_rows + (item->>'rowCount')::bigint;
    IF item->>'state' = 'RAW_COMMITTED' THEN
      INSERT INTO lake.raw_object(object_run_id, object_version, storage_path, format, byte_count, row_count, sha256, state)
        VALUES(orid, 'manifest-v1', item->>'rawPath', item->>'format', (item->>'byteCount')::bigint,
          (item->>'rowCount')::bigint, item->>'rawSha256', 'COMMITTED')
        ON CONFLICT(object_run_id, object_version) DO NOTHING;
    END IF;
  END LOOP;
  IF outcome = 'COMPLETE' THEN
    INSERT INTO lake.active_run(source_id, run_id, revision) VALUES(sid, rid, 1)
      ON CONFLICT(source_id) DO UPDATE SET run_id = EXCLUDED.run_id,
        revision = lake.active_run.revision + 1, updated_at = clock_timestamp()
      WHERE lake.active_run.run_id <> EXCLUDED.run_id AND EXISTS (
        SELECT 1 FROM lake.system_run old WHERE old.id = lake.active_run.run_id
          AND (started, (p->>'planVersion')::bigint, (p->>'revision')::int)
              > (old.started_at, old.plan_version, old.revision));
  END IF;
  IF window_start IS NOT NULL THEN
    INSERT INTO lake.delivery_ledger(source_id, scheduled_window_start, scheduled_window_end,
        delivery_kind, expected_state, observed_state, received_at, actual_data_at, run_id, details)
      VALUES(sid, window_start, window_end,
        CASE p->>'mode' WHEN 'FILE_SCAN' THEN 'FILE' WHEN 'API_PULL' THEN 'API' ELSE 'DATABASE' END,
        'EXPECTED', CASE WHEN outcome = 'COMPLETE' AND total_rows = 0 THEN 'EMPTY_CONFIRMED'
          WHEN outcome = 'COMPLETE' THEN 'RECEIVED' WHEN outcome IN ('PLANNED','RUNNING') THEN 'WAITING_READY' ELSE 'FAILED' END,
        finished, started, rid, jsonb_build_object('rows', total_rows))
      ON CONFLICT(source_id, (COALESCE(source_object_id, 0)), scheduled_window_start, scheduled_window_end, delivery_kind)
      DO UPDATE SET observed_state = EXCLUDED.observed_state, received_at = EXCLUDED.received_at,
        actual_data_at = EXCLUDED.actual_data_at, run_id = EXCLUDED.run_id, details = EXCLUDED.details
      WHERE (EXCLUDED.observed_state IN ('RECEIVED','EMPTY_CONFIRMED') OR lake.delivery_ledger.observed_state NOT IN ('RECEIVED','EMPTY_CONFIRMED'))
        AND EXCLUDED.actual_data_at >= lake.delivery_ledger.actual_data_at;
  END IF;
  INSERT INTO control.audit_log(principal, action, resource, result, details)
    VALUES(actor, 'LAKE_MANIFEST_REGISTER', 'lake/system-run/' || rid, 'SUCCESS', '{}'::jsonb);
  RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION lake.register_manifest(JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lake.register_manifest(JSONB, TEXT) TO bydw_control_api;
