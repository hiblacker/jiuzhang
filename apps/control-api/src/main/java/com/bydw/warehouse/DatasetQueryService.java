package com.bydw.warehouse;

import static com.bydw.warehouse.ModelService.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DatasetQueryService {
  private final JdbcTemplate jdbc;
  private final ModelService models;
  private final ProductAccessService access;
  public DatasetQueryService(JdbcTemplate jdbc, ModelService models, ProductAccessService access) { this.jdbc = jdbc; this.models = models; this.access = access; }
  @Transactional
  public Map<String, Object> policy(long project, long dataset, JsonNode request, String actor) {
    models.dataset(project, dataset, actor, "OWNER");
    String identity = request.path("identity").asText();
    access.require(project, identity, "VIEWER");
    var d = jdbc.queryForMap("SELECT active_model_version FROM warehouse.dataset WHERE id = ?", dataset);
    JsonNode contract = models.tree(jdbc.queryForObject("SELECT contract FROM warehouse.model_version WHERE dataset_id = ? AND version = ?", String.class, dataset, d.get("active_model_version")));
    var fields = new HashSet<String>(); contract.path("fields").forEach(f -> fields.add(f.path("name").asText()));
    if (!request.path("columns").isArray() || request.path("columns").isEmpty() || !request.path("rowEquals").isObject()) bad("INVALID_DATASET_POLICY");
    for (var c : request.path("columns")) if (!c.isTextual() || !fields.contains(c.asText())) bad("INVALID_POLICY_COLUMN");
    request.path("rowEquals").fields().forEachRemaining(e -> {
      if (!fields.contains(e.getKey()) || !e.getValue().isValueNode() || e.getValue().toString().length() > 1000) bad("INVALID_ROW_POLICY");
    });
    var fieldTypes=new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode();contract.path("fields").forEach(f->fieldTypes.put(f.path("name").asText(),f.path("type").asText()));
    jdbc.update("INSERT INTO warehouse.dataset_policy(dataset_id, identity_id, columns_json, row_equals,field_types) VALUES (?, ?, ?::jsonb, ?::jsonb,?::jsonb) ON CONFLICT(dataset_id, identity_id) DO UPDATE SET columns_json = EXCLUDED.columns_json, row_equals = EXCLUDED.row_equals,field_types=EXCLUDED.field_types, revision = warehouse.dataset_policy.revision + 1", dataset, identity, request.path("columns").toString(), request.path("rowEquals").toString(),fieldTypes.toString());
    models.audit(actor, "DATASET_POLICY_CHANGE", dataset, Map.of("identity", identity)); return Map.of("identity", identity, "datasetId", dataset);
  }
  @Transactional(readOnly = true)
  public Map<String, Object> query(long project, long dataset, JsonNode request, String actor) {
    var d = models.dataset(project, dataset, actor, "VIEWER");
    String role = access.require(project, actor, "VIEWER");
    long release = request.path("releaseId").asLong(d.get("active_release_id") instanceof Number n ? n.longValue() : 0);
    var releases = jdbc.queryForList("""
        SELECT b.schema_name, v.contract FROM warehouse.dataset_release r JOIN warehouse.model_build b ON b.id = r.build_id
        JOIN warehouse.model_version v ON v.dataset_id = r.dataset_id AND v.version = r.model_version
        WHERE r.id = ? AND r.dataset_id = ? AND b.frozen_at IS NOT NULL
        """, release, dataset);
    if (releases.isEmpty()) missing("RELEASE_NOT_FOUND");
    var r = releases.getFirst(); JsonNode contract = models.tree(r.get("contract"));
    var fields = new LinkedHashSet<String>(); contract.path("fields").forEach(f -> fields.add(f.path("name").asText()));
    JsonNode rowPolicy = null; long policyRevision = 0;
    if (!role.equals("OWNER") && !role.equals("ENGINEER")) {
      var policies = jdbc.queryForList("SELECT columns_json, row_equals, revision FROM warehouse.dataset_policy WHERE dataset_id = ? AND identity_id = ?", dataset, actor);
      if (policies.isEmpty()) throw new com.bydw.api.ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "DATASET_ACCESS_DENIED", "Dataset access is not granted");
      var policy = policies.getFirst(); var allowed = new LinkedHashSet<String>(); models.tree(policy.get("columns_json")).forEach(f -> allowed.add(f.asText()));
      if (!fields.containsAll(allowed)) conflict("POLICY_VERSION_MISMATCH");
      rowPolicy = models.tree(policy.get("row_equals"));
      var allFields = new HashSet<>(fields);
      rowPolicy.fieldNames().forEachRemaining(f -> { if (!allFields.contains(f)) conflict("POLICY_VERSION_MISMATCH"); });
      fields.retainAll(allowed); policyRevision = ((Number) policy.get("revision")).longValue();
    }
    var columns = new ArrayList<String>();
    if (request.has("columns")) {
      if (!request.path("columns").isArray() || request.path("columns").isEmpty()) bad("INVALID_QUERY_COLUMNS");
      for (var c : request.path("columns")) {
        if (!c.isTextual() || !fields.contains(c.asText()) || columns.contains(c.asText())) bad("QUERY_COLUMN_NOT_ALLOWED");
        columns.add(c.asText());
      }
    } else columns.addAll(fields);
    int limit = request.path("limit").asInt(100), offset = request.path("offset").asInt(0);
    if (limit < 1 || limit > 1000 || offset < 0 || offset > 100000) bad("INVALID_QUERY_LIMIT");
    var where = new ArrayList<String>(); var values = new ArrayList<Object>();
    if (rowPolicy != null) predicates(rowPolicy, null, where, values);
    if (request.has("equals")) predicates(request.path("equals"), fields, where, values);
    String sql = "SELECT " + String.join(",", columns.stream().map(c -> quote(c) + "::text AS " + quote(c)).toList()) + " FROM " + quote(r.get("schema_name").toString()) + "." + quote(contract.path("output").asText());
    if (!where.isEmpty()) sql += " WHERE " + String.join(" AND ", where);
    var keys = new ArrayList<String>(); contract.path("uniqueKey").forEach(k -> keys.add(quote(k.asText())));
    sql += " ORDER BY " + String.join(",", keys) + " LIMIT ? OFFSET ?"; values.add(limit); values.add(offset);
    jdbc.execute("SET LOCAL statement_timeout = '5s'");
    var rows = jdbc.queryForList(sql, values.toArray());
    return Map.of("datasetId", dataset, "releaseId", release, "policyRevision", policyRevision, "columns", columns,
        "rows", rows, "offset", offset, "limit", limit, "scalarEncoding", "sql-text-v1");
  }
  private static void predicates(JsonNode object, Set<String> allowed, List<String> where, List<Object> values) {
    if (!object.isObject() || object.size() > 32) bad("INVALID_QUERY_FILTER");
    object.fields().forEachRemaining(e -> {
      if (!identifier(e.getKey()) || (allowed != null && !allowed.contains(e.getKey())) || !e.getValue().isValueNode() || e.getValue().toString().length() > 1000) bad("QUERY_FILTER_NOT_ALLOWED");
      if (e.getValue().isNull()) where.add(quote(e.getKey()) + " IS NULL");
      else { where.add(quote(e.getKey()) + "::text = ?"); values.add(e.getValue().asText()); }
    });
  }
}
