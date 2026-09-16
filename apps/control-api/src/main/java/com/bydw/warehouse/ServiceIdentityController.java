package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/warehouse/projects/{project}/service-identities")
public class ServiceIdentityController {
  private final JdbcTemplate jdbc;private final ProductAccessService access;
  public ServiceIdentityController(JdbcTemplate jdbc,ProductAccessService access){this.jdbc=jdbc;this.access=access;}
  @PostMapping @Transactional public Object create(@PathVariable long project,@RequestBody JsonNode b,HttpServletRequest r){
    String actor=actor(r);access.require(project,actor,"OWNER");String id=SystemCatalogService.code(b,"id"),role=b.path("role").asText();
    if(id.startsWith("local-")||!java.util.Set.of("OWNER","ENGINEER","VIEWER").contains(role))SystemCatalogService.bad("INVALID_SERVICE_IDENTITY");
    String token=token();jdbc.update("INSERT INTO warehouse.identity(id,token_sha256) VALUES (?,?)",id,ProductAccessService.hash(token));
    jdbc.update("INSERT INTO warehouse.service_identity_owner(identity_id,project_id,created_by) VALUES (?,?,?)",id,project,actor);
    jdbc.update("INSERT INTO warehouse.project_member(project_id,identity_id,role) VALUES (?,?,?)",project,id,role);audit(actor,"SERVICE_IDENTITY_CREATE",id);return Map.of("id",id,"token",token,"revision",1);
  }
  @PostMapping("/{id}/rotate") @Transactional public Object rotate(@PathVariable long project,@PathVariable String id,@RequestBody JsonNode b,HttpServletRequest r){
    access.require(project,actor(r),"OWNER");String token=token();
    if(jdbc.update("UPDATE warehouse.service_identity_owner SET token_revision=token_revision+1 WHERE identity_id=? AND project_id=? AND token_revision=?",id,project,b.path("expectedRevision").asLong(-1))!=1)SystemCatalogService.conflict("SERVICE_IDENTITY_CHANGED");
    if(jdbc.update("UPDATE warehouse.identity SET token_sha256=? WHERE id=? AND enabled",ProductAccessService.hash(token),id)!=1)SystemCatalogService.conflict("SERVICE_IDENTITY_DISABLED");audit(actor(r),"SERVICE_TOKEN_ROTATE",id);return Map.of("id",id,"token",token,"revision",b.path("expectedRevision").asLong()+1);
  }
  @PostMapping("/{id}/revoke") @Transactional public Object revoke(@PathVariable long project,@PathVariable String id,@RequestBody JsonNode b,HttpServletRequest r){
    access.require(project,actor(r),"OWNER");
    if(jdbc.update("UPDATE warehouse.service_identity_owner SET token_revision=token_revision+1 WHERE identity_id=? AND project_id=? AND token_revision=?",id,project,b.path("expectedRevision").asLong(-1))!=1)SystemCatalogService.conflict("SERVICE_IDENTITY_CHANGED");
    jdbc.update("UPDATE warehouse.identity SET enabled=false WHERE id=?",id);audit(actor(r),"SERVICE_IDENTITY_REVOKE",id);return Map.of("id",id,"enabled",false);
  }
  @GetMapping public Object list(@PathVariable long project,HttpServletRequest r){access.require(project,actor(r),"OWNER");return jdbc.queryForList("SELECT o.identity_id,o.token_revision,i.enabled,m.role FROM warehouse.service_identity_owner o JOIN warehouse.identity i ON i.id=o.identity_id JOIN warehouse.project_member m ON m.identity_id=i.id AND m.project_id=o.project_id WHERE o.project_id=? ORDER BY o.identity_id",project);}
  private static String token(){byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);}
  private void audit(String actor,String action,String id){jdbc.update("INSERT INTO control.audit_log(principal,action,resource,result,details) VALUES (?,?,?,'SUCCESS','{}')",actor,action,"service-identity/"+id);}
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
