package com.bydw.warehouse;

import static com.bydw.warehouse.ModelService.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModelExecutionService {
  private final JdbcTemplate jdbc;
  private final ModelService models;
  private final ObjectMapper json;
  private final ModelPackageService packages;
  private final QualityRuleService quality;
  public ModelExecutionService(JdbcTemplate jdbc,ModelService models,ObjectMapper json,ModelPackageService packages,QualityRuleService quality){this.jdbc=jdbc;this.models=models;this.json=json;this.packages=packages;this.quality=quality;}
  @Transactional
  public Map<String, Object> claim(List<String> refs, String worker) {
    if (refs == null || refs.isEmpty() || refs.size() > 100 || refs.stream().anyMatch(r -> r == null || !r.matches("[a-z][a-z0-9_-]{1,99}"))) bad("MODEL_CAPABILITIES_REQUIRED");
    jdbc.update("UPDATE warehouse.model_build SET state = 'FAILED', error_code = 'MODEL_LEASE_EXPIRED', finished_at = clock_timestamp() WHERE state = 'RUNNING' AND lease_expires_at <= clock_timestamp()");
    var rows = jdbc.queryForList("""
        SELECT b.*, v.runtime_ref, v.git_revision, v.bundle_sha256, v.contract,v.package_id, d.project_id
        FROM warehouse.model_build b JOIN warehouse.model_version v ON v.dataset_id = b.dataset_id AND v.version = b.model_version
        JOIN warehouse.dataset d ON d.id = b.dataset_id WHERE b.state = 'QUEUED' AND v.runtime_ref IN (%s)
        ORDER BY b.id FOR UPDATE OF b SKIP LOCKED
        """.formatted(String.join(",", Collections.nCopies(refs.size(), "?"))), refs.toArray());
    if (rows.isEmpty()) return Map.of("state", "IDLE");
    Map<String,Object> row=null;
    for(var candidate:rows){
      try{
        if(candidate.get("requested_by")!=null)models.requireInputsActive(((Number)candidate.get("project_id")).longValue(),models.tree(candidate.get("contract")),candidate.get("requested_by").toString());
        var refresh=jdbc.queryForList("SELECT p.state,p.active_version,w.plan_version FROM warehouse.refresh_build rb JOIN warehouse.refresh_window w ON w.id=rb.window_id JOIN warehouse.refresh_plan p ON p.id=w.plan_id WHERE rb.build_id=?",candidate.get("id"));
        if(!refresh.isEmpty()&&(!refresh.getFirst().get("state").equals("ACTIVE")||!refresh.getFirst().get("active_version").equals(refresh.getFirst().get("plan_version"))))continue;
        packages.checkBuild(candidate,worker);row=candidate;break;
      }catch(com.bydw.api.ApiException e){
        if(Set.of("MODEL_INPUT_SOURCE_PAUSED","MODEL_WORKER_NOT_ALLOWED").contains(e.code()))continue;
        jdbc.update("UPDATE warehouse.model_build SET state='FAILED',error_code='MODEL_ACCESS_REVOKED',finished_at=clock_timestamp() WHERE id=?",candidate.get("id"));
      }
    }
    if(row==null)return Map.of("state","IDLE");
    UUID token = UUID.randomUUID();
    jdbc.update("UPDATE warehouse.model_build SET state = 'RUNNING', lease_token = ?, lease_owner = ?, lease_expires_at = clock_timestamp() + interval '60 seconds', started_at = clock_timestamp() WHERE id = ?", token, worker, row.get("id"));
    row.put("state", "RUNNING"); row.put("leaseToken", token.toString());
    for (String key : List.of("contract", "inputs", "watermark")) models.decode(row, key);
    return row;
  }
  private Map<String, Object> lease(long id, UUID token, String actor) {
    var rows = jdbc.queryForList("""
        SELECT b.*, v.contract FROM warehouse.model_build b JOIN warehouse.model_version v
        ON v.dataset_id = b.dataset_id AND v.version = b.model_version
        WHERE b.id = ? AND b.lease_token = ? AND b.lease_owner = ? AND b.state = 'RUNNING'
          AND b.lease_expires_at > clock_timestamp()
          AND b.started_at + ((v.contract->>'timeoutSeconds')::int * interval '1 second') > clock_timestamp()
        FOR UPDATE OF b
        """, id, token, actor);
    if (rows.isEmpty()) conflict("MODEL_LEASE_LOST"); return rows.getFirst();
  }
  @Transactional
  public Map<String, Object> heartbeat(long id, UUID token, String actor) {
    var b = lease(id, token, actor);
    if ((Boolean) b.get("cancel_requested")) return Map.of("state", "CANCEL_REQUESTED");
    jdbc.update("UPDATE warehouse.model_build SET lease_expires_at = clock_timestamp() + interval '60 seconds' WHERE id = ?", id);
    return Map.of("state", "RUNNING");
  }
  @Transactional
  public Map<String, Object> finish(long id, UUID token, String actor, JsonNode completion) {
    if (!Set.of("READY", "REJECTED", "FAILED", "CANCELLED").contains(completion.path("state").asText()) || completion.toString().length() > 200000) bad("INVALID_MODEL_COMPLETION");
    var prior = jdbc.queryForList("SELECT state, completion FROM warehouse.model_build WHERE id = ? AND lease_token = ? AND lease_owner = ? FOR UPDATE", id, token, actor);
    if (!prior.isEmpty() && prior.getFirst().get("completion") != null) {
      if (!models.tree(prior.getFirst().get("completion")).equals(completion)) conflict("MODEL_COMPLETION_IMMUTABLE");
      return Map.of("id", id, "state", prior.getFirst().get("state"));
    }
    var b = lease(id, token, actor);
    String state = (Boolean) b.get("cancel_requested") ? "CANCELLED" : completion.path("state").asText();
    JsonNode contract = models.tree(b.get("contract"));
    var result = json.createObjectNode(); result.set("worker", completion.path("result"));
    if (state.equals("READY")) {
      if (b.get("frozen_at") == null || b.get("schema_name") == null || !completion.at("/result/dbtPassed").asBoolean()) bad("MODEL_RESULT_NOT_FROZEN");
      String schema = b.get("schema_name").toString(), output = contract.path("output").asText();
      var columns = jdbc.queryForList("SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ? AND c.relname = ? AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum", String.class, schema, output);
      var expected = new ArrayList<String>(); contract.path("fields").forEach(f -> expected.add(f.path("name").asText()));
      var types = jdbc.queryForList("SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ? AND c.relname = ? AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum", String.class, schema, output);
      var expectedTypes = new ArrayList<String>();
      contract.path("fields").forEach(f -> expectedTypes.add(switch (f.path("type").asText()) {
        case "timestamp" -> "timestamp without time zone";
        case "timestamptz" -> "timestamp with time zone";
        default -> f.path("type").asText();
      }));
      boolean schemaPassed = columns.equals(expected) && types.equals(expectedTypes);
      result.put("schemaPassed", schemaPassed);
      if (!schemaPassed) {
        state = "REJECTED";
        result.put("qualityPassed", false).put("schemaError", "MODEL_OUTPUT_SCHEMA_MISMATCH");
        result.set("actualColumns", json.valueToTree(columns)); result.set("actualTypes", json.valueToTree(types));
      } else {
      jdbc.execute("SET LOCAL statement_timeout = '30s'");
      String table = quote(schema) + "." + quote(output);
      long count = jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class);
      var keys = new LinkedHashSet<String>(); contract.path("uniqueKey").forEach(k -> keys.add(k.asText()));
      var required = new LinkedHashSet<String>(keys); contract.path("required").forEach(k -> required.add(k.asText()));
      long nulls = jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE " + String.join(" OR ", required.stream().map(k -> quote(k) + " IS NULL").toList()), Long.class);
      String keySql = String.join(",", keys.stream().map(ModelService::quote).toList());
      long duplicates = jdbc.queryForObject("SELECT count(*) FROM (SELECT " + keySql + " FROM " + table + " GROUP BY " + keySql + " HAVING count(*) > 1) bad_keys", Long.class);
      boolean passed = count <= contract.path("maxOutputRows").asLong() && nulls == 0 && duplicates == 0;
      result.put("rowCount", count).put("nullKeysOrRequired", nulls).put("duplicateKeys", duplicates).put("qualityPassed", passed);
      var rules=quality.evaluate(contract,b,count);
      result.set("rules",rules);result.put("rulesConfigured",contract.path("qualityRules").isArray()&&!contract.path("qualityRules").isEmpty());
      for(JsonNode rule:rules)if(!rule.path("passed").asBoolean()&&rule.path("severity").asText().equals("BLOCK"))passed=false;
      result.put("qualityPassed",passed);
      if (!passed) state = "REJECTED";
      }
    }
    String code = completion.path("errorCode").isTextual() ? completion.path("errorCode").asText() : null;
    if (code != null && !code.matches("[A-Z0-9_:-]{1,120}")) bad("INVALID_ERROR_CODE");
    jdbc.update("UPDATE warehouse.model_build SET state = ?, result = ?::jsonb, completion = ?::jsonb, error_code = ?, finished_at = clock_timestamp(), lease_expires_at = NULL WHERE id = ?", state, result.toString(), completion.toString(), code, id);
    models.audit(actor, "MODEL_BUILD_FINISH", ((Number) b.get("dataset_id")).longValue(), Map.of("buildId", id, "state", state)); return Map.of("id", id, "state", state);
  }
  @Transactional
  public Map<String, Object> cancel(long project, long dataset, long build, String actor) {
    models.dataset(project, dataset, actor, "ENGINEER");
    if (jdbc.update("UPDATE warehouse.model_build SET cancel_requested = TRUE, state = CASE WHEN state = 'QUEUED' THEN 'CANCELLED' ELSE state END WHERE dataset_id = ? AND id = ? AND state IN ('QUEUED','RUNNING')", dataset, build) != 1) conflict("MODEL_BUILD_NOT_RUNNING");
    return Map.of("id", build, "cancelRequested", true);
  }
  @Transactional
  public Map<String, Object> publish(long project, long dataset, long build, String reason, String actor) {
    models.dataset(project, dataset, actor, "OWNER");
    if (reason == null || reason.isBlank() || reason.length() > 1000) bad("PUBLICATION_REASON_REQUIRED");
    var d = jdbc.queryForMap("SELECT * FROM warehouse.dataset WHERE id = ? FOR UPDATE", dataset);
    var existing = jdbc.queryForList("SELECT id FROM warehouse.dataset_release WHERE dataset_id = ? AND build_id = ?", dataset, build);
    if (!existing.isEmpty()) return Map.of("releaseId", existing.getFirst().get("id"), "reused", true);
    var candidates = jdbc.queryForList("SELECT * FROM warehouse.model_build WHERE id = ? AND dataset_id = ? AND state = 'READY'", build, dataset);
    if (candidates.isEmpty()) conflict("MODEL_NOT_READY");
    var refresh=jdbc.queryForList("SELECT p.state,p.active_version,w.plan_version FROM warehouse.refresh_build rb JOIN warehouse.refresh_window w ON w.id=rb.window_id JOIN warehouse.refresh_plan p ON p.id=w.plan_id WHERE rb.build_id=?",build);
    if(!refresh.isEmpty()&&(!refresh.getFirst().get("state").equals("ACTIVE")||!refresh.getFirst().get("active_version").equals(refresh.getFirst().get("plan_version"))))conflict("REFRESH_PLAN_PAUSED_OR_CHANGED");
    var b = candidates.getFirst();
    JsonNode candidateContract=models.tree(jdbc.queryForObject("SELECT contract FROM warehouse.model_version WHERE dataset_id=? AND version=?",String.class,dataset,b.get("model_version")));
    models.requireInputsActive(project,candidateContract,actor);
    quality.checkPublicationPolicies(dataset,candidateContract);

    if (!Objects.equals(d.get("active_release_id"), b.get("expected_release_id"))) conflict("ACTIVE_RELEASE_CHANGED");
    if (!d.get("active_model_version").equals(b.get("model_version"))) conflict("MODEL_VERSION_SUPERSEDED");
    if (d.get("active_release_id") != null) {
      var active = jdbc.queryForMap("SELECT b.watermark FROM warehouse.dataset_release r JOIN warehouse.model_build b ON b.id = r.build_id WHERE r.id = ?", d.get("active_release_id"));
      var earlier = new HashMap<String, JsonNode>();
      models.tree(active.get("watermark")).forEach(w -> earlier.put(w.path("alias").asText(), w));
      for (var w : models.tree(b.get("watermark"))) {
        var old = earlier.get(w.path("alias").asText());
        if (old != null) {
          int order = java.time.Instant.parse(w.path("at").asText()).compareTo(java.time.Instant.parse(old.path("at").asText()));
          if (order < 0 || (order == 0 && w.path("assetVersion").asLong() < old.path("assetVersion").asLong())) conflict("STALE_INPUT_WATERMARK");
        }
      }
    }
    long release = jdbc.queryForObject("INSERT INTO warehouse.dataset_release(dataset_id, build_id, model_version, previous_release_id, published_by, reason) VALUES (?, ?, ?, ?, ?, ?) RETURNING id", Long.class, dataset, build, b.get("model_version"), d.get("active_release_id"), actor, reason);
    jdbc.update("UPDATE warehouse.dataset SET active_release_id = ? WHERE id = ?", release, dataset);
    models.audit(actor, "DATASET_PUBLISH", dataset, Map.of("releaseId", release, "buildId", build, "reason", reason)); return Map.of("releaseId", release, "state", "PUBLISHED");
  }
}
