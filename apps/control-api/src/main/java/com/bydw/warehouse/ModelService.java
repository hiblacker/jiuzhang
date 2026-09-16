package com.bydw.warehouse;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModelService {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final ProductAccessService access;
  private final ModelPackageService packages;
  private final ManagedRuntimeService runtime;
  private final QualityRuleService quality;
  public ModelService(JdbcTemplate jdbc,ObjectMapper json,ProductAccessService access,ModelPackageService packages,ManagedRuntimeService runtime,QualityRuleService quality){this.jdbc=jdbc;this.json=json;this.access=access;this.packages=packages;this.runtime=runtime;this.quality=quality;}
  public static boolean identifier(String value) { return value != null && value.matches("[A-Za-z_][A-Za-z0-9_]{0,62}"); }
  public static String quote(String value) { if (!identifier(value)) bad("INVALID_IDENTIFIER"); return "\"" + value + "\""; }
  public static boolean type(String value) { return value != null && value.matches("text|bigint|integer|boolean|date|timestamp|timestamptz|jsonb|numeric\\([1-9][0-9]?,[0-9]{1,2}\\)"); }
  private static void fields(JsonNode fields) {
    if (!fields.isArray() || fields.isEmpty() || fields.size() > 200) bad("INVALID_MODEL_FIELDS");
    var names = new HashSet<String>();
    for (var field : fields) if (!identifier(field.path("name").asText()) || !type(field.path("type").asText()) || !names.add(field.path("name").asText())) bad("INVALID_MODEL_FIELDS");
  }
  private void contract(long project, JsonNode c) {
    if (!c.isObject() || c.path("version").asInt() != 1 || c.path("domain").asText().isBlank()
        || c.path("grain").asText().isBlank() || !identifier(c.path("output").asText()) || c.toString().length() > 65536) bad("INVALID_MODEL_CONTRACT");
    fields(c.path("fields"));quality.validate(c);
    var names = new HashSet<String>(); c.path("fields").forEach(f -> names.add(f.path("name").asText()));
    for (String key : List.of("uniqueKey", "required")) {
      if (!c.path(key).isArray() || (key.equals("uniqueKey") && c.path(key).isEmpty())) bad("MODEL_KEY_REQUIRED");
      for (var field : c.path(key)) if (!field.isTextual() || !names.contains(field.asText())) bad("MODEL_KEY_NOT_IN_FIELDS");
    }
    if (!c.path("inputs").isArray() || c.path("inputs").isEmpty() || c.path("inputs").size() > 32) bad("MODEL_INPUTS_REQUIRED");
    var aliases = new HashSet<String>();
    for (var input : c.path("inputs")) {
      if (!identifier(input.path("alias").asText()) || !aliases.add(input.path("alias").asText()) || input.path("objectName").asText().isBlank()) bad("INVALID_MODEL_INPUT");
      if (jdbc.queryForObject("SELECT count(*) FROM warehouse.project_source ps JOIN control.source_connection s ON s.id = ps.source_id WHERE ps.project_id = ? AND s.code = ?", Long.class, project, input.path("sourceCode").asText()) != 1) bad("MODEL_SOURCE_OUTSIDE_PROJECT");
      fields(input.path("columns"));
    }
    if (c.path("maxInputRows").asLong() < 1 || c.path("maxInputRows").asLong() > 10000000
        || c.path("maxOutputRows").asLong() < 1 || c.path("maxOutputRows").asLong() > 10000000
        || c.path("timeoutSeconds").asInt() < 30 || c.path("timeoutSeconds").asInt() > 3600) bad("INVALID_MODEL_LIMITS");
  }
  @Transactional
  public Map<String, Object> save(long project, JsonNode r, String actor) {
    access.require(project, actor, "ENGINEER");
    if(r.has("packageId")){
      var resolved=packages.bind(project,r.path("packageId").asLong(),r.path("bindings"),actor);
      var enriched=(com.fasterxml.jackson.databind.node.ObjectNode)r.deepCopy();resolved.fields().forEachRemaining(e->enriched.set(e.getKey(),e.getValue()));r=enriched;
    }
    String code = r.path("code").asText(), ref = r.path("runtimeRef").asText();
    if (!code.matches("[a-z][a-z0-9_-]{1,99}") || !ref.matches("[a-z][a-z0-9_-]{1,99}")
        || r.path("name").asText().isBlank() || r.path("name").asText().length() > 100
        || !r.path("gitRevision").asText().matches("[0-9a-f]{40}") || !r.path("bundleSha256").asText().matches("[0-9a-f]{64}")) bad("INVALID_MODEL_VERSION");
    contract(project, r.path("contract"));
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", Object.class, project + "/dataset/" + code);
    var existing = jdbc.queryForList("SELECT * FROM warehouse.dataset WHERE project_id = ? AND code = ? FOR UPDATE", project, code);
    int current = existing.isEmpty() ? 0 : ((Number) existing.getFirst().get("active_model_version")).intValue();
    if (current != r.path("expectedVersion").asInt(-1)) conflict("MODEL_VERSION_CHANGED");
    long id = existing.isEmpty() ? jdbc.queryForObject("INSERT INTO warehouse.dataset(project_id, code, name) VALUES (?, ?, ?) RETURNING id", Long.class, project, code, r.path("name").asText()) : ((Number) existing.getFirst().get("id")).longValue();
    jdbc.update("INSERT INTO warehouse.model_version(dataset_id, version, runtime_ref, git_revision, bundle_sha256, contract, created_by,package_id) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?,?)", id, current + 1, ref, r.path("gitRevision").asText(), r.path("bundleSha256").asText(), r.path("contract").toString(), actor,r.has("packageId")?r.path("packageId").asLong():null);
    jdbc.update("UPDATE warehouse.dataset SET active_model_version = ?, name = ? WHERE id = ?", current + 1, r.path("name").asText(), id);
    audit(actor, "MODEL_VERSION_CREATE", id, Map.of("version", current + 1)); return Map.of("id", id, "version", current + 1);
  }
  public List<Map<String, Object>> datasets(long project, String actor) {
    access.require(project, actor, "VIEWER");
    return jdbc.queryForList("SELECT id, code, name, active_model_version, active_release_id FROM warehouse.dataset WHERE project_id = ? ORDER BY id LIMIT 200", project);
  }
  public Map<String, Object> dataset(long project, long id, String actor, String role) {
    access.require(project, actor, role);
    var rows = jdbc.queryForList("SELECT * FROM warehouse.dataset WHERE project_id = ? AND id = ?", project, id);
    if (rows.isEmpty()) missing("DATASET_NOT_FOUND"); return rows.getFirst();
  }
  public List<Map<String, Object>> versions(long project, long id, String actor) {
    dataset(project, id, actor, "VIEWER");
    var rows = jdbc.queryForList("SELECT version,package_id, runtime_ref, git_revision, bundle_sha256, contract, created_by, created_at FROM warehouse.model_version WHERE dataset_id = ? ORDER BY version DESC LIMIT 200", id);
    rows.forEach(r -> decode(r, "contract")); return rows;
  }
  @Transactional
  public Map<String, Object> build(long project, long dataset, JsonNode request, String actor) {
    var d = dataset(project, dataset, actor, "ENGINEER");
    d = jdbc.queryForMap("SELECT * FROM warehouse.dataset WHERE id = ? FOR UPDATE", dataset);
    int version = request.path("modelVersion").asInt();
    var models = jdbc.queryForList("SELECT contract FROM warehouse.model_version WHERE dataset_id = ? AND version = ?", dataset, version);
    if (models.isEmpty()) bad("MODEL_VERSION_NOT_FOUND");
    JsonNode contract = tree(models.getFirst().get("contract"));
    requireInputsActive(project,contract,actor);
    if (!request.path("requestKey").asText().matches("[A-Za-z0-9._:-]{1,120}") || !request.path("inputs").isObject()
        || request.path("inputs").size() != contract.path("inputs").size()) bad("INVALID_BUILD_REQUEST");
    ArrayNode inputs = json.createArrayNode(), watermark = json.createArrayNode();
    var coherentBatches=new HashMap<String,String>();
    for (var definition : contract.path("inputs")) {
      String alias = definition.path("alias").asText(), assetId = request.path("inputs").path(alias).asText();
      if (!assetId.matches("(mysql|external):[0-9]{1,18}")) bad("INVALID_BUILD_ASSET");
      long id = Long.parseLong(assetId.split(":")[1]); List<Map<String, Object>> rows;
      if (assetId.startsWith("mysql:")) rows = jdbc.queryForList("""
          SELECT o.raw_path AS path, o.raw_sha256 AS sha256, o.byte_count AS bytes, o.row_count AS rows,
            so.schema_json AS schema, o.schema_sha256, so.object_name AS name, s.code AS source, r.started_at AS watermark,
            r.manifest_json AS manifest,r.id AS input_batch,r.scheduled_window_start AS business_window,r.started_at AS actual_at FROM lake.object_run o JOIN lake.system_run r ON r.id = o.system_run_id
          JOIN lake.source_object so ON so.id = o.source_object_id JOIN control.source_connection s ON s.id = r.source_id
          JOIN warehouse.project_source ps ON ps.source_id = s.id
          WHERE o.id = ? AND ps.project_id = ? AND o.state = 'RAW_COMMITTED' AND r.state = 'COMPLETE'
          """, id, project);
      else rows = jdbc.queryForList("""
          SELECT a.evidence, a.schema_json AS schema, a.object_key AS name, s.code AS source,
            a.business_date::timestamp AT TIME ZONE 'Asia/Shanghai' AS watermark, a.row_count AS rows,a.execution_id AS input_batch,a.business_date AS business_window,a.created_at AS actual_at
          FROM warehouse.external_asset a JOIN control.source_connection s ON s.id = a.source_id
          JOIN warehouse.project_source ps ON ps.source_id = s.id
          JOIN lake.execution_attempt execution ON execution.id = a.execution_id
          WHERE a.id = ? AND ps.project_id = ? AND a.state = 'PARSED' AND execution.state = 'COMPLETE'
          """, id, project);
      if (rows.isEmpty()) bad("BUILD_INPUT_NOT_AVAILABLE");
      var row = rows.getFirst();
      if (!row.get("source").equals(definition.path("sourceCode").asText()) || !row.get("name").equals(definition.path("objectName").asText())) bad("BUILD_INPUT_CONTRACT_MISMATCH");
      String group=row.get("source").toString(),batch=row.get("input_batch").toString();
      String previousBatch=coherentBatches.putIfAbsent(group,batch);
      if(previousBatch!=null&&!previousBatch.equals(batch))bad("INPUT_BATCHES_NOT_COHERENT");
      var input = json.createObjectNode().put("alias", alias).put("assetId", assetId).put("sourceCode", row.get("source").toString()).put("rows", ((Number) row.get("rows")).longValue());
      input.set("columns", definition.path("columns"));
      if (assetId.startsWith("mysql:")) {
        input.put("format", "mysql-jsonl").put("path", row.get("path").toString()).put("sha256", row.get("sha256").toString()).put("bytes", ((Number) row.get("bytes")).longValue());
        input.set("schema", tree(row.get("schema")));
        input.put("schemaSha256", row.get("schema_sha256").toString());
        // New scalar encoding lives with the sealed raw schema. Worker validates it before loading.
        input.put("schemaPath", row.get("path").toString().replaceFirst("[^/]+$", "schema.json"));
      } else {
        JsonNode evidence = tree(row.get("evidence"));
        input.put("format", "jsonl").put("path", evidence.at("/parsed/path").asText()).put("sha256", evidence.at("/parsed/sha256").asText()).put("bytes", evidence.at("/parsed/bytes").asLong());
      }
      inputs.add(input); watermark.addObject().put("alias", alias).put("at", ((java.sql.Timestamp) row.get("watermark")).toInstant().toString()).put("assetId", assetId).put("assetVersion", id).put("batchId",batch).put("businessWindow",row.get("business_window").toString()).put("receivedAt",row.get("actual_at").toString());
    }
    var previous = jdbc.queryForList("SELECT * FROM warehouse.model_build WHERE dataset_id = ? AND request_key = ?", dataset, request.path("requestKey").asText());
    if (!previous.isEmpty()) {
      var p = previous.getFirst();
      if (((Number) p.get("model_version")).intValue() != version || !tree(p.get("inputs")).equals(inputs)) conflict("BUILD_REQUEST_KEY_CONFLICT");
      return Map.of("id", p.get("id"), "state", p.get("state"));
    }
    long id = jdbc.queryForObject("INSERT INTO warehouse.model_build(dataset_id, model_version, expected_release_id, inputs, watermark, request_key, state,requested_by) VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?, 'QUEUED',?) RETURNING id", Long.class, dataset, version, d.get("active_release_id"), inputs.toString(), watermark.toString(), request.path("requestKey").asText(),actor);
    audit(actor, "MODEL_BUILD_QUEUE", dataset, Map.of("buildId", id)); return Map.of("id", id, "state", "QUEUED");
  }
  public List<Map<String, Object>> builds(long project, long dataset, String actor) {
    dataset(project, dataset, actor, "ENGINEER");
    var rows = jdbc.queryForList("SELECT id, model_version, expected_release_id, watermark, state, cancel_requested, started_at, finished_at, result, error_code FROM warehouse.model_build WHERE dataset_id = ? ORDER BY id DESC LIMIT 200", dataset);
    rows.forEach(r -> { decode(r, "watermark"); decode(r, "result"); }); return rows;
  }
  public List<Map<String, Object>> releases(long project, long dataset, String actor) {
    dataset(project, dataset, actor, "VIEWER");
    return jdbc.queryForList("SELECT id, build_id, model_version, previous_release_id, published_by, reason, published_at FROM warehouse.dataset_release WHERE dataset_id = ? ORDER BY id DESC LIMIT 200", dataset);
  }
  public Map<String, Object> impact(long project, long dataset, int target, String actor) {
    var d = dataset(project, dataset, actor, "ENGINEER");
    var versions = jdbc.queryForList("SELECT version, contract, bundle_sha256 FROM warehouse.model_version WHERE dataset_id = ? AND version = ?", dataset, target);
    if (versions.isEmpty()) bad("MODEL_VERSION_NOT_FOUND");
    JsonNode next = tree(versions.getFirst().get("contract")); JsonNode previous = null;
    if (d.get("active_release_id") != null) previous = tree(jdbc.queryForObject("SELECT v.contract FROM warehouse.dataset_release r JOIN warehouse.model_version v ON v.dataset_id = r.dataset_id AND v.version = r.model_version WHERE r.id = ?", String.class, d.get("active_release_id")));
    var changed = new ArrayList<String>();
    for (String key : List.of("fields", "inputs", "uniqueKey", "required", "grain", "domain")) if (previous == null || !next.path(key).equals(previous.path(key))) changed.add(key);
    return Map.of("datasetId", dataset, "targetVersion", target, "changedContractSections", changed, "inputs", next.path("inputs"),
        "buildStrategy", "FULL_FROM_PINNED_ASSETS", "publicationRequires", "QUALITY_AND_CURRENT_RELEASE_MATCH");
  }
  public void requireInputsActive(long project,JsonNode contract,String actor){
    access.require(project,actor,"ENGINEER");
    for(JsonNode input:contract.path("inputs")){
      var ids=jdbc.queryForList("SELECT s.id FROM control.source_connection s JOIN warehouse.project_source ps ON ps.source_id=s.id WHERE s.code=? AND ps.project_id=?",Long.class,input.path("sourceCode").asText(),project);
      if(ids.isEmpty())bad("MODEL_SOURCE_OUTSIDE_PROJECT");
      if(runtime.sourcePaused(ids.getFirst()))conflict("MODEL_INPUT_SOURCE_PAUSED");
    }
  }
  public JsonNode tree(Object value) {
    try { return json.readTree(value.toString()); } catch (Exception error) { throw new IllegalStateException("INVALID_STORED_JSON"); }
  }
  public void decode(Map<String, Object> row, String key) { if (row.get(key) != null) row.put(key, tree(row.get(key))); }
  public void audit(String actor, String action, long dataset, Object details) { jdbc.update("INSERT INTO control.audit_log(principal, action, resource, result, details) VALUES (?, ?, ?, 'SUCCESS', ?::jsonb)", actor, action, "warehouse/dataset/" + dataset, json.valueToTree(details).toString()); }
  public static void bad(String code) { throw new ApiException(HttpStatus.BAD_REQUEST, code, code); }
  public static void conflict(String code) { throw new ApiException(HttpStatus.CONFLICT, code, code); }
  public static void missing(String code) { throw new ApiException(HttpStatus.NOT_FOUND, code, code); }
}
