package com.bydw.lake;

import com.bydw.api.ApiException;
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
  private static final Set<String> KINDS = Set.of("MYSQL_SNAPSHOT", "FILE_SCAN", "REST_PULL");
  public LakeExecutionService(JdbcTemplate jdbc, ObjectMapper json, LakeRegistrationService registration) {
    this.jdbc = jdbc; this.json = json; this.registration = registration;
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
    int created = 0;
    for (var plan : jdbc.queryForList("""
        SELECT p.id, p.active_version, v.* FROM lake.ingestion_plan p JOIN lake.plan_version v
          ON v.plan_id = p.id AND v.version = p.active_version WHERE p.state = 'ACTIVE'
        ORDER BY p.id FOR UPDATE OF p SKIP LOCKED LIMIT 200
        """)) {
      ZoneId zone = ZoneId.of(plan.get("timezone").toString());
      LocalDate today = now.atZone(zone).toLocalDate();
      LocalTime trigger = ((Time) plan.get("trigger_time")).toLocalTime();
      LocalDate due = now.atZone(zone).toLocalTime().isBefore(trigger) ? today.minusDays(1) : today;
      // Find actual gaps, including ones older than a manually triggered day.
      var dates = jdbc.queryForList("""
          SELECT day::date AS day FROM generate_series(?::date, ?::date, interval '1 day') day
          WHERE NOT EXISTS (SELECT 1 FROM lake.execution_window w WHERE w.plan_id = ?
            AND w.plan_version = ? AND w.business_date = day::date AND w.revision = 1)
          ORDER BY day LIMIT 31
          """, plan.get("start_date"), Date.valueOf(due), plan.get("id"), plan.get("active_version"));
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
        SELECT p.id, p.active_version, v.* FROM lake.ingestion_plan p JOIN lake.plan_version v
        ON v.plan_id = p.id AND v.version = p.active_version WHERE p.id = ? FOR UPDATE OF p
        """, planId);
    if (plans.isEmpty()) bad("PLAN_NOT_FOUND");
    var p = plans.getFirst();
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
    expire(Instant.now());
    String allowed = String.join(",", Collections.nCopies(runtimeRefs.size(), "?"));
    var plans = jdbc.queryForList("""
        SELECT p.id FROM lake.ingestion_plan p JOIN lake.plan_version v ON v.plan_id = p.id AND v.version = p.active_version
        WHERE p.state = 'ACTIVE' AND v.runtime_ref IN (%s)
        AND EXISTS (SELECT 1 FROM lake.execution_window w JOIN lake.execution_attempt a ON a.window_id = w.id
          WHERE w.plan_id = p.id AND a.state = 'QUEUED' AND a.not_before <= clock_timestamp() AND w.plan_version = p.active_version)
        AND NOT EXISTS (SELECT 1 FROM lake.execution_window w JOIN lake.execution_attempt a ON a.window_id = w.id
          WHERE w.plan_id = p.id AND a.state = 'RUNNING')
        ORDER BY p.id FOR UPDATE OF p SKIP LOCKED LIMIT 1
        """.formatted(allowed), runtimeRefs.toArray());
    if (plans.isEmpty()) return Map.of("state", "IDLE");
    var attempt = jdbc.queryForMap("""
        SELECT a.id, a.window_id, a.attempt, w.business_date, w.window_start, w.window_end, w.revision, w.mode,
          v.kind, v.runtime_ref, v.contract, v.inventory_version, v.timeout_seconds, s.code AS source_code
        FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        JOIN lake.ingestion_plan p ON p.id = w.plan_id JOIN control.source_connection s ON s.id = p.source_id
        WHERE p.id = ? AND w.plan_version = p.active_version AND a.state = 'QUEUED' AND a.not_before <= clock_timestamp()
        ORDER BY w.business_date, w.revision, a.attempt FOR UPDATE OF a LIMIT 1
        """, plans.getFirst().get("id"));
    UUID token = UUID.randomUUID();
    jdbc.update("UPDATE lake.execution_attempt SET state = 'RUNNING', lease_owner = ?, lease_token = ?, lease_expires_at = clock_timestamp() + interval '60 seconds', started_at = clock_timestamp() WHERE id = ?", worker, token, attempt.get("id"));
    jdbc.update("UPDATE lake.execution_window SET state = 'RUNNING' WHERE id = ?", attempt.get("window_id"));
    attempt.put("leaseToken", token.toString()); attempt.put("state", "RUNNING"); attempt.put("leaseSeconds", 60);
    decode(attempt, "contract");
    return attempt;
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
    if (result != null && result.toString().length() > 20000) bad("RESULT_TOO_LARGE");
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
        SELECT a.*, v.max_attempts FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version WHERE a.id = ? FOR UPDATE OF a, w
        """, id);
    if (rows.isEmpty()) bad("EXECUTION_NOT_FOUND");
    var a = rows.getFirst();
    if (!Set.of("FAILED", "INCOMPLETE", "CANCELLED").contains(a.get("state"))) conflict("EXECUTION_NOT_RETRYABLE");
    int next = ((Number) a.get("attempt")).intValue() + 1;
    var repeated = jdbc.queryForList("SELECT id, attempt, state FROM lake.execution_attempt WHERE window_id = ? AND attempt = ?", a.get("window_id"), next);
    if (!repeated.isEmpty()) {
      jdbc.update("UPDATE lake.execution_attempt SET not_before = clock_timestamp() WHERE id = ? AND state = 'QUEUED'", repeated.getFirst().get("id"));
      return repeated.getFirst();
    }
    if (next > ((Number) a.get("max_attempts")).intValue()) conflict("EXECUTION_ATTEMPTS_EXHAUSTED");
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
          s.code AS source_code FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
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
        UPDATE lake.execution_attempt SET state = CASE WHEN cancel_requested THEN 'CANCELLED' ELSE 'FAILED' END,
          finished_at = ?, error_code = CASE WHEN cancel_requested THEN 'CANCELLED' ELSE 'LEASE_EXPIRED' END
        WHERE state = 'RUNNING' AND lease_expires_at <= ? RETURNING id, window_id, state
        """, OffsetDateTime.ofInstant(now, ZoneId.of("UTC")), OffsetDateTime.ofInstant(now, ZoneId.of("UTC")));
    for (var a : expired) {
      jdbc.update("UPDATE lake.execution_window SET state = ? WHERE id = ?", a.get("state"), a.get("window_id"));
      if ("FAILED".equals(a.get("state"))) retryExpired(((Number) a.get("id")).longValue());
    }
  }
  private void retryExpired(long id) {
    var allowed = jdbc.queryForList("""
        INSERT INTO lake.execution_attempt(window_id, attempt, state, not_before)
        SELECT a.window_id, a.attempt + 1, 'QUEUED', clock_timestamp() + (5 * a.attempt) * interval '1 second'
        FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
        JOIN lake.plan_version v ON v.plan_id = w.plan_id AND v.version = w.plan_version
        WHERE a.id = ? AND a.attempt < v.max_attempts ON CONFLICT DO NOTHING RETURNING window_id
        """, id);
    for (var row : allowed) jdbc.update("UPDATE lake.execution_window SET state = 'QUEUED' WHERE id = ?", row.get("window_id"));
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
