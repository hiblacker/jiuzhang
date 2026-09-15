package com.bydw.lake;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LakeRegistrationService {
  private static final Pattern CODE = Pattern.compile("^[a-z][a-z0-9._-]{1,99}$");
  private static final Pattern HASH = Pattern.compile("^[0-9a-f]{64}$");
  private static final Pattern NAME = Pattern.compile("^[^/\\\\\\u0000]{1,256}$");
  private static final Pattern RUN_KEY = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$");
  private static final Set<String> OBJECT_TYPES = Set.of("TABLE", "VIEW", "FILE_SET", "API_RESOURCE");
  private static final Set<String> STRATEGIES = Set.of("FULL_SNAPSHOT", "UPDATED_AT_KEYSET", "CDC", "FILE_VERSION", "API_CURSOR");
  private static final Set<String> OBJECT_STATES = Set.of("PENDING", "WAITING_READY", "READING", "RAW_COMMITTED", "PARSED", "FAILED");
  private static final Set<String> RUN_STATES = Set.of("PLANNED", "RUNNING", "COMPLETE", "INCOMPLETE", "FAILED", "CANCELLED");
  private static final Set<String> MODES = Set.of("FULL", "DAILY", "BACKFILL", "FILE_SCAN", "API_PULL");
  private static final Set<String> FORMATS = Set.of("JSONL", "CSV", "XLSX", "JSON", "PARQUET", "API_RESPONSE");

  private final JdbcTemplate jdbc;
  private final ObjectMapper objectMapper;

  public LakeRegistrationService(JdbcTemplate jdbc, ObjectMapper objectMapper) {
    this.jdbc = jdbc;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public LakeInventoryResponse registerInventory(RegisterInventoryRequest request, String principal) {
    if (request == null) bad("INVALID_INVENTORY", "Inventory request is required");
    String sourceCode = validateCode(request.sourceCode());
    if (request.planVersion() < 1 || request.planVersion() > Integer.MAX_VALUE) bad("INVALID_PLAN_VERSION", "planVersion must be positive");
    if (request.observedAt() == null || request.objects() == null || request.objects().isEmpty() || request.objects().size() > 10000) {
      bad("INVALID_INVENTORY", "observedAt and a bounded object list are required");
    }
    if (!validHash(request.schemaSha256())) bad("INVALID_SCHEMA_HASH", "schemaSha256 must be lowercase SHA-256");
    long sourceId = sourceId(sourceCode);
    List<Map<String, Object>> existing = jdbc.queryForList(
        "SELECT id, schema_sha256 FROM lake.inventory WHERE source_id = ? AND plan_version = ?",
        sourceId, request.planVersion());
    if (!existing.isEmpty()) {
      String storedHash = String.valueOf(existing.get(0).get("schema_sha256"));
      if (!storedHash.equals(request.schemaSha256())) {
        throw new ApiException(HttpStatus.CONFLICT, "INVENTORY_VERSION_CONFLICT", "planVersion is already bound to another schema");
      }
      long inventoryId = ((Number) existing.get(0).get("id")).longValue();
      Integer count = jdbc.queryForObject("SELECT count(*) FROM lake.source_object WHERE inventory_id = ?", Integer.class, inventoryId);
      return new LakeInventoryResponse(inventoryId, sourceCode, request.planVersion(), count == null ? 0 : count);
    }
    Set<String> inventoryNames = new HashSet<>();
    for (RegisterInventoryRequest.InventoryObject object : request.objects()) {
      validateInventoryObject(object);
      if (!inventoryNames.add(object.objectName())) bad("INVALID_INVENTORY_OBJECT", "Inventory object names must be unique");
    }
    String scope = request.sourceScope() == null ? "{}" : request.sourceScope().toString();
    Long inventoryId = jdbc.queryForObject("""
        INSERT INTO lake.inventory(source_id, plan_version, observed_at, source_scope, object_count, schema_sha256, state)
        VALUES (?, ?, ?, ?::jsonb, ?, ?, 'ACTIVE') RETURNING id
        """, Long.class, sourceId, request.planVersion(), request.observedAt(), scope, request.objects().size(), request.schemaSha256());
    if (inventoryId == null) throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "INVENTORY_NOT_CREATED", "Inventory was not created");
    for (RegisterInventoryRequest.InventoryObject object : request.objects()) {
      jdbc.update("""
          INSERT INTO lake.source_object(inventory_id, object_name, object_type, schema_json, primary_key_json, required, strategy, state)
          VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?)
          """, inventoryId, object.objectName(), object.objectType(), json(object.schema()), json(object.primaryKey() == null ? List.of() : object.primaryKey()), object.required(), object.strategy(), object.state());
    }
    audit(principal, "LAKE_INVENTORY_REGISTER", "lake/inventory/" + inventoryId, "{}");
    return new LakeInventoryResponse(inventoryId, sourceCode, request.planVersion(), request.objects().size());
  }

  @Transactional
  public LakeManifestResponse registerManifest(RegisterManifestRequest request, String principal) {
    if (request == null) bad("INVALID_MANIFEST", "Manifest request is required");
    String sourceCode = validateCode(request.sourceCode());
    if (request.planVersion() < 1 || request.runKey() == null || !RUN_KEY.matcher(request.runKey()).matches()) bad("INVALID_RUN_KEY", "runKey is invalid");
    if (!MODES.contains(request.mode()) || !RUN_STATES.contains(request.state())) bad("INVALID_RUN_CONTRACT", "mode or state is invalid");
    if (request.attempt() < 1 || request.revision() < 1 || request.objects() == null || request.objects().isEmpty()) bad("INVALID_MANIFEST", "attempt, revision and objects are required");
    long sourceId = sourceId(sourceCode);
    Map<String, SourceObject> sourceObjects = sourceObjects(sourceId, request.planVersion());
    if (sourceObjects.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "INVENTORY_NOT_REGISTERED", "Register the inventory before the manifest");
    Set<String> seen = new HashSet<>();
    for (RegisterManifestRequest.ManifestObject object : request.objects()) {
      validateManifestObject(object);
      if (!seen.add(object.objectName()) || !sourceObjects.containsKey(object.objectName())) bad("MANIFEST_OBJECT_INVALID", "Object is duplicated or absent from the inventory");
    }
    if ("COMPLETE".equals(request.state())) {
      for (SourceObject object : sourceObjects.values()) {
        if (object.required() && (!seen.contains(object.name()) || !"RAW_COMMITTED".equals(request.objects().stream().filter(item -> item.objectName().equals(object.name())).findFirst().orElseThrow().state()))) {
          throw new ApiException(HttpStatus.CONFLICT, "REQUIRED_OBJECT_INCOMPLETE", "A required object is not committed");
        }
      }
    }
    Long runId = existingRun(sourceId, request);
    if (runId == null) {
      runId = jdbc.queryForObject("""
          INSERT INTO lake.system_run(source_id, plan_version, run_key, scheduled_window_start, scheduled_window_end,
              mode, attempt, revision, state, consistency, started_at, finished_at, error_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
          """, Long.class, sourceId, request.planVersion(), request.runKey(), request.scheduledWindowStart(), request.scheduledWindowEnd(), request.mode(), request.attempt(), request.revision(), request.state(), request.consistency(), request.startedAt(), request.finishedAt(), request.errorCode());
    } else {
      Map<String, Object> current = jdbc.queryForMap("SELECT state FROM lake.system_run WHERE id = ? FOR UPDATE", runId);
      if ("COMPLETE".equals(current.get("state")) && !"COMPLETE".equals(request.state())) {
        throw new ApiException(HttpStatus.CONFLICT, "COMPLETE_RUN_IMMUTABLE", "A complete run cannot be downgraded");
      }
      jdbc.update("""
          UPDATE lake.system_run SET state = ?, consistency = ?, scheduled_window_start = ?, scheduled_window_end = ?,
              started_at = ?, finished_at = ?, error_code = ? WHERE id = ?
          """, request.state(), request.consistency(), request.scheduledWindowStart(), request.scheduledWindowEnd(), request.startedAt(), request.finishedAt(), request.errorCode(), runId);
    }
    long totalRows = 0;
    for (RegisterManifestRequest.ManifestObject object : request.objects()) {
      SourceObject sourceObject = sourceObjects.get(object.objectName());
      jdbc.update("""
          INSERT INTO lake.object_run(system_run_id, source_object_id, state, row_count, byte_count,
              source_started_at, source_finished_at, raw_path, raw_sha256, schema_sha256, error_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (system_run_id, source_object_id) DO UPDATE SET state = EXCLUDED.state,
              row_count = EXCLUDED.row_count, byte_count = EXCLUDED.byte_count,
              source_started_at = EXCLUDED.source_started_at, source_finished_at = EXCLUDED.source_finished_at,
              raw_path = EXCLUDED.raw_path, raw_sha256 = EXCLUDED.raw_sha256,
              schema_sha256 = EXCLUDED.schema_sha256, error_code = EXCLUDED.error_code
          """, runId, sourceObject.id(), object.state(), object.rowCount(), object.byteCount(), request.startedAt(), request.finishedAt(), object.rawPath(), object.rawSha256(), object.schemaSha256(), "FAILED".equals(object.state()) ? request.errorCode() : null);
      totalRows += object.rowCount();
      if ("RAW_COMMITTED".equals(object.state()) && object.rawPath() != null) {
        Long objectRunId = jdbc.queryForObject("SELECT id FROM lake.object_run WHERE system_run_id = ? AND source_object_id = ?", Long.class, runId, sourceObject.id());
        jdbc.update("""
            INSERT INTO lake.raw_object(object_run_id, object_version, storage_path, format, byte_count, row_count, sha256, state)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'COMMITTED') ON CONFLICT (object_run_id, object_version) DO NOTHING
            """, objectRunId, objectVersion(request.runKey(), object.objectName()), object.rawPath(), object.format(), object.byteCount(), object.rowCount(), object.rawSha256());
      }
    }
    if ("COMPLETE".equals(request.state())) {
      jdbc.update("""
          INSERT INTO lake.active_run(source_id, run_id, revision) VALUES (?, ?, ?)
          ON CONFLICT (source_id) DO UPDATE SET run_id = EXCLUDED.run_id, revision = EXCLUDED.revision, updated_at = clock_timestamp()
          WHERE EXCLUDED.revision >= lake.active_run.revision
          """, sourceId, runId, request.revision());
    }
    audit(principal, "LAKE_MANIFEST_REGISTER", "lake/system-run/" + runId, "{}");
    return new LakeManifestResponse(runId, sourceCode, request.runKey(), request.state(), request.objects().size(), totalRows);
  }

  private Long existingRun(long sourceId, RegisterManifestRequest request) {
    List<Long> ids = jdbc.query("""
        SELECT id FROM lake.system_run WHERE source_id = ? AND plan_version = ? AND run_key = ? AND attempt = ? AND revision = ?
        """, (rs, row) -> rs.getLong("id"), sourceId, request.planVersion(), request.runKey(), request.attempt(), request.revision());
    return ids.isEmpty() ? null : ids.get(0);
  }

  private Map<String, SourceObject> sourceObjects(long sourceId, long planVersion) {
    Map<String, SourceObject> result = new HashMap<>();
    jdbc.query("""
        SELECT so.id, so.object_name, so.required FROM lake.source_object so
        JOIN lake.inventory i ON i.id = so.inventory_id
        WHERE i.source_id = ? AND i.plan_version = ? AND i.state = 'ACTIVE'
        """, (rs, rowNum) -> new SourceObject(rs.getLong("id"), rs.getString("object_name"), rs.getBoolean("required")), sourceId, planVersion)
        .forEach(object -> result.put(object.name(), object));
    return result;
  }

  private long sourceId(String sourceCode) {
    try { return jdbc.queryForObject("SELECT id FROM control.source_connection WHERE code = ?", Long.class, sourceCode); }
    catch (EmptyResultDataAccessException exception) { throw new ApiException(HttpStatus.NOT_FOUND, "SOURCE_NOT_FOUND", "Source is not registered"); }
  }

  private void validateInventoryObject(RegisterInventoryRequest.InventoryObject object) {
    if (object == null || object.objectName() == null || !NAME.matcher(object.objectName()).matches()
        || !OBJECT_TYPES.contains(object.objectType()) || object.schema() == null
        || !STRATEGIES.contains(object.strategy()) || !Set.of("READY", "BLOCKED", "DISABLED").contains(object.state())) {
      bad("INVALID_INVENTORY_OBJECT", "Inventory object has an invalid contract");
    }
  }

  private void validateManifestObject(RegisterManifestRequest.ManifestObject object) {
    if (object == null || object.objectName() == null || !NAME.matcher(object.objectName()).matches()
        || !OBJECT_STATES.contains(object.state()) || object.rowCount() < 0 || object.byteCount() < 0) bad("MANIFEST_OBJECT_INVALID", "Manifest object has an invalid contract");
    if (object.rawSha256() != null && !validHash(object.rawSha256())) bad("MANIFEST_HASH_INVALID", "rawSha256 is invalid");
    if (object.schemaSha256() != null && !validHash(object.schemaSha256())) bad("MANIFEST_HASH_INVALID", "schemaSha256 is invalid");
    if (object.rawPath() != null && (object.rawPath().startsWith("/") || object.rawPath().matches("^[A-Za-z]:[\\\\/].*"))) bad("MANIFEST_PATH_INVALID", "rawPath must be relative");
    if (object.rawPath() != null && object.rawPath().split("[/\\\\]").length > 0 && List.of(object.rawPath().split("[/\\\\]")).contains("..")) bad("MANIFEST_PATH_INVALID", "rawPath cannot traverse directories");
    if ("RAW_COMMITTED".equals(object.state()) && (object.rawPath() == null || !validHash(object.rawSha256()) || !FORMATS.contains(object.format()))) bad("MANIFEST_RAW_CONTRACT_INVALID", "Committed raw objects require path, hash and format");
  }

  private String objectVersion(String runKey, String name) {
    String digest = hex(name).substring(0, 16);
    return runKey.substring(0, Math.min(runKey.length(), 140)) + ":" + digest;
  }

  private String validateCode(String value) {
    if (value == null || !CODE.matcher(value).matches()) bad("INVALID_SOURCE_CODE", "sourceCode has an invalid format");
    return value;
  }

  private boolean validHash(String value) { return value != null && HASH.matcher(value).matches(); }

  private String json(Object value) {
    try { return objectMapper.writeValueAsString(value); }
    catch (JsonProcessingException exception) { throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "JSON field is not serializable"); }
  }

  private String hex(String value) {
    try { return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception exception) { throw new IllegalStateException("SHA-256 unavailable", exception); }
  }

  private String hex(byte[] bytes) {
    StringBuilder output = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) output.append(String.format("%02x", value));
    return output.toString();
  }

  private void audit(String principal, String action, String resource, String details) {
    jdbc.update("INSERT INTO control.audit_log(principal, action, resource, result, details) VALUES (?, ?, ?, 'SUCCESS', ?::jsonb)", principal == null ? "unknown" : principal, action, resource, details);
  }

  private void bad(String code, String message) { throw new ApiException(HttpStatus.BAD_REQUEST, code, message); }

  private record SourceObject(long id, String name, boolean required) {}
}
