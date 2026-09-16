package com.bydw.lake;

import com.bydw.api.ApiException;
import com.bydw.warehouse.ExternalAssetService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Date;
import java.sql.Time;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.Collections;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LakeExecutionService {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final LakeRegistrationService registration;
  private final ExternalAssetService assets;
  private final com.bydw.warehouse.ManagedRuntimeService managedRuntime;
  private static final Set<String> KINDS = Set.of("MYSQL_SNAPSHOT", "FILE_SCAN", "REST_PULL");
  public LakeExecutionService(JdbcTemplate jdbc, ObjectMapper json, LakeRegistrationService registration, ExternalAssetService assets, com.bydw.warehouse.ManagedRuntimeService managedRuntime) {
    this.jdbc = jdbc; this.json = json; this.registration = registration; this.assets = assets;this.managedRuntime=managedRuntime;
  }

  @Transactional
  public Map<String, Object> savePlan(LakePlanRequest r, String actor) {
    if (r == null || r.kind() == null || !KINDS.contains(r.kind()) || r.runtimeRef() == null
        || !r.runtimeRef().matches("[a-z][a-z0-9_-]{1,99}") || r.contract() == null || !r.contract().isObject()
        || r.contract().toString().length() > 16384 || r.startDate() == null || r.triggerTime() == null
        || r.expectedVersion() < 0 || r.maxAttempts() < 1 || r.maxAttempts() > 8
        || r.timeoutSeconds() < 30 || r.timeoutSeconds() > 86400
        || r.startDate().getYear() < 2000 || r.startDate().getYear() > 2100) bad("INVALID_PLAN");
    try { ZoneId.of(r.timezone()); } catch (Exception error) { bad("INVALID_TIMEZONE"); }
    rejectSecrets(r.contract());
    for (String field : List.of("pollSeconds", "lateDays")) {
      JsonNode value = r.contract().get(field);
      int min = field.equals("pollSeconds") ? 60 : 0, max = field.equals("pollSeconds") ? 3600 : 31;
      if (value != null && (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < min || value.intValue() > max)) bad("INVALID_DELIVERY_RETRY_POLICY");
    }
    if (r.contract().has("daysOfWeek")) {
      var weekdays=r.contract().path("daysOfWeek");var unique=new java.util.HashSet<Integer>();
      if(!weekdays.isArray()||weekdays.isEmpty()||weekdays.size()>7)bad("INVALID_SCHEDULE_DAYS");
      for(JsonNode day:weekdays)if(!day.isIntegralNumber()||day.asInt()<1||day.asInt()>7||!unique.add(day.asInt()))bad("INVALID_SCHEDULE_DAYS");
    }
    if (r.kind().equals("MYSQL_SNAPSHOT") && (r.historicalRead() || r.inventoryVersion() == null)) bad("MYSQL_PLAN_REQUIRES_CURRENT_SNAPSHOT");
    var source = jdbc.queryForList("SELECT id FROM control.source_connection WHERE code = ?", r.sourceCode());
    if (source.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "SOURCE_NOT_FOUND", "Source is not registered");
    long sourceId = ((Number) source.getFirst().get("id")).longValue();
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(?)", Object.class, sourceId);
    if (r.inventoryVersion() != null && jdbc.queryForObject("SELECT count(*) FROM lake.inventory WHERE source_id = ? AND plan_version = ? AND state = 'ACTIVE'", Long.class, sourceId, r.inventoryVersion()) != 1) bad("INVENTORY_NOT_REGISTERED");
    var existing = jdbc.queryForList("SELECT * FROM lake.ingestion_plan WHERE source_id = ? FOR UPDATE", sourceId);
    int current = existing.isEmpty() ? 0 : ((Number) existing.getFirst().get("active_version")).intValue();
    if (current != r.expectedVersion()) conflict("PLAN_VERSION_CHANGED");
    int next = current + 1;
    long id;
    if (existing.isEmpty()) id = jdbc.queryForObject("INSERT INTO lake.ingestion_plan(source_id, active_version, state) VALUES (?, ?, 'ACTIVE') RETURNING id", Long.class, sourceId, next);
    else { id = ((Number) existing.getFirst().get("id")).longValue(); jdbc.update("UPDATE lake.ingestion_plan SET active_version = ? WHERE id = ?", next, id); }
    jdbc.update("""
        INSERT INTO lake.plan_version(plan_id, version, inventory_version, kind, runtime_ref, contract,
          timezone, trigger_time, start_date, historical_read, max_attempts, timeout_seconds)
        VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?)
        """, id, next, r.inventoryVersion(), r.kind(), r.runtimeRef(), r.contract().toString(), r.timezone(),
        Time.valueOf(r.triggerTime()), Date.valueOf(r.startDate()), r.historicalRead(), r.maxAttempts(), r.timeoutSeconds());
    // A definition change must not leave permanently unclaimable queued work.
    jdbc.update("""
        UPDATE lake.execution_attempt a SET state = 'CANCELLED', cancel_requested = TRUE,
          finished_at = clock_timestamp(), error_code = 'PLAN_SUPERSEDED'
        FROM lake.execution_window w WHERE a.window_id = w.id AND w.plan_id = ?
          AND w.plan_version <> ? AND a.state = 'QUEUED'
        """, id, next);
    jdbc.update("""
        UPDATE lake.execution_window w SET state = 'CANCELLED', reason = 'PLAN_SUPERSEDED'
        WHERE w.plan_id = ? AND w.plan_version <> ? AND w.state IN ('QUEUED','INCOMPLETE')
          AND NOT EXISTS (SELECT 1 FROM lake.execution_attempt a WHERE a.window_id = w.id AND a.state = 'RUNNING')
        """, id, next);
    audit(actor, "LAKE_PLAN_VERSION", "lake/plan/" + id, Map.of("version", next));
    return Map.of("id", id, "version", next);
  }

  public List<Map<String, Object>> plans() {
    var rows = jdbc.queryForList("""
        SELECT p.id, s.code AS source_code, p.state, p.active_version, v.inventory_version, v.kind,
          v.runtime_ref, v.contract, v.timezone, v.trigger_time, v.start_date, v.historical_read,
          v.max_attempts, v.timeout_seconds FROM lake.ingestion_plan p
        JOIN control.source_connection s ON s.id = p.source_id
        JOIN lake.plan_version v ON v.plan_id = p.id AND v.version = p.active_version ORDER BY p.id LIMIT 200
        """);
    rows.forEach(row -> decode(row, "contract"));
    return rows;
  }

  @Transactional
  public void setState(long plan, String state, String actor) {
    if (!Set.of("ACTIVE", "PAUSED").contains(state == null ? "" : state)) bad("INVALID_PLAN_STATE");
    if (jdbc.update("UPDATE lake.ingestion_plan SET state = ? WHERE id = ?", state, plan) != 1) bad("PLAN_NOT_FOUND");
    audit(actor, "LAKE_PLAN_STATE", "lake/plan/" + plan, Map.of("state", state));
  }

  /** Invoked by exactly one configured driver; dates remain platform metadata. */
  @Transactional
  public Map<String, Object> reconcile(Instant now) {
    expire(now);
    retryPending(now);
    int created = 0;
    for (var plan : jdbc.queryForList("""
        SELECT p.id, p.source_id, p.active_version, v.* FROM lake.ingestion_plan p JOIN lake.plan_version v
          ON v.plan_id = p.id AND v.version = p.active_version WHERE p.state = 'ACTIVE'
        ORDER BY p.last_claimed_at NULLS FIRST,p.id FOR UPDATE OF p SKIP LOCKED
        """)) {
      if(managedRuntime.sourcePaused(((Number)plan.get("source_id")).longValue()))continue;
      ZoneId zone = ZoneId.of(plan.get("timezone").toString());
      LocalDate today = now.atZone(zone).toLocalDate();
      LocalTime trigger = ((Time) plan.get("trigger_time")).toLocalTime();
      LocalDate due = now.atZone(zone).toLocalTime().isBefore(trigger) ? today.minusDays(1) : today;
      // Find actual gaps, including ones older than a manually triggered day.
      var dates = jdbc.queryForList("""
          SELECT day::date AS day FROM generate_series(?::date, ?::date, interval '1 day') day
          WHERE NOT EXISTS (SELECT 1 FROM lake.execution_window w WHERE w.plan_id = ?
            AND w.plan_version = ? AND w.business_date = day::date AND w.revision = 1)
          AND (NOT jsonb_exists(?::jsonb, 'daysOfWeek') OR (?::jsonb->'daysOfWeek') @> to_jsonb(extract(isodow FROM day)::integer))
          ORDER BY day LIMIT 31
          """, plan.get("start_date"), Date.valueOf(due), plan.get("id"), plan.get("active_version"),plan.get("contract").toString(),plan.get("contract").toString());
      for (var date : dates) {
        LocalDate day = ((Date) date.get("day")).toLocalDate();
        boolean unavailable = !(Boolean) plan.get("historical_read") && day.isBefore(today);
        enqueue(plan, day, 1, "SCHEDULED", unavailable ? "HISTORICAL_SNAPSHOT_UNAVAILABLE" : null, unavailable);
        created++;
      }
    }
    return Map.of("createdWindows", created);
  }

  @Transactional
  public Map<String, Object> trigger(long planId, LocalDate day, boolean revision, String reason, String actor) {
    if (day == null || reason == null || reason.isBlank() || reason.length() > 300) bad("TRIGGER_REASON_REQUIRED");
    var plans = jdbc.queryForList("""
        SELECT p.id, p.source_id, p.active_version, v.* FROM lake.ingestion_plan p JOIN lake.plan_version v
        ON v.plan_id = p.id AND v.version = p.active_version WHERE p.id = ? FOR UPDATE OF p
        """, planId);
    if (plans.isEmpty()) bad("PLAN_NOT_FOUND");
    var p = plans.getFirst();
    if(managedRuntime.sourcePaused(((Number)p.get("source_id")).longValue()))conflict("INGESTION_PAUSED");
    LocalDate today = Instant.now().atZone(ZoneId.of(p.get("timezone").toString())).toLocalDate();
    if (day.isAfter(today)) bad("FUTURE_WINDOW");
    if (!(Boolean) p.get("historical_read") && day.isBefore(today)) conflict("HISTORICAL_SNAPSHOT_UNAVAILABLE");
    int next = 1;
    if (revision) next = jdbc.queryForObject("SELECT coalesce(max(revision), 0) + 1 FROM lake.execution_window WHERE plan_id = ? AND plan_version = ? AND business_date = ?", Integer.class, planId, p.get("active_version"), Date.valueOf(day));
    long window = enqueue(p, day, next, day.isBefore(today) ? "BACKFILL" : "MANUAL", reason, false);
    audit(actor, "LAKE_WINDOW_TRIGGER", "lake/window/" + window, Map.of("reason", reason, "revision", next));
    return Map.of("windowId", window, "revision", next);
  }

  private long enqueue(Map<String, Object> p, LocalDate day, int revision, String mode, String reason, boolean missing) {
    ZoneId zone = ZoneId.of(p.get("timezone").toString());
    jdbc.update("""
        INSERT INTO lake.execution_window(plan_id, plan_version, business_date, window_start, window_end, revision, mode, state, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
        """, p.get("id"), p.get("active_version"), Date.valueOf(day), day.atStartOfDay(zone).toOffsetDateTime(),
        day.plusDays(1).atStartOfDay(zone).toOffsetDateTime(), revision, mode, missing ? "MISSING" : "QUEUED", reason);
    long id = jdbc.queryForObject("SELECT id FROM lake.execution_window WHERE plan_id = ? AND plan_version = ? AND business_date = ? AND revision = ?", Long.class, p.get("id"), p.get("active_version"), Date.valueOf(day), revision);
    if (!missing) jdbc.update("INSERT INTO lake.execution_attempt(window_id, attempt, state) VALUES (?, 1, 'QUEUED') ON CONFLICT DO NOTHING", id);
    return id;
  }

  @Transactional
  public Map<String, Object> claim(String worker, List<String> runtimeRefs) {
    if (runtimeRefs == null || runtimeRefs.isEmpty() || runtimeRefs.size() > 100
        || runtimeRefs.stream().anyMatch(ref -> ref == null || !ref.matches("[a-z][a-z0-9_-]{1,99}"))) bad("WORKER_CAPABILITIES_REQUIRED");
    // Serialize only the short reservation transaction, never the extraction itself.
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(73401921)",Object.class);
    expire(Instant.now());
    retryPending(Instant.now());
    // A current-state snapshot queued before midnight cannot recreate yesterday.
    jdbc.update("""
        UPDATE lake.execution_attempt a SET state = 'CANCELLED', finished_at = clock_timestamp(), error_code = 'HISTORICAL_SNAPSHOT_UNAVAILABLE'
        FROM lake.execution_window w JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        WHERE a.window_id = w.id AND a.state = 'QUEUED' AND NOT v.historical_read
          AND w.business_date < (clock_timestamp() AT TIME ZONE v.timezone)::date
        """);
    jdbc.update("""
        UPDATE lake.execution_window w SET state = 'MISSING', reason = 'HISTORICAL_SNAPSHOT_UNAVAILABLE'
        WHERE w.state IN ('QUEUED','INCOMPLETE') AND EXISTS (SELECT 1 FROM lake.execution_attempt a
          WHERE a.window_id = w.id AND a.error_code = 'HISTORICAL_SNAPSHOT_UNAVAILABLE')
        """);
    String allowed = String.join(",", Collections.nCopies(runtimeRefs.size(), "?"));
    var plans = jdbc.queryForList("""
        SELECT p.id,p.source_id,v.contract FROM lake.ingestion_plan p JOIN lake.plan_version v ON v.plan_id = p.id AND v.version = p.active_version
        WHERE p.state = 'ACTIVE' AND v.runtime_ref IN (%s)
        AND EXISTS (SELECT 1 FROM lake.execution_window w JOIN lake.execution_attempt a ON a.window_id = w.id
          WHERE w.plan_id = p.id AND a.state = 'QUEUED' AND a.not_before <= clock_timestamp() AND w.plan_version = p.active_version)
        AND NOT EXISTS (SELECT 1 FROM lake.execution_window w JOIN lake.execution_attempt a ON a.window_id = w.id
          WHERE w.plan_id = p.id AND a.state = 'RUNNING')
        ORDER BY (SELECT bs.last_claimed_at FROM warehouse.ingest_channel ch JOIN warehouse.ingest_connection cn ON cn.id=ch.connection_id
          JOIN warehouse.system_instance si ON si.id=cn.instance_id JOIN warehouse.business_system bs ON bs.id=si.system_id WHERE ch.source_id=p.source_id) NULLS FIRST,
          p.last_claimed_at NULLS FIRST,p.id FOR UPDATE OF p SKIP LOCKED
        """.formatted(allowed), runtimeRefs.toArray());
    var eligible=new java.util.ArrayList<Map<String,Object>>();
    for(var plan:plans){JsonNode config;try{config=json.readTree(plan.get("contract").toString());}catch(Exception e){throw new IllegalStateException("INVALID_PLAN_CONFIG");}
      String reason=managedRuntime.dispatchReason(((Number)plan.get("source_id")).longValue(),config,worker);
      jdbc.update("UPDATE lake.ingestion_plan SET dispatch_reason=? WHERE id=?",reason,plan.get("id"));
      if(reason==null){eligible.add(plan);break;}
    }
    plans=eligible;
    if (plans.isEmpty()) return Map.of("state", "IDLE");
    var attempt = jdbc.queryForMap("""
        SELECT a.id, a.window_id, a.attempt, w.business_date, w.window_start, w.window_end, w.revision, w.mode, w.processing_input,
          v.kind, v.runtime_ref, v.contract, v.inventory_version, v.timeout_seconds, s.code AS source_code, i.runtime_json AS runtime_inventory
        FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        JOIN lake.ingestion_plan p ON p.id = w.plan_id JOIN control.source_connection s ON s.id = p.source_id
        LEFT JOIN lake.inventory i ON i.source_id = p.source_id AND i.plan_version = v.inventory_version
        WHERE p.id = ? AND w.plan_version = p.active_version AND a.state = 'QUEUED' AND a.not_before <= clock_timestamp()
        ORDER BY w.business_date, w.revision, a.attempt FOR UPDATE OF a LIMIT 1
        """, plans.getFirst().get("id"));
    UUID token = UUID.randomUUID();
    jdbc.update("UPDATE lake.execution_attempt SET state = 'RUNNING', lease_owner = ?, lease_token = ?, lease_expires_at = clock_timestamp() + interval '60 seconds', started_at = clock_timestamp() WHERE id = ?", worker, token, attempt.get("id"));
    jdbc.update("UPDATE lake.execution_window SET state = 'RUNNING' WHERE id = ?", attempt.get("window_id"));
    jdbc.update("UPDATE lake.ingestion_plan SET last_claimed_at=clock_timestamp(),dispatch_reason=NULL WHERE id=?",plans.getFirst().get("id"));
    managedRuntime.markDispatched(((Number)plans.getFirst().get("source_id")).longValue());
    attempt.put("leaseToken", token.toString()); attempt.put("state", "RUNNING"); attempt.put("leaseSeconds", 60);
    decode(attempt, "contract");
    decode(attempt, "processing_input");
    decode(attempt, "runtime_inventory");
    managedRuntime.attach(attempt,worker);
    return attempt;
  }

  @Transactional
  public Map<String, Object> approveSchema(long execution, String reason, String actor) {
    if (reason == null || reason.isBlank() || reason.length() > 300) bad("SCHEMA_REVIEW_REASON_REQUIRED");
    var rows = jdbc.queryForList("""
        SELECT p.id, p.active_version, p.source_id, s.code AS source_code, v.*, a.result,
          old.source_scope AS old_scope, w.plan_version AS execution_plan_version
        FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.ingestion_plan p ON p.id = w.plan_id JOIN control.source_connection s ON s.id = p.source_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        JOIN lake.inventory old ON old.source_id = p.source_id AND old.plan_version = v.inventory_version
        WHERE a.id = ? AND a.state = 'FAILED' AND a.error_code = 'SCHEMA_CHANGE_REVIEW_REQUIRED' AND v.kind = 'MYSQL_SNAPSHOT'
        FOR UPDATE OF p
        """, execution);
    if (rows.isEmpty()) bad("SCHEMA_REVIEW_UNAVAILABLE");
    var p = rows.getFirst();
    var approved = jdbc.queryForList("SELECT plan_version FROM lake.inventory WHERE approved_execution_id = ?", execution);
    if (!approved.isEmpty()) return Map.of("planId", p.get("id"), "version", ((Number) p.get("execution_plan_version")).intValue() + 1, "inventoryVersion", approved.getFirst().get("plan_version"));
    if (!p.get("active_version").equals(p.get("execution_plan_version"))) conflict("PLAN_SUPERSEDED");
    decode(p, "result"); decode(p, "old_scope"); decode(p, "contract");
    if (!(p.get("result") instanceof JsonNode stored) || !stored.path("schemaChange").isObject()) bad("INVALID_SCHEMA_PROPOSAL");
    JsonNode proposal = ((JsonNode) p.get("result")).path("schemaChange");
    JsonNode runtime = proposal.path("proposedInventory");
    RegisterInventoryRequest request;
    try { request = json.treeToValue(proposal.path("inventoryRequest"), RegisterInventoryRequest.class); }
    catch (Exception error) { bad("INVALID_SCHEMA_PROPOSAL"); return Map.of(); }
    if (request == null || !p.get("source_code").equals(request.sourceCode())
        || request.planVersion() != ((Number) p.get("inventory_version")).longValue() + 1
        || runtime.path("plan_version").asLong() != request.planVersion()
        || !runtime.path("source_scope").equals(p.get("old_scope")) || !runtime.path("source_scope").equals(request.sourceScope())
        || !runtime.path("tables").isArray() || request.objects() == null || runtime.path("tables").size() != request.objects().size()) bad("INVALID_SCHEMA_PROPOSAL");
    // Bind the worker contract to the reviewed catalog contract, not a second unchecked schema.
    for (int i = 0; i < request.objects().size(); i++) {
      var object = request.objects().get(i); JsonNode table = runtime.path("tables").get(i);
      if (object == null || object.schema() == null || !object.schema().isObject() || object.objectName() == null
          || !object.objectName().equals(table.path("table").asText()) || !"TABLE".equals(object.objectType())
          || !object.required() || !"FULL_SNAPSHOT".equals(object.strategy())
          || !table.path("columns").equals(object.schema().path("columns"))
          || !table.path("engine").equals(object.schema().path("engine"))
          || !table.path("primary_key").equals(json.valueToTree(object.primaryKey()))) bad("INVALID_SCHEMA_PROPOSAL");
    }
    var inventory = registration.registerInventory(request, actor);
    jdbc.update("UPDATE lake.inventory SET runtime_json = ?::jsonb, approved_execution_id = ? WHERE id = ? AND runtime_json IS NULL", runtime.toString(), execution, inventory.inventoryId());
    ZoneId zone = ZoneId.of(p.get("timezone").toString());
    var saved = savePlan(new LakePlanRequest(request.sourceCode(), ((Number) p.get("active_version")).intValue(), request.planVersion(),
        "MYSQL_SNAPSHOT", p.get("runtime_ref").toString(), (JsonNode) p.get("contract"), zone.toString(),
        ((Time) p.get("trigger_time")).toLocalTime(), LocalDate.now(zone), false,
        ((Number) p.get("max_attempts")).intValue(), ((Number) p.get("timeout_seconds")).intValue()), actor);
    audit(actor, "SCHEMA_CHANGE_APPROVED", "lake/execution/" + execution, Map.of("reason", reason, "inventoryVersion", request.planVersion(), "planVersion", saved.get("version")));
    return Map.of("planId", saved.get("id"), "version", saved.get("version"), "inventoryVersion", request.planVersion());
  }

  @Transactional
  public Map<String, Object> reprocess(long id, String actor) {
    var rows = jdbc.queryForList("""
        SELECT p.id, p.active_version, p.state AS plan_state, v.*, w.business_date, a.result, a.error_code, a.state AS parent_state FROM lake.execution_attempt a
        JOIN lake.execution_window w ON w.id = a.window_id JOIN lake.ingestion_plan p ON p.id = w.plan_id
        JOIN lake.plan_version v ON v.plan_id = p.id AND v.version = p.active_version
        WHERE a.id = ? AND a.state IN ('COMPLETE','FAILED','INCOMPLETE') AND v.kind IN ('FILE_SCAN','REST_PULL')
        FOR UPDATE OF p
        """, id);
    if (rows.isEmpty()) bad("SEALED_INPUT_REPROCESS_UNAVAILABLE");
    var p = rows.getFirst(); decode(p, "result");
    if (!"ACTIVE".equals(p.get("plan_state"))) conflict("PLAN_PAUSED");
    if ("INCOMPLETE".equals(p.get("parent_state")) && !"DELIVERY_PARSE_INCOMPLETE".equals(p.get("error_code"))) conflict("DELIVERY_REVIEW_REQUIRED");
    String batch = p.get("result") instanceof JsonNode result ? result.path("batchId").asText() : "";
    if (batch.isEmpty() && "LEASE_EXPIRED".equals(p.get("error_code"))) batch = "exec-" + id;
    if (!batch.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,119}")) bad("SEALED_INPUT_REPROCESS_UNAVAILABLE");
    LocalDate day = ((Date) p.get("business_date")).toLocalDate();
    var pending = jdbc.queryForList("SELECT id, revision FROM lake.execution_window WHERE plan_id = ? AND plan_version = ? AND state IN ('QUEUED','RUNNING') AND processing_input->>'parentExecutionId' = ? ORDER BY id LIMIT 1", p.get("id"), p.get("active_version"), String.valueOf(id));
    if (!pending.isEmpty()) return Map.of("windowId", pending.getFirst().get("id"), "revision", pending.getFirst().get("revision"));
    int revision = jdbc.queryForObject("SELECT coalesce(max(revision),0)+1 FROM lake.execution_window WHERE plan_id = ? AND plan_version = ? AND business_date = ?", Integer.class, p.get("id"), p.get("active_version"), Date.valueOf(day));
    long window = enqueue(p, day, revision, "MANUAL", "SEALED_INPUT_REPROCESS", false);
    var processing = json.createObjectNode().put("batchId", batch).put("parentExecutionId", id);
    if (p.get("result") instanceof JsonNode result && result.has("signature")) {
      processing.putObject("deliveryEvidence").put("signature", result.path("signature").asText()).put("revision", result.path("revision").asInt());
    }
    jdbc.update("UPDATE lake.execution_window SET processing_input = ?::jsonb WHERE id = ?", processing.toString(), window);
    audit(actor, "SEALED_INPUT_REPROCESS", "lake/window/" + window, Map.of("parentExecutionId", id));
    return Map.of("windowId", window, "revision", revision);
  }

  @Transactional
  public Map<String, Object> heartbeat(long id, UUID token, String worker) {
    var attempt = lease(id, token, worker);
    if ((Boolean) attempt.get("cancel_requested")) return Map.of("state", "CANCEL_REQUESTED");
    jdbc.update("UPDATE lake.execution_attempt SET lease_expires_at = clock_timestamp() + interval '60 seconds' WHERE id = ?", id);
    return Map.of("state", "RUNNING");
  }

  @Transactional
  public Map<String, Object> finish(long id, UUID token, String worker, String state, String code, JsonNode result, RegisterManifestRequest manifest) {
    if (!Set.of("COMPLETE", "INCOMPLETE", "FAILED", "CANCELLED").contains(state == null ? "" : state)) bad("INVALID_EXECUTION_RESULT");
    if (code != null && !code.matches("[A-Z0-9_:-]{1,120}")) bad("INVALID_ERROR_CODE");
    if (result != null && result.toString().length() > 2000000) bad("RESULT_TOO_LARGE");
    var receipt = json.createObjectNode().put("state", state).put("errorCode", code);
    receipt.set("result", result); receipt.set("manifest", json.valueToTree(manifest));
    var prior = jdbc.queryForList("SELECT state, completion FROM lake.execution_attempt WHERE id = ? AND lease_owner = ? AND lease_token = ? FOR UPDATE", id, worker, token);
    if (!prior.isEmpty() && prior.getFirst().get("completion") != null) {
      decode(prior.getFirst(), "completion");
      if (!receipt.equals(prior.getFirst().get("completion"))) conflict("EXECUTION_RESULT_IMMUTABLE");
      return Map.of("id", id, "state", prior.getFirst().get("state"));
    }
    var attempt = lease(id, token, worker);
    if ((Boolean) attempt.get("cancel_requested")) { state = "CANCELLED"; manifest = null; }
    var scope = jdbc.queryForMap("""
        SELECT s.code, v.inventory_version, v.kind, w.window_start, w.window_end FROM lake.execution_window w
        JOIN lake.ingestion_plan p ON p.id = w.plan_id JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        JOIN control.source_connection s ON s.id = p.source_id WHERE w.id = ?
        """, attempt.get("window_id"));
    Long runId = null;
    if ("COMPLETE".equals(state) && "MYSQL_SNAPSHOT".equals(scope.get("kind"))) {
      if (manifest == null || !manifest.sourceCode().equals(scope.get("code"))
          || manifest.planVersion() != ((Number) scope.get("inventory_version")).longValue()
          || !"COMPLETE".equals(manifest.state())) bad("EXECUTION_MANIFEST_REQUIRED");
      if (manifest.scheduledWindowStart() == null || manifest.scheduledWindowEnd() == null
          || !manifest.scheduledWindowStart().toInstant().equals(((java.sql.Timestamp) scope.get("window_start")).toInstant())
          || !manifest.scheduledWindowEnd().toInstant().equals(((java.sql.Timestamp) scope.get("window_end")).toInstant())) bad("EXECUTION_WINDOW_MISMATCH");
      // A successful lease and the visible manifest are committed in one DB transaction.
      runId = registration.registerScheduledManifest(manifest, worker).systemRunId();
    }
    if (!"MYSQL_SNAPSHOT".equals(scope.get("kind")) && !"CANCELLED".equals(state)) {
      assets.register(id, scope.get("code").toString(), scope.get("kind").toString(), result, state);
    }
    jdbc.update("UPDATE lake.execution_attempt SET state = ?, finished_at = clock_timestamp(), lease_expires_at = NULL, error_code = ?, result = ?::jsonb, system_run_id = ?, completion = ?::jsonb WHERE id = ?", state, code, result == null ? "{}" : result.toString(), runId, receipt.toString(), id);
    jdbc.update("UPDATE lake.execution_window SET state = ? WHERE id = ?", state, attempt.get("window_id"));
    audit(worker, "LAKE_EXECUTION_FINISH", "lake/execution/" + id, Map.of("state", state));
    return Map.of("id", id, "state", state);
  }

  @Transactional
  public void cancel(long id, String actor) {
    var a = jdbc.queryForList("SELECT * FROM lake.execution_attempt WHERE id = ? FOR UPDATE", id);
    if (a.isEmpty()) bad("EXECUTION_NOT_FOUND");
    String state = a.getFirst().get("state").toString();
    if (!Set.of("QUEUED", "RUNNING").contains(state)) conflict("EXECUTION_TERMINAL");
    jdbc.update("UPDATE lake.execution_attempt SET cancel_requested = TRUE, state = CASE WHEN state = 'QUEUED' THEN 'CANCELLED' ELSE state END WHERE id = ?", id);
    if (state.equals("QUEUED")) jdbc.update("UPDATE lake.execution_window SET state = 'CANCELLED' WHERE id = ?", a.getFirst().get("window_id"));
    audit(actor, "LAKE_EXECUTION_CANCEL", "lake/execution/" + id, Map.of());
  }

  @Transactional
  public Map<String, Object> retry(long id, String actor) {
    var rows = jdbc.queryForList("""
        SELECT a.*, v.max_attempts, w.plan_version, p.active_version,p.source_id FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        JOIN lake.ingestion_plan p ON p.id = w.plan_id WHERE a.id = ? FOR UPDATE OF a, w
        """, id);
    if (rows.isEmpty()) bad("EXECUTION_NOT_FOUND");
    var a = rows.getFirst();
    if(managedRuntime.sourcePaused(((Number)a.get("source_id")).longValue()))conflict("INGESTION_PAUSED");
    if (!a.get("plan_version").equals(a.get("active_version"))) conflict("PLAN_SUPERSEDED");
    if (!Set.of("FAILED", "INCOMPLETE", "CANCELLED").contains(a.get("state"))) conflict("EXECUTION_NOT_RETRYABLE");
    int next = ((Number) a.get("attempt")).intValue() + 1;
    var repeated = jdbc.queryForList("SELECT id, attempt, state FROM lake.execution_attempt WHERE window_id = ? AND attempt = ?", a.get("window_id"), next);
    if (!repeated.isEmpty()) {
      jdbc.update("UPDATE lake.execution_attempt SET not_before = clock_timestamp() WHERE id = ? AND state = 'QUEUED'", repeated.getFirst().get("id"));
      return repeated.getFirst();
    }
    if (jdbc.queryForObject("SELECT count(*) FROM lake.execution_attempt WHERE window_id = ? AND state = 'FAILED'", Integer.class, a.get("window_id")) >= ((Number) a.get("max_attempts")).intValue()) conflict("EXECUTION_ATTEMPTS_EXHAUSTED");
    jdbc.update("INSERT INTO lake.execution_attempt(window_id, attempt, state) VALUES (?, ?, 'QUEUED') ON CONFLICT DO NOTHING", a.get("window_id"), next);
    jdbc.update("UPDATE lake.execution_window SET state = 'QUEUED' WHERE id = ? AND state <> 'COMPLETE'", a.get("window_id"));
    long nextId = jdbc.queryForObject("SELECT id FROM lake.execution_attempt WHERE window_id = ? AND attempt = ?", Long.class, a.get("window_id"), next);
    audit(actor, "LAKE_EXECUTION_RETRY", "lake/execution/" + nextId, Map.of("previous", id));
    return Map.of("id", nextId, "attempt", next);
  }

  public List<Map<String, Object>> windows(Long plan) {
    return jdbc.queryForList("SELECT w.*, s.code AS source_code FROM lake.execution_window w JOIN lake.ingestion_plan p ON p.id = w.plan_id JOIN control.source_connection s ON s.id = p.source_id WHERE (CAST(? AS BIGINT) IS NULL OR w.plan_id = ?) ORDER BY w.id DESC LIMIT 200", plan, plan);
  }
  public List<Map<String, Object>> attempts(Long plan) {
    var rows = jdbc.queryForList("""
        SELECT a.id, a.window_id, a.attempt, a.state, a.lease_owner, a.lease_expires_at, a.cancel_requested,
          a.started_at, a.finished_at, a.error_code, a.result, a.system_run_id, w.business_date, w.plan_id,
          s.code AS source_code, v.kind FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        JOIN lake.ingestion_plan p ON p.id = w.plan_id JOIN control.source_connection s ON s.id = p.source_id
        WHERE (CAST(? AS BIGINT) IS NULL OR w.plan_id = ?) ORDER BY a.id DESC LIMIT 200
        """, plan, plan);
    rows.forEach(row -> decode(row, "result"));
    return rows;
  }

  private Map<String, Object> lease(long id, UUID token, String worker) {
    var rows = jdbc.queryForList("""
        SELECT a.* FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        WHERE a.id = ? AND a.state = 'RUNNING' AND a.lease_owner = ? AND a.lease_token = ?
          AND a.lease_expires_at > clock_timestamp()
          AND a.started_at + v.timeout_seconds * interval '1 second' > clock_timestamp() FOR UPDATE OF a
        """, id, worker, token);
    if (rows.isEmpty()) conflict("EXECUTION_LEASE_LOST");
    return rows.getFirst();
  }
  private void expire(Instant now) {
    var expired = jdbc.queryForList("""
        UPDATE lake.execution_attempt a SET state = CASE WHEN cancel_requested THEN 'CANCELLED' ELSE 'FAILED' END,
          finished_at = ?, error_code = CASE WHEN cancel_requested THEN 'CANCELLED' ELSE 'LEASE_EXPIRED' END
        FROM lake.execution_window w JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        WHERE a.window_id = w.id AND a.state = 'RUNNING'
          AND (a.lease_expires_at <= ? OR a.started_at + v.timeout_seconds * interval '1 second' <= ?)
        RETURNING a.id, a.window_id, a.state
        """, OffsetDateTime.ofInstant(now, ZoneId.of("UTC")), OffsetDateTime.ofInstant(now, ZoneId.of("UTC")), OffsetDateTime.ofInstant(now, ZoneId.of("UTC")));
    for (var a : expired) {
      jdbc.update("UPDATE lake.execution_window SET state = ? WHERE id = ?", a.get("state"), a.get("window_id"));
    }
  }
  private void retryPending(Instant now) {
    var instant = OffsetDateTime.ofInstant(now, ZoneId.of("UTC"));
    jdbc.update("""
        INSERT INTO lake.execution_attempt(window_id, attempt, state, not_before)
        SELECT a.window_id, a.attempt + 1, 'QUEUED', a.finished_at +
          CASE WHEN a.state = 'INCOMPLETE' THEN coalesce((v.contract->>'pollSeconds')::integer, 300) ELSE 5 * least(a.attempt, 12) END * interval '1 second'
        FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        JOIN lake.ingestion_plan p ON p.id = w.plan_id AND p.active_version = w.plan_version
        WHERE p.state = 'ACTIVE' AND NOT a.cancel_requested
          AND NOT EXISTS (SELECT 1 FROM warehouse.ingest_channel ch JOIN warehouse.ingest_connection c ON c.id=ch.connection_id
            JOIN warehouse.system_instance i ON i.id=c.instance_id JOIN warehouse.business_system s ON s.id=i.system_id
            WHERE ch.source_id=p.source_id AND (ch.lifecycle IN ('PAUSED','RETIRED') OR c.lifecycle IN ('PAUSED','RETIRED')
              OR i.lifecycle IN ('PAUSED','RETIRED') OR s.lifecycle IN ('PAUSED','RETIRED')))
          AND NOT EXISTS (SELECT 1 FROM lake.execution_attempt later WHERE later.window_id = a.window_id AND later.attempt > a.attempt)
          AND (v.historical_read OR w.business_date >= (? AT TIME ZONE v.timezone)::date)
          AND (
            (a.state = 'FAILED' AND a.error_code IN ('LEASE_EXPIRED','WORKER_EXECUTION_FAILED','DISCOVERY_CONNECTION_FAILED',
              'API_REQUEST_FAILED','API_TIMEOUT','API_HTTP_429','API_HTTP_500','API_HTTP_502','API_HTTP_503','API_HTTP_504')
              AND (SELECT count(*) FROM lake.execution_attempt failures WHERE failures.window_id = a.window_id AND failures.state = 'FAILED') < v.max_attempts)
            OR (a.state = 'INCOMPLETE' AND v.kind = 'FILE_SCAN' AND w.processing_input IS NULL
              AND a.result->>'deliveryState' IN ('NOT_OBSERVED','WAITING_READY','DIRECTORY_UNAVAILABLE','OVERDUE','MISSING')
              AND ? < w.window_end + coalesce((v.contract->>'lateDays')::integer, 7) * interval '1 day')
          ) ON CONFLICT DO NOTHING
        """, instant, instant);
  }
  private void rejectSecrets(JsonNode node) {
    if (node.isObject()) node.fields().forEachRemaining(entry -> {
      if (entry.getKey().matches("(?i).*(password|secret|token|credential|cookie|authorization|path|sql|shell).*")) bad("PLAN_REQUIRES_RUNTIME_REFERENCE");
      rejectSecrets(entry.getValue());
    });
    else if (node.isArray()) node.forEach(this::rejectSecrets);
  }
  private void decode(Map<String, Object> row, String key) {
    if (row.get(key) == null) return;
    try { row.put(key, json.readTree(row.get(key).toString())); }
    catch (Exception error) { throw new IllegalStateException("INVALID_STORED_JSON"); }
  }
  private void audit(String actor, String action, String resource, Object details) {
    jdbc.update("INSERT INTO control.audit_log(principal, action, resource, result, details) VALUES (?, ?, ?, 'SUCCESS', ?::jsonb)", actor, action, resource, json.valueToTree(details).toString());
  }
  private static void bad(String code) { throw new ApiException(HttpStatus.BAD_REQUEST, code, code); }
  private static void conflict(String code) { throw new ApiException(HttpStatus.CONFLICT, code, code); }
}
