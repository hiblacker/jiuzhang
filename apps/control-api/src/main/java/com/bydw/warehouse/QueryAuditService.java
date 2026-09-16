package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
@Service
public class QueryAuditService {
  private final JdbcTemplate jdbc;private final ObjectMapper json;
  public QueryAuditService(JdbcTemplate jdbc,ObjectMapper json){this.jdbc=jdbc;this.json=json;}
  @Transactional(propagation=Propagation.REQUIRES_NEW)
  public void record(long project,long dataset,String actor,String action,JsonNode request,Map<String,Object> result,String code,long elapsed){
    String requestId=UUID.randomUUID().toString();
    if(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes){Object id=attributes.getRequest().getAttribute(RequestAuthenticationFilter.REQUEST_ID_ATTRIBUTE);if(id!=null)requestId=id.toString();}
    // Retain a digest of conditions, never filter literals or returned rows.
    var filters=json.createObjectNode();for(String name:new String[]{"equals","filters","sort"})if(request!=null&&request.has(name))filters.set(name,request.path(name));
    var fields=json.createArrayNode();
    if(result!=null)for(Object field:(java.util.List<?>)result.get("columns"))fields.add(field.toString());
    jdbc.update("INSERT INTO warehouse.query_audit(project_id,dataset_id,actor,action,release_id,policy_revision,request_id,fields,filter_sha256,returned_rows,elapsed_ms,result) VALUES (?,?,?,?,?,?,?,?::jsonb,?,?,?,?)",
        project,dataset,actor,action,result==null?null:result.get("releaseId"),result==null?null:result.get("policyRevision"),requestId,fields.toString(),ProductAccessService.hash(filters.toString()),result==null?null:((java.util.List<?>)result.get("rows")).size(),elapsed,code);
  }
}
