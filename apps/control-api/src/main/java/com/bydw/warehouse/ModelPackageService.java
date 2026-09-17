package com.bydw.warehouse;

import static com.bydw.warehouse.SystemCatalogService.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModelPackageService {
  private final JdbcTemplate jdbc;
  private final ProductAccessService access;
  private final ObjectMapper json;
  public ModelPackageService(JdbcTemplate jdbc,ProductAccessService access,ObjectMapper json){this.jdbc=jdbc;this.access=access;this.json=json;}

  @Transactional public Object register(JsonNode body,String actor){
    access.requireAdmin(actor);
    String code=code(body,"code");
    if(!code.matches("[a-z][a-z0-9_-]{1,70}")||!body.path("workerIds").isArray()||body.path("workerIds").isEmpty()
        ||body.path("workerIds").size()>100||!body.path("projectPaths").isArray()||body.path("projectPaths").isEmpty()||body.path("projectPaths").size()>100)bad("INVALID_MODEL_REPOSITORY");
    for(JsonNode worker:body.path("workerIds"))if(!worker.isTextual()||!worker.asText().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,99}"))bad("INVALID_WORKER_ID");
    for(JsonNode path:body.path("projectPaths"))if(!validPath(path.asText()))bad("INVALID_MODEL_PROJECT_PATH");
    jdbc.update("INSERT INTO warehouse.model_repository(code,name,worker_ids,project_paths,created_by) VALUES (?,?,?::jsonb,?::jsonb,?)",code,text(body,"name",100,true),body.path("workerIds").toString(),body.path("projectPaths").toString(),actor);
    audit(actor,"MODEL_REPOSITORY_CREATE",code);return Map.of("code",code);
  }
  @Transactional public Object grant(String repository,JsonNode body,String actor){
    access.requireAdmin(actor);long project=body.path("projectId").asLong(-1);access.require(project,actor,"OWNER");
    jdbc.update("INSERT INTO warehouse.model_repository_project(repository_code,project_id,enabled) VALUES (?,?,?) ON CONFLICT(repository_code,project_id) DO UPDATE SET enabled=EXCLUDED.enabled",repository,project,body.path("enabled").asBoolean(true));
    audit(actor,"MODEL_REPOSITORY_GRANT",repository);return Map.of("updated",true);
  }
  public Object repositories(long project,String actor){
    access.require(project,actor,"ENGINEER");
    var rows=jdbc.queryForList("SELECT r.code,r.name,r.project_paths FROM warehouse.model_repository r JOIN warehouse.model_repository_project p ON p.repository_code=r.code WHERE p.project_id=? AND p.enabled AND r.enabled ORDER BY r.code",project);
    rows.forEach(r->r.put("project_paths",tree(r.get("project_paths"))));return rows;
  }
  public void allowed(long project,String repository,String actor){
    access.require(project,actor,"ENGINEER");
    if(jdbc.queryForObject("SELECT count(*) FROM warehouse.model_repository r JOIN warehouse.model_repository_project p ON p.repository_code=r.code WHERE r.code=? AND p.project_id=? AND p.enabled AND r.enabled",Long.class,repository,project)!=1)denied();
  }
  @Transactional public Object submit(long project,JsonNode body,String actor){
    String repository=code(body,"repository"),path=text(body,"projectPath",300,true),revision=text(body,"revision",200,true),key=text(body,"requestKey",100,true);
    allowed(project,repository,actor);
    if(!validPath(path)||!revision.matches("[A-Za-z0-9][A-Za-z0-9._/-]{0,199}")||revision.contains("..")||revision.endsWith("/"))bad("INVALID_MODEL_REVISION");
    if(!contains(tree(jdbc.queryForObject("SELECT project_paths FROM warehouse.model_repository WHERE code=?",String.class,repository)),path))bad("MODEL_PROJECT_PATH_NOT_APPROVED");
    jdbc.update("INSERT INTO warehouse.model_package_request(project_id,repository_code,project_path,requested_revision,request_key,requested_by) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",project,repository,path,revision,key,actor);
    var row=jdbc.queryForMap("SELECT id,state,repository_code,project_path,requested_revision FROM warehouse.model_package_request WHERE project_id=? AND request_key=?",project,key);
    if(!row.get("repository_code").equals(repository)||!row.get("project_path").equals(path)||!row.get("requested_revision").equals(revision))conflict("PACKAGE_REQUEST_CONFLICT");
    return row;
  }
  @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public Object list(long project,String actor,int limit,int offset){
    access.require(project,actor,"ENGINEER");page("",limit,offset);
    var rows=jdbc.queryForList("SELECT r.id,r.repository_code,r.project_path,r.requested_revision,r.state,r.error_code,r.created_at,p.id AS package_id,p.git_revision,p.bundle_sha256,p.contract FROM warehouse.model_package_request r LEFT JOIN warehouse.model_package p ON p.request_id=r.id WHERE r.project_id=? ORDER BY r.id DESC LIMIT ? OFFSET ?",project,limit,offset);
    rows.forEach(r->{if(r.get("contract")!=null)r.put("contract",tree(r.get("contract")));});
    return Map.of("items",rows,"total",jdbc.queryForObject("SELECT count(*) FROM warehouse.model_package_request WHERE project_id=?",Long.class,project),"limit",limit,"offset",offset);
  }
  @Transactional public Object claim(List<String> repositories,String worker){
    if(repositories==null||repositories.isEmpty()||repositories.size()>100||repositories.stream().anyMatch(r->!r.matches("[a-z][a-z0-9_-]{1,70}")))bad("MODEL_REPOSITORY_CAPABILITIES_REQUIRED");
    jdbc.update("UPDATE warehouse.model_package_request SET state='FAILED',error_code='PACKAGE_LEASE_EXPIRED',finished_at=clock_timestamp() WHERE state='RUNNING' AND lease_expires_at<=clock_timestamp()");
    var rows=jdbc.queryForList("SELECT q.*,r.worker_ids FROM warehouse.model_package_request q JOIN warehouse.model_repository r ON r.code=q.repository_code WHERE q.state='QUEUED' AND r.enabled AND r.code IN ("+String.join(",",Collections.nCopies(repositories.size(),"?"))+") ORDER BY q.id FOR UPDATE OF q SKIP LOCKED",repositories.toArray());
    for(var row:rows){
      if(!contains(tree(row.get("worker_ids")),worker))continue;
      try{allowed(((Number)row.get("project_id")).longValue(),row.get("repository_code").toString(),row.get("requested_by").toString());}
      catch(com.bydw.api.ApiException e){jdbc.update("UPDATE warehouse.model_package_request SET state='FAILED',error_code='PROJECT_ACCESS_DENIED',finished_at=clock_timestamp() WHERE id=?",row.get("id"));continue;}
      UUID token=UUID.randomUUID();jdbc.update("UPDATE warehouse.model_package_request SET state='RUNNING',lease_owner=?,lease_token=?,lease_expires_at=clock_timestamp()+interval '300 seconds' WHERE id=?",worker,token,row.get("id"));
      row.remove("worker_ids");row.put("state","RUNNING");row.put("leaseToken",token);return row;
    }
    return Map.of("state","IDLE");
  }
  @Transactional public Object finish(long id,JsonNode body,String worker){
    UUID token;try{token=UUID.fromString(body.path("leaseToken").asText());}catch(Exception e){bad("INVALID_PACKAGE_LEASE");return Map.of();}
    if(body.toString().length()>100000)bad("PACKAGE_RESULT_LIMIT");
    var rows=jdbc.queryForList("SELECT *,lease_expires_at>clock_timestamp() AS valid FROM warehouse.model_package_request WHERE id=? AND lease_owner=? AND lease_token=? FOR UPDATE",id,worker,token);
    if(rows.isEmpty())conflict("PACKAGE_LEASE_LOST");var row=rows.getFirst();
    if(row.get("result")!=null){if(!tree(row.get("result")).equals(body))conflict("PACKAGE_RESULT_IMMUTABLE");return Map.of("id",id,"state",row.get("state"));}
    if(!row.get("state").equals("RUNNING")||!Boolean.TRUE.equals(row.get("valid")))conflict("PACKAGE_LEASE_LOST");
    allowed(((Number)row.get("project_id")).longValue(),row.get("repository_code").toString(),row.get("requested_by").toString());
    String state=body.path("state").asText();
    if(state.equals("COMPLETE")){
      if(!body.path("gitRevision").asText().matches("[0-9a-f]{40}")||!body.path("bundleSha256").asText().matches("[0-9a-f]{64}")||!body.path("contract").isObject()||body.path("contract").toString().length()>65536||body.path("fileCount").asInt()<1||body.path("fileCount").asInt()>500)bad("INVALID_MODEL_PACKAGE");
      jdbc.update("INSERT INTO warehouse.model_package(request_id,project_id,repository_code,project_path,git_revision,bundle_sha256,contract,file_count,created_by) VALUES (?,?,?,?,?,?,?::jsonb,?,?)",id,row.get("project_id"),row.get("repository_code"),row.get("project_path"),body.path("gitRevision").asText(),body.path("bundleSha256").asText(),body.path("contract").toString(),body.path("fileCount").asInt(),row.get("requested_by"));
    }else if(!state.equals("FAILED")||!body.path("errorCode").asText().matches("[A-Z0-9_:-]{1,120}"))bad("INVALID_PACKAGE_RESULT");
    jdbc.update("UPDATE warehouse.model_package_request SET state=?,result=?::jsonb,error_code=?,finished_at=clock_timestamp() WHERE id=?",state,body.toString(),state.equals("FAILED")?body.path("errorCode").asText():null,id);
    audit(worker,"MODEL_PACKAGE_FINISH",Long.toString(id));return Map.of("id",id,"state",state);
  }
  public JsonNode bind(long project,long id,JsonNode bindings,String actor){
    var rows=jdbc.queryForList("SELECT * FROM warehouse.model_package WHERE id=? AND project_id=?",id,project);
    if(rows.isEmpty())bad("MODEL_PACKAGE_NOT_FOUND");var row=rows.getFirst();allowed(project,row.get("repository_code").toString(),actor);
    var contract=(com.fasterxml.jackson.databind.node.ObjectNode)tree(row.get("contract")).deepCopy();
    if(!bindings.isObject()||bindings.size()!=contract.path("inputs").size())bad("MODEL_SOURCE_BINDINGS_REQUIRED");
    for(JsonNode input:contract.path("inputs")){
      JsonNode binding=bindings.path(input.path("alias").asText());
      ((com.fasterxml.jackson.databind.node.ObjectNode)input).put("sourceCode",text(binding,"sourceCode",100,true)).put("objectName",text(binding,"objectName",300,true));
    }
    return json.createObjectNode().put("runtimeRef","package-"+row.get("repository_code")).put("gitRevision",row.get("git_revision").toString()).put("bundleSha256",row.get("bundle_sha256").toString()).set("contract",contract);
  }
  public void checkBuild(Map<String,Object> build,String worker){
    if(build.get("package_id")==null)return;
    var row=jdbc.queryForMap("SELECT p.repository_code,r.worker_ids,r.enabled FROM warehouse.model_package p JOIN warehouse.model_repository r ON r.code=p.repository_code WHERE p.id=?",build.get("package_id"));
    if(!contains(tree(row.get("worker_ids")),worker))conflict("MODEL_WORKER_NOT_ALLOWED");
    if(!Boolean.TRUE.equals(row.get("enabled")))denied();
    allowed(((Number)build.get("project_id")).longValue(),row.get("repository_code").toString(),build.get("requested_by").toString());
    build.put("repositoryRef",row.get("repository_code"));
  }
  private JsonNode tree(Object value){try{return json.readTree(value.toString());}catch(Exception e){throw new IllegalStateException("INVALID_PACKAGE_METADATA");}}
  private static boolean validPath(String value){return value.matches("[A-Za-z0-9_][A-Za-z0-9._/-]{0,299}")&&!value.contains("..")&&!value.endsWith("/");}
  private static boolean contains(JsonNode list,String value){for(JsonNode item:list)if(item.asText().equals(value))return true;return false;}
  private void audit(String actor,String action,String resource){jdbc.update("INSERT INTO control.audit_log(principal,action,resource,result,details) VALUES (?,?,?,'SUCCESS','{}')",actor,action,"model-package/"+resource);}
}
