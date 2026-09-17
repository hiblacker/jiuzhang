package com.bydw.warehouse;

import static com.bydw.warehouse.SystemCatalogService.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Registered SQL: drafts, immutable versions and previews.
 *
 * A version can only be created from a preview that actually ran, so the stored result
 * columns are evidence rather than a parse of the text. Enabling a version retires the
 * previous one in the same transaction; only one SQL definition per channel can be live.
 */
@Service
public class SqlDefinitionService {
  static final int PREVIEW_LIMIT = 1000;

  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final ProductAccessService access;
  private final SystemCatalogService systems;
  private final DataSourceService dataSources;

  public SqlDefinitionService(JdbcTemplate jdbc, ObjectMapper json, ProductAccessService access,
      SystemCatalogService systems, DataSourceService dataSources) {
    this.jdbc = jdbc; this.json = json; this.access = access; this.systems = systems; this.dataSources = dataSources;
  }

  /** Channel context plus the datasource it reads from, with the project check applied. */
  private Map<String, Object> context(long project, long source, String actor, String role) {
    access.require(project, actor, role);
    var rows = jdbc.queryForList("""
        SELECT c.source_id,sc.code AS source_code,c.connection_id,c.active_version,c.lifecycle,ps.project_id,
               cn.resource_id,r.environment_code,r.datasource_type,r.credential_ref,r.config AS datasource_config,
               r.statement_timeout_ms,r.allowed_tables,r.allowed_schemas
          FROM warehouse.ingest_channel c
          JOIN control.source_connection sc ON sc.id=c.source_id
          JOIN warehouse.project_source ps ON ps.source_id=c.source_id AND ps.project_id=?
          JOIN warehouse.ingest_connection cn ON cn.id=c.connection_id
          JOIN warehouse.ingest_resource r ON r.id=cn.resource_id
         WHERE c.source_id=?
        """, project, source);
    if (rows.isEmpty()) denied();
    return rows.getFirst();
  }

  private List<String> allowedTables(Map<String, Object> context) {
    JsonNode node = tree(context.get("allowed_tables"));
    List<String> values = new ArrayList<>();
    if (node.isArray()) for (JsonNode item : node) values.add(item.asText());
    return values;
  }

  private Map<String, Object> draftRow(long source) {
    var rows = jdbc.queryForList("SELECT * FROM warehouse.extraction_sql_draft WHERE source_id=?", source);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private Map<String, Object> draftView(Map<String, Object> row) {
    if (row == null) return null;
    var view = new LinkedHashMap<>(row);
    for (String field : List.of("parameters", "masked_columns", "unique_key")) decode(view, field);
    return view;
  }

  public Object draft(long project, long source, String actor) {
    var context = context(project, source, actor, "ENGINEER");
    return Map.of("draft", draftView(draftRow(source)) == null ? json.nullNode() : draftView(draftRow(source)),
        "datasource", Map.of(
            "resourceId", context.get("resource_id"),
            "datasourceType", String.valueOf(context.get("datasource_type")),
            "availableTables", tree(context.get("allowed_tables")),
            "availableSchemas", tree(context.get("allowed_schemas")),
            "statementTimeoutMs", context.get("statement_timeout_ms")),
        "previewLimit", PREVIEW_LIMIT);
  }

  /** Stateless validation so the editor can check text before anything is stored. */
  public Object validate(long project, long source, JsonNode body, String actor) {
    var context = context(project, source, actor, "ENGINEER");
    String sql = text(body, "sqlText", 20000, true);
    var result = SqlDefinitionValidator.validate(sql, allowedTables(context));
    return Map.of("blocked", result.blocked(), "issues", result.issues(),
        "referencedTables", result.referencedTables(), "placeholders", result.placeholders(),
        "availableParameters", SqlDefinitionValidator.INJECTABLE_PARAMETERS);
  }

  @Transactional public Object saveDraft(long project, long source, JsonNode body, String actor) {
    var context = context(project, source, actor, "ENGINEER");
    String sql = text(body, "sqlText", 20000, true);
    var validation = SqlDefinitionValidator.validate(sql, allowedTables(context));
    if (validation.blocked()) return Map.of("saved", false, "issues", validation.issues());
    JsonNode masked = body.path("maskedColumns");
    if (!masked.isArray() || masked.size() > 200) bad("INVALID_MASKED_COLUMNS");
    List<String> uniqueKey = new ArrayList<>();
    if (body.path("uniqueKey").isArray()) for (JsonNode item : body.path("uniqueKey")) uniqueKey.add(item.asText());
    String grain = text(body, "grain", 300, false);
    String hash = ProductAccessService.hash(sql);
    if (draftRow(source) == null) {
      jdbc.update("""
          INSERT INTO warehouse.extraction_sql_draft(source_id,sql_text,sql_sha256,parameters,masked_columns,grain,unique_key,updated_by)
          VALUES (?,?,?,?::jsonb,?::jsonb,?,?::jsonb,?)
          """, source, sql, hash, jsonArray(validation.placeholders()), masked.toString(), grain,
          jsonArray(uniqueKey), actor);
    } else {
      jdbc.update("""
          UPDATE warehouse.extraction_sql_draft SET sql_text=?,sql_sha256=?,parameters=?::jsonb,masked_columns=?::jsonb,
                 grain=?,unique_key=?::jsonb,updated_by=?,updated_at=clock_timestamp() WHERE source_id=?
          """, sql, hash, jsonArray(validation.placeholders()), masked.toString(), grain, jsonArray(uniqueKey), actor, source);
    }
    systems.audit(actor, "SQL_DRAFT_SAVE", source, Map.of("sqlSha256", hash));
    return Map.of("saved", true, "draft", draftView(draftRow(source)), "issues", validation.issues(),
        "placeholders", validation.placeholders(), "referencedTables", validation.referencedTables());
  }

  /** Queues a preview of the stored draft (or of the supplied text) for the worker. */
  @Transactional public Object requestPreview(long project, long source, JsonNode body, String actor) {
    var context = context(project, source, actor, "ENGINEER");
    String requestKey = text(body, "requestKey", 100, true);
    String sql;
    if (body.path("sqlText").isTextual() && !body.path("sqlText").asText().isBlank()) {
      sql = text(body, "sqlText", 20000, true);
    } else {
      var draft = draftRow(source);
      if (draft == null) bad("SQL_DRAFT_REQUIRED");
      sql = draft.get("sql_text").toString();
    }
    var validation = SqlDefinitionValidator.validate(sql, allowedTables(context));
    if (validation.blocked()) return Map.of("queued", false, "issues", validation.issues());
    if (context.get("datasource_type") == null) bad("DATASOURCE_NOT_CONFIGURED");
    String hash = ProductAccessService.hash(sql);
    Long versionId = body.path("sqlVersionId").isIntegralNumber() ? body.path("sqlVersionId").asLong() : null;
    jdbc.update("""
        INSERT INTO warehouse.sql_preview_request(source_id,sql_version_id,sql_text,sql_sha256,limit_rows,
          environment_code,state,requested_by,request_key)
        VALUES (?,?,?,?,?,?,'QUEUED',?,?) ON CONFLICT(source_id,request_key) DO NOTHING
        """, source, versionId, sql, hash, PREVIEW_LIMIT, context.get("environment_code"), actor, requestKey);
    var row = jdbc.queryForMap("SELECT * FROM warehouse.sql_preview_request WHERE source_id=? AND request_key=?", source, requestKey);
    systems.audit(actor, "SQL_PREVIEW_REQUEST", source, Map.of("previewId", row.get("id"), "sqlSha256", hash));
    row.remove("sql_text");
    row.remove("rows");
    return Map.of("queued", true, "preview", row);
  }

  /** Console polling view. Rows are already masked when they were stored. */
  @Transactional public Object preview(long project, long source, long id, String actor) {
    context(project, source, actor, "ENGINEER");
    var rows = jdbc.queryForList("SELECT * FROM warehouse.sql_preview_request WHERE id=? AND source_id=?", id, source);
    if (rows.isEmpty()) bad("PREVIEW_NOT_FOUND");
    var row = rows.getFirst();
    var view = new LinkedHashMap<>(row);
    view.remove("sql_text");
    decode(view, "columns");
    decode(view, "rows");
    if (view.get("rows") != null && !"COMPLETED".equals(row.get("state"))) view.remove("rows");
    return view;
  }

  /** Creates an immutable version from a preview that actually completed. */
  @Transactional public Object saveVersion(long project, long source, JsonNode body, String actor) {
    context(project, source, actor, "ENGINEER");
    var draft = draftRow(source);
    if (draft == null) bad("SQL_DRAFT_REQUIRED");
    String hash = draft.get("sql_sha256").toString();
    var previews = jdbc.queryForList("""
        SELECT id,columns FROM warehouse.sql_preview_request
         WHERE source_id=? AND sql_sha256=? AND state='COMPLETED' ORDER BY id DESC LIMIT 1
        """, source, hash);
    if (previews.isEmpty()) bad("SUCCESSFUL_PREVIEW_REQUIRED");
    JsonNode columns = tree(previews.getFirst().get("columns"));
    if (!columns.isArray() || columns.isEmpty()) bad("PREVIEW_COLUMNS_REQUIRED");
    String extractionMode = text(body, "extractionMode", 20, true).toUpperCase(java.util.Locale.ROOT);
    if (!List.of("FULL", "UPDATED_AT_KEYSET").contains(extractionMode)) bad("INVALID_EXTRACTION_MODE");
    String watermark = text(body, "watermarkColumn", 128, false);
    if ("UPDATED_AT_KEYSET".equals(extractionMode)) {
      if (watermark.isBlank()) bad("WATERMARK_COLUMN_REQUIRED");
      if (!hasColumn(columns, watermark)) bad("WATERMARK_COLUMN_NOT_IN_RESULT");
    }
    String grain = draft.get("grain") == null ? "" : draft.get("grain").toString();
    if (grain.isBlank()) bad("GRAIN_REQUIRED");
    JsonNode uniqueKey = tree(draft.get("unique_key"));
    if (!uniqueKey.isArray() || uniqueKey.isEmpty()) bad("UNIQUE_KEY_REQUIRED");
    for (JsonNode item : uniqueKey) if (!hasColumn(columns, item.asText())) bad("UNIQUE_KEY_COLUMN_NOT_IN_RESULT");
    int version = jdbc.queryForObject(
        "SELECT coalesce(max(version),0)+1 FROM warehouse.extraction_sql_version WHERE source_id=?", Integer.class, source);
    var created = jdbc.queryForMap("""
        INSERT INTO warehouse.extraction_sql_version(source_id,version,sql_text,sql_sha256,parameters,result_columns,
          masked_columns,grain,unique_key,extraction_mode,watermark_column,state,created_by)
        VALUES (?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?,?::jsonb,?,?,'VALIDATED',?) RETURNING *
        """, source, version, draft.get("sql_text"), hash, draft.get("parameters").toString(), columns.toString(),
        draft.get("masked_columns").toString(), grain, uniqueKey.toString(), extractionMode,
        watermark.isBlank() ? null : watermark, actor);
    systems.audit(actor, "SQL_VERSION_CREATE", source, Map.of("version", version, "sqlSha256", hash));
    var view = new LinkedHashMap<>(created);
    for (String field : List.of("parameters", "result_columns", "masked_columns", "unique_key")) decode(view, field);
    return view;
  }

  public Object versions(long project, long source, String actor) {
    context(project, source, actor, "ENGINEER");
    var rows = jdbc.queryForList("""
        SELECT id,version,sql_sha256,result_columns,masked_columns,grain,unique_key,extraction_mode,watermark_column,
               state,created_by,created_at,enabled_by,enabled_at,reason
          FROM warehouse.extraction_sql_version WHERE source_id=? ORDER BY version DESC LIMIT 50
        """, source);
    rows.forEach(row -> {
      for (String field : List.of("result_columns", "masked_columns", "unique_key")) decode(row, field);
    });
    return rows;
  }

  /**
   * Enables a version and retires the previous one. Owner-level because it changes what
   * production extraction reads; a reason is mandatory and the change is audited.
   */
  @Transactional public Object enableVersion(long project, long source, long versionId, JsonNode body, String actor) {
    context(project, source, actor, "OWNER");
    String reason = text(body, "reason", 300, true);
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(?)", Object.class, source);
    var rows = jdbc.queryForList("SELECT * FROM warehouse.extraction_sql_version WHERE id=? AND source_id=? FOR UPDATE", versionId, source);
    if (rows.isEmpty()) bad("SQL_VERSION_NOT_FOUND");
    var row = rows.getFirst();
    if ("ENABLED".equals(row.get("state"))) return versionView(row);
    if (!"VALIDATED".equals(row.get("state"))) conflict("SQL_VERSION_NOT_ENABLEABLE");
    // The engine still extracts the whole query: it takes no watermark window yet. Refusing the
    // enable keeps a declared increment from silently degrading into a full snapshot (P0-c).
    if ("UPDATED_AT_KEYSET".equals(row.get("extraction_mode"))) bad("EXTRACTION_MODE_NOT_IMPLEMENTED");
    jdbc.update("""
        UPDATE warehouse.extraction_sql_version SET state='RETIRED'
         WHERE source_id=? AND state='ENABLED'
        """, source);
    jdbc.update("""
        UPDATE warehouse.extraction_sql_version SET state='ENABLED',enabled_by=?,enabled_at=clock_timestamp(),reason=?
         WHERE id=?
        """, actor, reason, versionId);
    systems.audit(actor, "SQL_VERSION_ENABLE", source, Map.of("versionId", versionId, "reason", reason));
    return versionView(jdbc.queryForMap("SELECT * FROM warehouse.extraction_sql_version WHERE id=?", versionId));
  }

  private Map<String, Object> versionView(Map<String, Object> row) {
    var view = new LinkedHashMap<>(row);
    for (String field : List.of("parameters", "result_columns", "masked_columns", "unique_key")) decode(view, field);
    return view;
  }

  /** Worker claim for a queued preview. */
  @Transactional public Object claimPreview(String environment, String actor) {
    if (environment == null || !environment.matches("[a-z][a-z0-9_-]{1,70}")) bad("INVALID_ENVIRONMENT");
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(73401932)", Object.class);
    jdbc.update("""
        UPDATE warehouse.sql_preview_request SET state='FAILED',error_code='PREVIEW_LEASE_EXPIRED',finished_at=clock_timestamp()
        WHERE state='RUNNING' AND created_at < clock_timestamp()-interval '10 minutes'
        """);
    var rows = jdbc.queryForList("""
        SELECT p.id AS request_id,p.source_id,p.sql_text,p.sql_sha256,p.limit_rows,p.requested_by,
               r.environment_code,r.datasource_type,r.credential_ref,r.config AS datasource_config,r.statement_timeout_ms,
               sc.code AS source_code
          FROM warehouse.sql_preview_request p
          JOIN warehouse.ingest_channel c ON c.source_id=p.source_id
          JOIN control.source_connection sc ON sc.id=p.source_id
          JOIN warehouse.ingest_connection cn ON cn.id=c.connection_id
          JOIN warehouse.ingest_resource r ON r.id=cn.resource_id AND r.enabled
         WHERE p.state='QUEUED' AND r.environment_code=?
         ORDER BY p.id FOR UPDATE OF p SKIP LOCKED LIMIT 1
        """, environment);
    if (rows.isEmpty()) return Map.of("state", "IDLE");
    var row = rows.getFirst();
    long requestId = ((Number) row.get("request_id")).longValue();
    jdbc.update("UPDATE warehouse.sql_preview_request SET state='RUNNING' WHERE id=?", requestId);
    jdbc.update("UPDATE warehouse.execution_environment SET last_seen_at=clock_timestamp() WHERE code=?", environment);
    var result = new LinkedHashMap<String, Object>();
    result.put("id", requestId);
    result.put("state", "RUNNING");
    result.put("sourceCode", row.get("source_code"));
    result.put("sqlText", row.get("sql_text"));
    result.put("sqlSha256", row.get("sql_sha256"));
    result.put("limitRows", row.get("limit_rows"));
    result.put("datasourceType", row.get("datasource_type"));
    result.put("credentialRef", row.get("credential_ref"));
    result.put("statementTimeoutMs", row.get("statement_timeout_ms"));
    result.put("config", tree(row.get("datasource_config")));
    return result;
  }

  /** Worker preview result: masked before storage so raw values never persist. */
  @Transactional public Object finishPreview(long id, JsonNode body, String actor) {
    // The worker reports COMPLETE (the platform-wide tool convention); the stored state is COMPLETED.
    String reported = text(body, "state", 20, true);
    if (!List.of("COMPLETE", "COMPLETED", "FAILED").contains(reported)) bad("INVALID_PREVIEW_STATE");
    String state = "FAILED".equals(reported) ? "FAILED" : "COMPLETED";
    var rows = jdbc.queryForList("SELECT * FROM warehouse.sql_preview_request WHERE id=? FOR UPDATE", id);
    if (rows.isEmpty()) bad("PREVIEW_NOT_FOUND");
    var row = rows.getFirst();
    if ("COMPLETED".equals(row.get("state"))) return Map.of("id", id, "state", "COMPLETED");
    if (!"RUNNING".equals(row.get("state"))) conflict("PREVIEW_NOT_RUNNING");
    long source = ((Number) row.get("source_id")).longValue();
    String error = body.path("errorCode").asText("");
    if (!error.isEmpty() && !error.matches("[A-Z0-9_:-]{1,120}")) bad("INVALID_PREVIEW_ERROR");
    JsonNode columns = body.path("columns");
    JsonNode resultRows = body.path("rows");
    boolean masked = false;
    if ("COMPLETED".equals(state)) {
      if (!columns.isArray() || columns.isEmpty()) bad("PREVIEW_COLUMNS_REQUIRED");
      if (!resultRows.isArray() || resultRows.size() > PREVIEW_LIMIT) bad("PREVIEW_ROWS_INVALID");
      var draft = draftRow(source);
      List<String> maskedColumns = new ArrayList<>();
      if (draft != null) {
        JsonNode configured = tree(draft.get("masked_columns"));
        if (configured.isArray()) for (JsonNode item : configured) maskedColumns.add(item.asText());
      }
      if (!maskedColumns.isEmpty()) {
        var maskedRows = json.createArrayNode();
        for (JsonNode resultRow : resultRows) {
          var maskedRow = json.createArrayNode();
          for (int index = 0; index < resultRow.size(); index++) {
            String name = index < columns.size() ? columns.get(index).path("name").asText("") : "";
            boolean hide = maskedColumns.contains(name);
            if (hide) { maskedRow.add("***"); masked = true; }
            else maskedRow.add(resultRow.get(index));
          }
          maskedRows.add(maskedRow);
        }
        resultRows = maskedRows;
      }
    }
    jdbc.update("""
        UPDATE warehouse.sql_preview_request SET state=?,columns=?::jsonb,rows=?::jsonb,truncated=?,row_count=?,
               elapsed_ms=?,error_code=?,finished_at=clock_timestamp() WHERE id=?
        """, state, "COMPLETED".equals(state) ? columns.toString() : null,
        "COMPLETED".equals(state) ? resultRows.toString() : null,
        body.path("truncated").asBoolean(false), body.path("rowCount").isIntegralNumber() ? body.path("rowCount").asInt() : null,
        body.path("elapsedMs").isIntegralNumber() ? body.path("elapsedMs").asInt() : null,
        error.isEmpty() ? null : error, id);
    if ("COMPLETED".equals(state)) {
      jdbc.update("""
          INSERT INTO warehouse.sql_preview_audit(preview_request_id,identity,source_id,sql_sha256,returned_rows,masked,elapsed_ms)
          VALUES (?,?,?,?,?,?,?)
          """, id, row.get("requested_by"), source, row.get("sql_sha256"),
          body.path("rowCount").asInt(0), masked, body.path("elapsedMs").isInt() ? body.path("elapsedMs").asInt() : null);
    }
    return Map.of("id", id, "state", state, "masked", masked);
  }

  /** Worker report of the SeaTunnel job that backs an attempt. */
  @Transactional public Object recordSeatunnelJob(JsonNode body, String actor) {
    long source = body.path("sourceId").asLong(-1);
    String jobId = text(body, "jobId", 64, true);
    String state = text(body, "state", 30, true);
    String mode = text(body, "jobMode", 20, true);
    if (!List.of("FULL", "UPDATED_AT_KEYSET").contains(mode)) bad("INVALID_JOB_MODE");
    Long attemptId = body.path("executionAttemptId").isIntegralNumber() ? body.path("executionAttemptId").asLong() : null;
    Long versionId = body.path("sqlVersionId").isIntegralNumber() ? body.path("sqlVersionId").asLong() : null;
    jdbc.update("""
        INSERT INTO warehouse.seatunnel_job(execution_attempt_id,source_id,sql_version_id,job_id,job_mode,state,error_code,finished_at)
        VALUES (?,?,?,?,?,?,?,CASE WHEN ? IN ('FINISHED','FAILED','CANCELED') THEN clock_timestamp() END)
        ON CONFLICT(job_id) DO UPDATE SET state=EXCLUDED.state,error_code=EXCLUDED.error_code,finished_at=EXCLUDED.finished_at
        """, attemptId, source, versionId, jobId, mode, state, body.path("errorCode").asText(null), state);
    return Map.of("recorded", true);
  }

  public Object jobs(long project, long source, String actor) {
    context(project, source, actor, "VIEWER");
    return jdbc.queryForList("""
        SELECT id,execution_attempt_id,sql_version_id,job_id,job_mode,state,error_code,submitted_at,finished_at
          FROM warehouse.seatunnel_job WHERE source_id=? ORDER BY id DESC LIMIT 50
        """, source);
  }

  private boolean hasColumn(JsonNode columns, String name) {
    for (JsonNode column : columns) if (name.equals(column.path("name").asText())) return true;
    return false;
  }

  private String jsonArray(List<String> values) {
    var array = json.createArrayNode();
    values.forEach(array::add);
    return array.toString();
  }

  private JsonNode tree(Object value) {
    try { return value == null ? json.nullNode() : json.readTree(value.toString()); }
    catch (Exception error) { throw new IllegalStateException("INVALID_STORED_JSON"); }
  }

  private void decode(Map<String, Object> row, String field) {
    if (row.containsKey(field) && row.get(field) != null) row.put(field, tree(row.get(field)));
  }
}
