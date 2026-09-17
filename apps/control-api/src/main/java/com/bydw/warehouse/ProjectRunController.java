package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.bydw.lake.LakeExecutionService;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/warehouse/projects/{project}/runs/{id}")
public class ProjectRunController {
  private final JdbcTemplate jdbc;private final ProductAccessService access;private final LakeExecutionService lake;private final ModelService models;
  public ProjectRunController(JdbcTemplate jdbc,ProductAccessService access,LakeExecutionService lake,ModelService models){this.jdbc=jdbc;this.access=access;this.lake=lake;this.models=models;}
  private void require(long project,long id,String actor,String role){access.require(project,actor,role);if(jdbc.queryForObject("SELECT count(*) FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id JOIN lake.ingestion_plan p ON p.id=w.plan_id JOIN warehouse.project_source ps ON ps.source_id=p.source_id WHERE a.id=? AND ps.project_id=?",Long.class,id,project)!=1)SystemCatalogService.denied();}
  @GetMapping public Object detail(@PathVariable long project,@PathVariable long id,HttpServletRequest r){require(project,id,actor(r),"VIEWER");var row=jdbc.queryForMap("SELECT a.id,a.window_id,a.state,a.attempt,a.error_code,a.result,a.cancel_requested,a.started_at,a.finished_at,a.lease_expires_at,w.business_date,w.plan_version,w.revision,p.dispatch_reason FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id JOIN lake.ingestion_plan p ON p.id=w.plan_id WHERE a.id=?",id);models.decode(row,"result");return row;}
  @PostMapping("/retry")public Object retry(@PathVariable long project,@PathVariable long id,HttpServletRequest r){require(project,id,actor(r),"ENGINEER");return lake.retry(id,actor(r));}
  @PostMapping("/cancel")public Object cancel(@PathVariable long project,@PathVariable long id,HttpServletRequest r){require(project,id,actor(r),"ENGINEER");lake.cancel(id,actor(r));return Map.of("cancelRequested",true);}
  @PostMapping("/approve-schema")public Object approve(@PathVariable long project,@PathVariable long id,@RequestBody JsonNode b,HttpServletRequest r){require(project,id,actor(r),"OWNER");return lake.approveSchema(id,b.path("reason").asText(),actor(r));}
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
