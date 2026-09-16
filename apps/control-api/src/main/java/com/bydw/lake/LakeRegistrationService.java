package com.bydw.lake;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(?)", Object.class, sourceId);
    List<Map<String, Object>> existing = jdbc.queryForList(
        "SELECT id, schema_sha256, contract_json::text AS contract_json FROM lake.inventory WHERE source_id = ? AND plan_version = ?",
        sourceId, request.planVersion());
    if (!existing.isEmpty()) {
      String storedHash = String.valueOf(existing.get(0).get("schema_sha256"));
      if (!storedHash.equals(request.schemaSha256()) || !sameJson(existing.get(0).get("contract_json"), json(request))) {
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
        INSERT INTO lake.inventory(source_id, plan_version, observed_at, source_scope, object_count, schema_sha256, state, contract_json)
        VALUES (?, ?, ?, ?::jsonb, ?, ?, 'ACTIVE', ?::jsonb) RETURNING id
        """, Long.class, sourceId, request.planVersion(), request.observedAt(), scope, request.objects().size(), request.schemaSha256(), json(request));
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
    validateCode(request.sourceCode());
    if (jdbc.queryForObject("SELECT count(*) FROM lake.ingestion_plan p JOIN control.source_connection s ON s.id = p.source_id WHERE s.code = ?", Long.class, request.sourceCode()) > 0) {
      throw new ApiException(HttpStatus.CONFLICT, "SCHEDULED_SOURCE_REQUIRES_EXECUTION", "Scheduled sources must commit with an active execution lease");
    }
    return registerScheduledManifest(request, principal);
  }

  @Transactional
  public LakeManifestResponse registerScheduledManifest(RegisterManifestRequest request, String principal) {
    if (request == null) bad("INVALID_MANIFEST", "Manifest request is required");
    String sourceCode = validateCode(request.sourceCode());
    if (request.planVersion() < 1 || request.runKey() == null || !RUN_KEY.matcher(request.runKey()).matches()) bad("INVALID_RUN_KEY", "runKey is invalid");
    if (request.mode() == null || request.state() == null || !MODES.contains(request.mode()) || !RUN_STATES.contains(request.state())) bad("INVALID_RUN_CONTRACT", "mode or state is invalid");
    if (request.attempt() < 1 || request.revision() < 1 || request.objects() == null || request.objects().isEmpty() || request.objects().size() > 10000) bad("INVALID_MANIFEST", "attempt, revision and objects are required");
    if (request.startedAt() == null || (request.finishedAt() != null && request.finishedAt().isBefore(request.startedAt()))
        || ("COMPLETE".equals(request.state()) && request.finishedAt() == null)
        || (request.scheduledWindowStart() == null) != (request.scheduledWindowEnd() == null)
        || (request.scheduledWindowStart() != null && !request.scheduledWindowStart().isBefore(request.scheduledWindowEnd()))) {
      bad("INVALID_RUN_TIMES", "A complete run needs timestamps and half-open windows");
    }
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
    Long runId;
    try {
      runId = jdbc.queryForObject("SELECT lake.register_manifest(?::jsonb, ?)", Long.class, json(request), principal);
    } catch (org.springframework.dao.DataAccessException error) {
      for (String code : List.of("LAKE_RUN_IMMUTABLE", "LAKE_RAW_OBJECT_IMMUTABLE", "LAKE_REQUIRED_OBJECT_INCOMPLETE")) {
        if (error.getMostSpecificCause().getMessage().contains(code)) {
          throw new ApiException(HttpStatus.CONFLICT, code, "Manifest conflicts with committed evidence");
        }
      }
      throw error;
    }
    long totalRows = request.objects().stream().mapToLong(RegisterManifestRequest.ManifestObject::rowCount).sum();
    return new LakeManifestResponse(runId, sourceCode, request.runKey(), request.state(), request.objects().size(), totalRows);
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
        || object.objectType() == null || !OBJECT_TYPES.contains(object.objectType()) || object.schema() == null
        || object.strategy() == null || object.state() == null || !STRATEGIES.contains(object.strategy()) || !Set.of("READY", "BLOCKED", "DISABLED").contains(object.state())) {
      bad("INVALID_INVENTORY_OBJECT", "Inventory object has an invalid contract");
    }
  }

  private void validateManifestObject(RegisterManifestRequest.ManifestObject object) {
    if (object == null || object.objectName() == null || !NAME.matcher(object.objectName()).matches()
        || object.state() == null || !OBJECT_STATES.contains(object.state()) || object.rowCount() < 0 || object.byteCount() < 0) bad("MANIFEST_OBJECT_INVALID", "Manifest object has an invalid contract");
    if (object.rawSha256() != null && !validHash(object.rawSha256())) bad("MANIFEST_HASH_INVALID", "rawSha256 is invalid");
    if (object.schemaSha256() != null && !validHash(object.schemaSha256())) bad("MANIFEST_HASH_INVALID", "schemaSha256 is invalid");
    if (object.rawPath() != null && (object.rawPath().startsWith("/") || object.rawPath().matches("^[A-Za-z]:[\\\\/].*"))) bad("MANIFEST_PATH_INVALID", "rawPath must be relative");
    if (object.rawPath() != null && object.rawPath().split("[/\\\\]").length > 0 && List.of(object.rawPath().split("[/\\\\]")).contains("..")) bad("MANIFEST_PATH_INVALID", "rawPath cannot traverse directories");
    if ("RAW_COMMITTED".equals(object.state()) && (object.rawPath() == null || !validHash(object.rawSha256()) || object.format() == null || !validHash(object.schemaSha256()) || !FORMATS.contains(object.format()))) bad("MANIFEST_RAW_CONTRACT_INVALID", "Committed raw objects require path, hash and format");
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

  private boolean sameJson(Object stored, String incoming) {
    if (stored == null) return false;
    try { return objectMapper.readTree(stored.toString()).equals(objectMapper.readTree(incoming)); }
    catch (JsonProcessingException error) { return false; }
  }

  private void audit(String principal, String action, String resource, String details) {
    jdbc.update("INSERT INTO control.audit_log(principal, action, resource, result, details) VALUES (?, ?, ?, 'SUCCESS', ?::jsonb)", principal == null ? "unknown" : principal, action, resource, details);
  }

  private void bad(String code, String message) { throw new ApiException(HttpStatus.BAD_REQUEST, code, message); }

  private record SourceObject(long id, String name, boolean required) {}
}
