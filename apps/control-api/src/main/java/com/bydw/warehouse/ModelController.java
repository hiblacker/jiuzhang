package com.bydw.warehouse;

import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/warehouse")
public class ModelController {
  private final ModelService models;
  private final ModelExecutionService execution;
  private final DatasetQueryService query;
  public ModelController(ModelService models, ModelExecutionService execution, DatasetQueryService query) { this.models = models; this.execution = execution; this.query = query; }
  private String actor(HttpServletRequest r) { return (String) r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE); }
  @GetMapping("/projects/{project}/datasets")
  public Object datasets(@PathVariable long project, HttpServletRequest r) { return models.datasets(project, actor(r)); }
  @PostMapping("/projects/{project}/models")
  public Object save(@PathVariable long project, @RequestBody JsonNode body, HttpServletRequest r) { return models.save(project, body, actor(r)); }
  @GetMapping("/projects/{project}/datasets/{dataset}/versions")
  public Object versions(@PathVariable long project, @PathVariable long dataset, HttpServletRequest r) { return models.versions(project, dataset, actor(r)); }
  @GetMapping("/projects/{project}/datasets/{dataset}/releases")
  public Object releases(@PathVariable long project, @PathVariable long dataset, HttpServletRequest r) { return models.releases(project, dataset, actor(r)); }
  @GetMapping("/projects/{project}/datasets/{dataset}/impact")
  public Object impact(@PathVariable long project, @PathVariable long dataset, @RequestParam int version, HttpServletRequest r) { return models.impact(project, dataset, version, actor(r)); }
  @PostMapping(value = "/projects/{project}/datasets/{dataset}/export", produces = "text/csv;charset=UTF-8")
  public org.springframework.http.ResponseEntity<String> export(@PathVariable long project, @PathVariable long dataset, @RequestBody JsonNode body, HttpServletRequest r) {
    var result = query.query(project, dataset, body, actor(r));
    @SuppressWarnings("unchecked") var columns = (List<String>) result.get("columns");
    @SuppressWarnings("unchecked") var rows = (List<Map<String, Object>>) result.get("rows");
    var csv = new StringBuilder(String.join(",", columns.stream().map(this::csv).toList())).append("\r\n");
    for (var row : rows) csv.append(String.join(",", columns.stream().map(c -> csv(row.get(c))).toList())).append("\r\n");
    return org.springframework.http.ResponseEntity.ok().header("X-Release-Id", result.get("releaseId").toString())
        .header("X-Policy-Revision", result.get("policyRevision").toString()).header("X-Row-Count", String.valueOf(rows.size()))
        .body(csv.toString());
  }
  private String csv(Object value) {
    String s = value == null ? "" : value.toString();
    if (s.matches("(?s)^[=+@\\-\\t\\r].*")) s = "'" + s;
    return "\"" + s.replace("\"", "\"\"") + "\"";
  }
  @PostMapping("/projects/{project}/datasets/{dataset}/builds")
  public Object build(@PathVariable long project, @PathVariable long dataset, @RequestBody JsonNode body, HttpServletRequest r) { return models.build(project, dataset, body, actor(r)); }
  @GetMapping("/projects/{project}/datasets/{dataset}/builds")
  public Object builds(@PathVariable long project, @PathVariable long dataset, HttpServletRequest r) { return models.builds(project, dataset, actor(r)); }
  @PostMapping("/projects/{project}/datasets/{dataset}/builds/{build}/cancel")
  public Object cancel(@PathVariable long project, @PathVariable long dataset, @PathVariable long build, HttpServletRequest r) { return execution.cancel(project, dataset, build, actor(r)); }
  @PostMapping("/projects/{project}/datasets/{dataset}/builds/{build}/publish")
  public Object publish(@PathVariable long project, @PathVariable long dataset, @PathVariable long build, @RequestBody JsonNode body, HttpServletRequest r) { return execution.publish(project, dataset, build, body.path("reason").asText(), actor(r)); }
  @PostMapping("/projects/{project}/datasets/{dataset}/policy")
  public Object policy(@PathVariable long project, @PathVariable long dataset, @RequestBody JsonNode body, HttpServletRequest r) { return query.policy(project, dataset, body, actor(r)); }
  @PostMapping("/projects/{project}/datasets/{dataset}/query")
  public Object query(@PathVariable long project, @PathVariable long dataset, @RequestBody JsonNode body, HttpServletRequest r) { return query.query(project, dataset, body, actor(r)); }
  @PostMapping("/builds/claim")
  public Object claim(@RequestBody Capabilities body, HttpServletRequest r) { return execution.claim(body.runtimeRefs(), actor(r)); }
  @PostMapping("/builds/{id}/heartbeat")
  public Object heartbeat(@PathVariable long id, @RequestBody Lease body, HttpServletRequest r) { return execution.heartbeat(id, body.leaseToken(), actor(r)); }
  @PostMapping("/builds/{id}/finish")
  public Object finish(@PathVariable long id, @RequestBody JsonNode body, HttpServletRequest r) {
    UUID token;
    try { token = UUID.fromString(body.path("leaseToken").asText()); }
    catch (Exception error) { ModelService.bad("INVALID_MODEL_LEASE"); return Map.of(); }
    return execution.finish(id, token, actor(r), body);
  }
  public record Capabilities(List<String> runtimeRefs) {}
  public record Lease(UUID leaseToken) {}
}
