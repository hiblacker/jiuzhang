package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/warehouse/projects/{project}")
public class OperationsController {
  private final OperationalIncidentService incidents;private final ProductAccessService access;private final JdbcTemplate jdbc;
  public OperationsController(OperationalIncidentService incidents,ProductAccessService access,JdbcTemplate jdbc){this.incidents=incidents;this.access=access;this.jdbc=jdbc;}
  @GetMapping("/incidents")public Object list(@PathVariable long project,@RequestParam(defaultValue="")String q,@RequestParam(defaultValue="")String state,@RequestParam(defaultValue="25")int limit,@RequestParam(defaultValue="0")int offset,HttpServletRequest r){return incidents.list(project,actor(r),q,state,limit,offset);}
  @PostMapping("/incidents/reconcile")public Object reconcile(@PathVariable long project,HttpServletRequest r){return incidents.reconcile(project,actor(r));}
  @GetMapping("/incidents/{id}")public Object detail(@PathVariable long project,@PathVariable long id,HttpServletRequest r){return incidents.detail(project,id,actor(r));}
  @PostMapping("/incidents/{id}/acknowledge")public Object ack(@PathVariable long project,@PathVariable long id,@RequestBody JsonNode body,HttpServletRequest r){return incidents.acknowledge(project,id,body,actor(r));}
  @GetMapping("/query-audit") @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public Object audit(@PathVariable long project,@RequestParam(defaultValue="25")int limit,@RequestParam(defaultValue="0")int offset,HttpServletRequest r){
    access.require(project,actor(r),"OWNER");SystemCatalogService.page("",limit,offset);return Map.of("items",jdbc.queryForList("SELECT id,dataset_id,actor,action,release_id,policy_revision,request_id,fields,filter_sha256,returned_rows,elapsed_ms,result,created_at FROM warehouse.query_audit WHERE project_id=? ORDER BY id DESC LIMIT ? OFFSET ?",project,limit,offset),"total",jdbc.queryForObject("SELECT count(*) FROM warehouse.query_audit WHERE project_id=?",Long.class,project),"limit",limit,"offset",offset);
  }
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
