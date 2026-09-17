package com.bydw.warehouse;

import static com.bydw.warehouse.SystemCatalogService.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Typed datasources and their connection tests. A test is executed by a worker (the only
 * component that can reach the source) and must prove reachability AND that the account
 * cannot write: a successful SELECT alone is not evidence of a read-only account.
 */
@Service
public class DataSourceService {
  /** Access families that carry a SQL dialect. FILE_SCAN and REST_PULL must not. */
  static final Set<String> DATABASE_KINDS = Set.of("MYSQL_SNAPSHOT");
  static final Set<String> DATASOURCE_TYPES = Set.of(
      "MYSQL", "POSTGRESQL", "ORACLE", "SQLSERVER", "CLICKHOUSE", "DORIS", "STARROCKS", "TIDB");
  /** Non-secret connection keys; anything credential-shaped is rejected on purpose. */
  static final Set<String> CONFIG_KEYS = Set.of("host", "port", "database", "charset", "sslmode", "timezone");

  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final ProductAccessService access;
  private final SystemCatalogService systems;

  public DataSourceService(JdbcTemplate jdbc, ObjectMapper json, ProductAccessService access, SystemCatalogService systems) {
    this.jdbc = jdbc; this.json = json; this.access = access; this.systems = systems;
  }

  /** Attaches the datasource fields to an already approved resource (admin only). */
  @Transactional public Object configure(long resource, JsonNode b, String actor) {
    access.requireAdmin(actor);
    var rows = jdbc.queryForList("SELECT * FROM warehouse.ingest_resource WHERE id=? FOR UPDATE", resource);
    if (rows.isEmpty()) bad("RESOURCE_NOT_FOUND");
    var row = rows.getFirst();
    String kind = row.get("kind").toString();
    String datasourceType = text(b, "datasourceType", 30, true).toUpperCase(java.util.Locale.ROOT);
    if (!DATABASE_KINDS.contains(kind)) bad("DATASOURCE_TYPE_NOT_APPLICABLE");
    if (!DATASOURCE_TYPES.contains(datasourceType)) bad("DATASOURCE_TYPE_NOT_APPROVED");
    JsonNode config = b.path("config");
    if (!config.isObject()) bad("INVALID_DATASOURCE_CONFIG");
    config.fieldNames().forEachRemaining(key -> {
      if (!CONFIG_KEYS.contains(key)) bad("DATASOURCE_CONFIG_FIELD_NOT_ALLOWED");
      if (key.matches("(?i).*(token|auth|key|secret|password|cookie|user).*")) bad("SECRET_VALUE_FORBIDDEN");
    });
    text(config, "host", 200, true);
    int port = config.path("port").isIntegralNumber() ? config.path("port").asInt() : 0;
    if (port < 1 || port > 65535) bad("INVALID_DATASOURCE_PORT");
    text(config, "database", 128, true);
    String charset = config.path("charset").asText("utf8mb4");
    if (!List.of("utf8mb4", "utf8", "utf8mb3", "latin1", "gb18030").contains(charset)) bad("INVALID_DATASOURCE_CHARSET");
    String credentialRef = text(b, "credentialRef", 80, true);
    if (!credentialRef.matches("[a-z][a-z0-9_-]{1,60}")) bad("INVALID_CREDENTIAL_REF");
    for (String field : List.of("allowedSchemas", "allowedTables")) {
      if (!b.path(field).isArray() || b.path(field).size() > 2000) bad("INVALID_DATASOURCE_SCOPE");
      for (JsonNode item : b.path(field)) if (!item.isTextual() || item.asText().isBlank() || item.asText().length() > 128) bad("INVALID_DATASOURCE_SCOPE");
    }
    long timeout = b.path("statementTimeoutMs").isIntegralNumber() ? b.path("statementTimeoutMs").asLong() : 3600000L;
    if (timeout < 1000 || timeout > 86400000L) bad("INVALID_STATEMENT_TIMEOUT");
    jdbc.update("""
        UPDATE warehouse.ingest_resource SET datasource_type=?,config=?::jsonb,credential_ref=?,
          statement_timeout_ms=?,allowed_schemas=?::jsonb,allowed_tables=?::jsonb WHERE id=?
        """, datasourceType, config.toString(), credentialRef, timeout,
        b.path("allowedSchemas").toString(), b.path("allowedTables").toString(), resource);
    systems.audit(actor, "DATASOURCE_CONFIGURE", resource, Map.of("datasourceType", datasourceType));
    return detail(resource, actor);
  }

  public Object detail(long resource, String actor) {
    access.requireAdmin(actor);
    var rows = jdbc.queryForList("SELECT * FROM warehouse.ingest_resource WHERE id=?", resource);
    if (rows.isEmpty()) bad("RESOURCE_NOT_FOUND");
    var row = rows.getFirst();
    for (String field : List.of("allowed_schemas", "allowed_tables", "config", "last_test_detail")) decode(row, field);
    return row;
  }

  /** Queues a connection test; the caller gets a request it can poll. */
  @Transactional public Object requestTest(long resource, JsonNode b, String actor) {
    access.requireAdmin(actor);
    var rows = jdbc.queryForList("SELECT * FROM warehouse.ingest_resource WHERE id=? AND enabled", resource);
    if (rows.isEmpty()) bad("RESOURCE_NOT_FOUND");
    var row = rows.getFirst();
    if (row.get("datasource_type") == null) bad("DATASOURCE_NOT_CONFIGURED");
    if (row.get("credential_ref") == null) bad("DATASOURCE_CREDENTIAL_REQUIRED");
    String requestKey = text(b, "requestKey", 100, true);
    jdbc.update("""
        INSERT INTO warehouse.resource_test_request(resource_id,environment_code,state,requested_by,request_key)
        VALUES (?,?,'QUEUED',?,?) ON CONFLICT(resource_id,request_key) DO NOTHING
        """, resource, row.get("environment_code"), actor, requestKey);
    var created = jdbc.queryForMap("SELECT * FROM warehouse.resource_test_request WHERE resource_id=? AND request_key=?", resource, requestKey);
    decode(created, "last_test_detail");
    return created;
  }

  public Object tests(long resource, String actor) {
    access.requireAdmin(actor);
    return jdbc.queryForList("""
        SELECT id,resource_id,environment_code,state,server_version,server_timezone,readable_schema_count,
               read_only_verified,latency_ms,error_code,requested_by,created_at,finished_at
          FROM warehouse.resource_test_request WHERE resource_id=? ORDER BY id DESC LIMIT 20
        """, resource);
  }

  /** Worker claim: one queued test for the worker's environment. */
  @Transactional public Object claimTest(String environment, String actor) {
    if (environment == null || !environment.matches("[a-z][a-z0-9_-]{1,70}")) bad("INVALID_ENVIRONMENT");
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(73401931)", Object.class);
    // A preview or test takes seconds; anything RUNNING for ten minutes belongs to a dead worker.
    jdbc.update("""
        UPDATE warehouse.resource_test_request SET state='FAILED',error_code='TEST_LEASE_EXPIRED',finished_at=clock_timestamp()
        WHERE state='RUNNING' AND created_at < clock_timestamp()-interval '10 minutes'
        """);
    var rows = jdbc.queryForList("""
        SELECT t.id AS request_id, r.* FROM warehouse.resource_test_request t
        JOIN warehouse.ingest_resource r ON r.id=t.resource_id
        WHERE t.state='QUEUED' AND r.environment_code=? AND r.enabled
        ORDER BY t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1
        """, environment);
    if (rows.isEmpty()) return Map.of("state", "IDLE");
    var row = rows.getFirst();
    long requestId = ((Number) row.get("request_id")).longValue();
    jdbc.update("UPDATE warehouse.resource_test_request SET state='RUNNING' WHERE id=?", requestId);
    jdbc.update("UPDATE warehouse.execution_environment SET last_seen_at=clock_timestamp() WHERE code=?", environment);
    var result = new java.util.LinkedHashMap<String, Object>();
    result.put("id", requestId);
    result.put("state", "RUNNING");
    result.put("resourceId", row.get("id"));
    result.put("resourceCode", row.get("code"));
    result.put("datasourceType", row.get("datasource_type"));
    result.put("credentialRef", row.get("credential_ref"));
    result.put("statementTimeoutMs", row.get("statement_timeout_ms"));
    result.put("allowedSchemas", tree(row.get("allowed_schemas")));
    result.put("config", tree(row.get("config")));
    return result;
  }

  /** Worker result. PASSED requires the read-only proof; FAILED requires an error code. */
  private JsonNode tree(Object value) {
    try { return value == null ? json.nullNode() : json.readTree(value.toString()); }
    catch (Exception error) { throw new IllegalStateException("INVALID_STORED_JSON"); }
  }

  private void decode(Map<String, Object> row, String field) {
    if (row.containsKey(field) && row.get(field) != null) row.put(field, tree(row.get(field)));
  }

  @Transactional public Object finishTest(long id, JsonNode b, String actor) {
    String state = text(b, "state", 20, true);
    if (!List.of("PASSED", "FAILED").contains(state)) bad("INVALID_TEST_STATE");
    var rows = jdbc.queryForList("SELECT * FROM warehouse.resource_test_request WHERE id=? FOR UPDATE", id);
    if (rows.isEmpty()) bad("TEST_NOT_FOUND");
    var row = rows.getFirst();
    if ("PASSED".equals(row.get("state"))) return Map.of("id", id, "state", "PASSED");
    if (!"RUNNING".equals(row.get("state"))) conflict("TEST_NOT_RUNNING");
    String error = b.path("errorCode").asText("");
    if (!error.isEmpty() && !error.matches("[A-Z0-9_:-]{1,120}")) bad("INVALID_TEST_ERROR");
    boolean readOnly = b.path("readOnlyVerified").asBoolean(false);
    if ("PASSED".equals(state) && !readOnly) bad("READ_ONLY_PROOF_REQUIRED");
    jdbc.update("""
        UPDATE warehouse.resource_test_request SET state=?,server_version=?,server_timezone=?,readable_schema_count=?,
          read_only_verified=?,latency_ms=?,error_code=?,finished_at=clock_timestamp() WHERE id=?
        """, state, b.path("serverVersion").asText(null), b.path("serverTimezone").asText(null),
        b.path("readableSchemaCount").isIntegralNumber() ? b.path("readableSchemaCount").asInt() : null,
        readOnly, b.path("latencyMs").isIntegralNumber() ? b.path("latencyMs").asInt() : null,
        error.isEmpty() ? null : error, id);
    jdbc.update("""
        UPDATE warehouse.ingest_resource SET last_tested_at=clock_timestamp(),last_test_state=?,last_test_detail=?::jsonb
        WHERE id=?
        """, state, b.toString(), row.get("resource_id"));
    systems.audit(actor, "DATASOURCE_TEST_" + state, row.get("resource_id"), Map.of("requestId", id));
    return Map.of("id", id, "state", state);
  }
}
