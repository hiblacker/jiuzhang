package com.bydw.warehouse;

import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/**
 * Console and worker endpoints for typed datasources and registered SQL.
 *
 * Console paths carry the project and check membership; the /api/v1/lake/** paths are the
 * worker side (claim/finish/record) and are authorised by the worker token plus the
 * environment carried in the request.
 */
@RestController
public class SqlIngestionController {
  private final DataSourceService dataSources;
  private final SqlDefinitionService sql;

  public SqlIngestionController(DataSourceService dataSources, SqlDefinitionService sql) {
    this.dataSources = dataSources; this.sql = sql;
  }

  // ---- datasource (admin) ------------------------------------------------------------------
  @PostMapping("/api/v1/warehouse/resources/{resource}/datasource")
  public Object configureDatasource(@PathVariable long resource, @RequestBody JsonNode b, HttpServletRequest r) {
    return dataSources.configure(resource, b, actor(r));
  }

  @GetMapping("/api/v1/warehouse/resources/{resource}/datasource")
  public Object datasource(@PathVariable long resource, HttpServletRequest r) {
    return dataSources.detail(resource, actor(r));
  }

  @PostMapping("/api/v1/warehouse/resources/{resource}/tests") @ResponseStatus(HttpStatus.ACCEPTED)
  public Object requestTest(@PathVariable long resource, @RequestBody JsonNode b, HttpServletRequest r) {
    return dataSources.requestTest(resource, b, actor(r));
  }

  @GetMapping("/api/v1/warehouse/resources/{resource}/tests")
  public Object tests(@PathVariable long resource, HttpServletRequest r) {
    return dataSources.tests(resource, actor(r));
  }

  // ---- registered SQL (project scoped) ------------------------------------------------------
  @GetMapping("/api/v1/warehouse/projects/{project}/channels/{source}/sql")
  public Object draft(@PathVariable long project, @PathVariable long source, HttpServletRequest r) {
    return sql.draft(project, source, actor(r));
  }

  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/sql/validate")
  public Object validate(@PathVariable long project, @PathVariable long source, @RequestBody JsonNode b, HttpServletRequest r) {
    return sql.validate(project, source, b, actor(r));
  }

  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/sql/draft")
  public Object saveDraft(@PathVariable long project, @PathVariable long source, @RequestBody JsonNode b, HttpServletRequest r) {
    return sql.saveDraft(project, source, b, actor(r));
  }

  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/sql/previews") @ResponseStatus(HttpStatus.ACCEPTED)
  public Object requestPreview(@PathVariable long project, @PathVariable long source, @RequestBody JsonNode b, HttpServletRequest r) {
    return sql.requestPreview(project, source, b, actor(r));
  }

  @GetMapping("/api/v1/warehouse/projects/{project}/channels/{source}/sql/previews/{id}")
  public Object preview(@PathVariable long project, @PathVariable long source, @PathVariable long id, HttpServletRequest r) {
    return sql.preview(project, source, id, actor(r));
  }

  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/sql/versions")
  public Object saveVersion(@PathVariable long project, @PathVariable long source, @RequestBody JsonNode b, HttpServletRequest r) {
    return sql.saveVersion(project, source, b, actor(r));
  }

  @GetMapping("/api/v1/warehouse/projects/{project}/channels/{source}/sql/versions")
  public Object versions(@PathVariable long project, @PathVariable long source, HttpServletRequest r) {
    return sql.versions(project, source, actor(r));
  }

  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/sql/versions/{version}/enable")
  public Object enableVersion(@PathVariable long project, @PathVariable long source, @PathVariable long version,
      @RequestBody JsonNode b, HttpServletRequest r) {
    return sql.enableVersion(project, source, version, b, actor(r));
  }

  @GetMapping("/api/v1/warehouse/projects/{project}/channels/{source}/seatunnel-jobs")
  public Object jobs(@PathVariable long project, @PathVariable long source, HttpServletRequest r) {
    return sql.jobs(project, source, actor(r));
  }

  // ---- worker ------------------------------------------------------------------------------
  @PostMapping("/api/v1/lake/resource-tests/claim")
  public Object claimTest(@RequestBody JsonNode b, HttpServletRequest r) {
    return dataSources.claimTest(b.path("environment").asText(), actor(r));
  }

  @PostMapping("/api/v1/lake/resource-tests/{id}/finish")
  public Object finishTest(@PathVariable long id, @RequestBody JsonNode b, HttpServletRequest r) {
    return dataSources.finishTest(id, b, actor(r));
  }

  @PostMapping("/api/v1/lake/sql-previews/claim")
  public Object claimPreview(@RequestBody JsonNode b, HttpServletRequest r) {
    return sql.claimPreview(b.path("environment").asText(), actor(r));
  }

  @PostMapping("/api/v1/lake/sql-previews/{id}/finish")
  public Object finishPreview(@PathVariable long id, @RequestBody JsonNode b, HttpServletRequest r) {
    return sql.finishPreview(id, b, actor(r));
  }

  @PostMapping("/api/v1/lake/seatunnel-jobs")
  public Object recordSeatunnelJob(@RequestBody JsonNode b, HttpServletRequest r) {
    return sql.recordSeatunnelJob(b, actor(r));
  }

  private String actor(HttpServletRequest request) {
    return (String) request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);
  }
}
