package com.bydw.warehouse;

import com.bydw.api.ApiException;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/warehouse")
public class ProductController {
  private final JdbcTemplate jdbc;
  private final ProductAccessService access;
  private final ObjectMapper json;
  public ProductController(JdbcTemplate jdbc, ProductAccessService access, ObjectMapper json) { this.jdbc = jdbc; this.access = access; this.json = json; }
  public record ProjectInput(String code, String name, String description) {}
  public record IdentityInput(String id) {}
  public record MemberInput(String identity, String role) {}
  public record SourceInput(String sourceCode) {}
  @GetMapping("/projects")
  public List<Map<String, Object>> projects(@RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) { return access.projects(actor); }
  @PostMapping("/projects") @Transactional
  public Map<String, Object> create(@RequestBody ProjectInput r, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.requireAdmin(actor);
    if (r == null || !code(r.code()) || r.name() == null || r.name().isBlank() || r.name().length() > 100 || (r.description() != null && r.description().length() > 2000)) bad("INVALID_PROJECT");
    var row = jdbc.queryForMap("INSERT INTO warehouse.project(code, name, description) VALUES (?, ?, ?) RETURNING id, code, name, description", r.code(), r.name(), r.description() == null ? "" : r.description());
    audit(actor, "PROJECT_CREATE", row.get("id").toString()); return row;
  }
  @GetMapping("/identities")
  public List<Map<String, Object>> identities(@RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.requireAdmin(actor); return jdbc.queryForList("SELECT id, enabled, created_at FROM warehouse.identity ORDER BY id LIMIT 200");
  }
  @PostMapping("/identities") @Transactional
  public Map<String, Object> identity(@RequestBody IdentityInput r, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.requireAdmin(actor);
    if (r == null || !code(r.id()) || r.id().startsWith("local-")) bad("INVALID_IDENTITY");
    byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    jdbc.update("INSERT INTO warehouse.identity(id, token_sha256) VALUES (?, ?)", r.id(), ProductAccessService.hash(token));
    audit(actor, "IDENTITY_CREATE", r.id()); return Map.of("id", r.id(), "token", token);
  }
  @PostMapping("/identities/{id}/revoke") @Transactional
  public Map<String, Object> revoke(@PathVariable String id, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.requireAdmin(actor); if (jdbc.update("UPDATE warehouse.identity SET enabled = FALSE WHERE id = ?", id) != 1) bad("IDENTITY_NOT_FOUND");
    audit(actor, "IDENTITY_REVOKE", id); return Map.of("id", id, "enabled", false);
  }
  @GetMapping("/projects/{project}/members")
  public List<Map<String, Object>> members(@PathVariable long project, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.require(project, actor, "OWNER"); return jdbc.queryForList("SELECT m.identity_id, m.role, i.enabled FROM warehouse.project_member m JOIN warehouse.identity i ON i.id = m.identity_id WHERE m.project_id = ? ORDER BY m.identity_id", project);
  }
  @PostMapping("/projects/{project}/members") @Transactional
  public Map<String, Object> member(@PathVariable long project, @RequestBody MemberInput r, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.require(project, actor, "OWNER");
    if (r == null || !code(r.identity()) || !List.of("OWNER", "ENGINEER", "VIEWER").contains(r.role() == null ? "" : r.role())) bad("INVALID_PROJECT_MEMBER");
    if (jdbc.queryForObject("SELECT count(*) FROM warehouse.identity WHERE id = ? AND enabled", Long.class, r.identity()) != 1) bad("IDENTITY_NOT_FOUND");
    jdbc.update("INSERT INTO warehouse.project_member(project_id, identity_id, role) VALUES (?, ?, ?) ON CONFLICT(project_id, identity_id) DO UPDATE SET role = EXCLUDED.role", project, r.identity(), r.role());
    audit(actor, "PROJECT_MEMBER_CHANGE", project + "/" + r.identity()); return Map.of("projectId", project, "identity", r.identity(), "role", r.role());
  }
  @PostMapping("/projects/{project}/sources") @Transactional
  public Map<String, Object> bind(@PathVariable long project, @RequestBody SourceInput r, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    // Global source assignment crosses project boundaries and remains administrator-only.
    access.requireAdmin(actor); access.require(project, actor, "OWNER");
    if (r == null || !code(r.sourceCode())) bad("INVALID_SOURCE_CODE");
    var rows = jdbc.queryForList("SELECT id FROM control.source_connection WHERE code = ?", r.sourceCode());
    if (rows.isEmpty()) bad("SOURCE_NOT_FOUND");
    Object source = rows.getFirst().get("id");
    jdbc.update("INSERT INTO warehouse.project_source(source_id, project_id) VALUES (?, ?) ON CONFLICT DO NOTHING", source, project);
    if (jdbc.queryForObject("SELECT project_id FROM warehouse.project_source WHERE source_id = ?", Long.class, source) != project) throw new ApiException(HttpStatus.CONFLICT, "SOURCE_ALREADY_ASSIGNED", "Source is assigned to another project");
    audit(actor, "PROJECT_SOURCE_BIND", project + "/" + source); return Map.of("projectId", project, "sourceCode", r.sourceCode());
  }
  @GetMapping("/projects/{project}/sources")
  public List<Map<String, Object>> sources(@PathVariable long project, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.require(project, actor, "VIEWER");
    return jdbc.queryForList("SELECT s.id, s.code, s.source_type FROM control.source_connection s JOIN warehouse.project_source ps ON ps.source_id = s.id WHERE ps.project_id = ? ORDER BY s.code", project);
  }
  @GetMapping("/projects/{project}/assets")
  public List<Map<String, Object>> assets(@PathVariable long project, @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.require(project, actor, "VIEWER"); limits(limit, offset);
    return jdbc.queryForList("""
        SELECT * FROM (
          SELECT 'mysql:' || o.id AS id, s.code AS source_code, so.object_name AS name, 'TABLE' AS kind,
            o.state, o.row_count, o.byte_count, r.id AS run_id, r.scheduled_window_start AS data_window,
            r.finished_at AS received_at, so.id AS schema_id, r.plan_version AS contract_version
          FROM lake.object_run o JOIN lake.system_run r ON r.id = o.system_run_id
          JOIN lake.source_object so ON so.id = o.source_object_id
          JOIN control.source_connection s ON s.id = r.source_id JOIN warehouse.project_source ps ON ps.source_id = s.id
          WHERE ps.project_id = ?
          UNION ALL
          SELECT 'external:' || a.id, s.code, a.object_key, a.kind, a.state, a.row_count, a.byte_count,
            a.execution_id, a.business_date::timestamp AT TIME ZONE 'Asia/Shanghai', a.created_at, NULL, NULL
          FROM warehouse.external_asset a JOIN control.source_connection s ON s.id = a.source_id
          JOIN warehouse.project_source ps ON ps.source_id = s.id WHERE ps.project_id = ?
        ) assets ORDER BY received_at DESC NULLS LAST, id LIMIT ? OFFSET ?
        """, project, project, limit, offset);
  }
  @GetMapping("/projects/{project}/assets/{asset}")
  public Map<String, Object> asset(@PathVariable long project, @PathVariable String asset, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.require(project, actor, "VIEWER");
    if (!asset.matches("(mysql|external):[0-9]{1,18}")) bad("INVALID_ASSET_ID");
    long id = Long.parseLong(asset.split(":")[1]); List<Map<String, Object>> rows;
    if (asset.startsWith("mysql:")) rows = jdbc.queryForList("""
        SELECT so.object_name AS name, so.schema_json AS schema, so.primary_key_json AS primary_key,
          so.strategy, o.state, o.row_count, o.byte_count, o.raw_sha256 AS sha256, o.schema_sha256,
          o.error_code, r.id AS run_id, r.plan_version, r.consistency, r.started_at, r.finished_at,
          r.scheduled_window_start, r.scheduled_window_end, s.code AS source_code
        FROM lake.object_run o JOIN lake.source_object so ON so.id = o.source_object_id
        JOIN lake.system_run r ON r.id = o.system_run_id JOIN control.source_connection s ON s.id = r.source_id
        JOIN warehouse.project_source ps ON ps.source_id = s.id WHERE o.id = ? AND ps.project_id = ?
        """, id, project);
    else rows = jdbc.queryForList("""
        SELECT a.object_key AS name, a.kind, a.state, a.schema_json AS schema, a.contract_sha256,
          a.row_count, a.byte_count, a.business_date, a.execution_id, a.created_at, s.code AS source_code
        FROM warehouse.external_asset a JOIN control.source_connection s ON s.id = a.source_id
        JOIN warehouse.project_source ps ON ps.source_id = s.id WHERE a.id = ? AND ps.project_id = ?
        """, id, project);
    if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "ASSET_NOT_FOUND", "Asset not found in project");
    var row = rows.getFirst(); decode(row, "schema"); decode(row, "primary_key"); row.put("id", asset); return row;
  }
  @GetMapping("/projects/{project}/coverage/{run}")
  public Map<String, Object> coverage(@PathVariable long project, @PathVariable long run, @RequestAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE) String actor) {
    access.require(project, actor, "VIEWER");
    var runs = jdbc.queryForList("SELECT r.id, r.state, r.plan_version, r.source_id FROM lake.system_run r JOIN warehouse.project_source ps ON ps.source_id = r.source_id WHERE r.id = ? AND ps.project_id = ?", run, project);
    if (runs.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "Run not found in project");
    var result = new LinkedHashMap<String, Object>(runs.getFirst()); result.remove("source_id");
    result.put("coverage", jdbc.queryForMap("""
        SELECT count(*) FILTER(WHERE so.required) AS required,
          count(*) FILTER(WHERE so.required AND o.state IN ('RAW_COMMITTED','PARSED')) AS committed,
          count(*) FILTER(WHERE so.required AND o.state = 'FAILED') AS failed,
          count(*) FILTER(WHERE so.required AND (o.id IS NULL OR o.state NOT IN ('RAW_COMMITTED','PARSED','FAILED'))) AS missing,
          coalesce(sum(o.row_count),0) AS rows
        FROM lake.system_run r JOIN lake.inventory i ON i.source_id = r.source_id AND i.plan_version = r.plan_version
        JOIN lake.source_object so ON so.inventory_id = i.id LEFT JOIN lake.object_run o ON o.source_object_id = so.id AND o.system_run_id = r.id
        WHERE r.id = ?
        """, run)); return result;
  }
  private void decode(Map<String, Object> row, String key) {
    if (row.get(key) == null) return;
    try { row.put(key, json.readTree(row.get(key).toString())); } catch (Exception error) { throw new IllegalStateException("INVALID_STORED_JSON"); }
  }
  private void audit(String actor, String action, String resource) { jdbc.update("INSERT INTO control.audit_log(principal, action, resource, result, details) VALUES (?, ?, ?, 'SUCCESS', '{}'::jsonb)", actor, action, "warehouse/" + resource); }
  private static boolean code(String value) { return value != null && value.matches("[a-z][a-z0-9._-]{1,99}"); }
  private static void limits(int limit, int offset) { if (limit < 1 || limit > 200 || offset < 0 || offset > 1000000) bad("INVALID_PAGE"); }
  private static void bad(String code) { throw new ApiException(HttpStatus.BAD_REQUEST, code, code); }
}
