package com.bydw.warehouse;

import static com.bydw.warehouse.SystemCatalogService.*;
import com.bydw.lake.*;
import com.bydw.source.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ManagedIngestionService {
  private final JdbcTemplate jdbc;private final ObjectMapper json;private final ProductAccessService access;
  private final SystemCatalogService systems;private final SourceService sources;private final LakeExecutionService lake;
  private final LakeRegistrationService registration;private final ManagedRuntimeService runtime;
  public ManagedIngestionService(JdbcTemplate jdbc,ObjectMapper json,ProductAccessService access,SystemCatalogService systems,
      SourceService sources,LakeExecutionService lake,LakeRegistrationService registration,ManagedRuntimeService runtime){
    this.jdbc=jdbc;this.json=json;this.access=access;this.systems=systems;this.sources=sources;this.lake=lake;this.registration=registration;this.runtime=runtime;
  }
  @Transactional public Object environment(JsonNode b,String actor){
    access.requireAdmin(actor);String code=code(b,"code");
    if(!code.matches("[a-z][a-z0-9_-]{1,70}")||!b.path("workerIds").isArray()||b.path("workerIds").isEmpty()||b.path("workerIds").size()>100)bad("INVALID_WORKER_ENVIRONMENT");
    for(JsonNode worker:b.path("workerIds"))if(!worker.isTextual()||!worker.asText().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,99}"))bad("INVALID_WORKER_ID");
    int parallel=integer(b,"maxParallel",2,1,100);
    var row=jdbc.queryForMap("INSERT INTO warehouse.execution_environment(code,name,worker_ids,max_parallel) VALUES (?,?,?::jsonb,?) RETURNING code,name,max_parallel,enabled",code,text(b,"name",100,true),b.path("workerIds").toString(),parallel);
    systems.audit(actor,"EXECUTION_ENVIRONMENT_CREATE",code,Map.of());return row;
  }
  public Object environments(String actor){access.requireAdmin(actor);var rows=jdbc.queryForList("SELECT * FROM warehouse.execution_environment ORDER BY code");rows.forEach(r->decode(r,"worker_ids"));return rows;}
  @Transactional public Object resource(JsonNode b,String actor){
    access.requireAdmin(actor);String kind=text(b,"kind",30,true);if(!Set.of("MYSQL_SNAPSHOT","FILE_SCAN","REST_PULL").contains(kind))bad("CONNECTOR_NOT_APPROVED");
    String ref=code(b,"code");if(!ref.matches("[a-z][a-z0-9_-]{1,99}"))bad("INVALID_RESOURCE_REF");
    var row=jdbc.queryForMap("""
        INSERT INTO warehouse.ingest_resource(code,name,environment_code,kind,resource_group,max_parallel,max_bytes,requests_per_second)
        VALUES (?,?,?,?,?,?,?,?) RETURNING *
        """,ref,text(b,"name",100,true),code(b,"environment"),kind,code(b,"resourceGroup"),integer(b,"maxParallel",1,1,100),longInteger(b,"maxBytes",1073741824L,1024,1099511627776L),decimal(b,"requestsPerSecond",5,0.1,100));
    systems.audit(actor,"INGEST_RESOURCE_CREATE",row.get("id"),Map.of("environment",b.path("environment").asText()));return row;
  }
  @Transactional public Object grantResource(long resource,JsonNode b,String actor){
    access.requireAdmin(actor);long project=b.path("projectId").asLong(-1);access.require(project,actor,"OWNER");
    jdbc.update("INSERT INTO warehouse.resource_project(resource_id,project_id,enabled) VALUES (?,?,?) ON CONFLICT(resource_id,project_id) DO UPDATE SET enabled=EXCLUDED.enabled",resource,project,b.path("enabled").asBoolean(true));
    systems.audit(actor,"INGEST_RESOURCE_GRANT",resource,Map.of("projectId",project,"enabled",b.path("enabled").asBoolean(true)));return Map.of("updated",true);
  }
  public Object resources(long project,String actor){access.require(project,actor,"ENGINEER");return jdbc.queryForList("SELECT r.* FROM warehouse.ingest_resource r JOIN warehouse.resource_project p ON p.resource_id=r.id JOIN warehouse.execution_environment e ON e.code=r.environment_code WHERE p.project_id=? AND p.enabled AND r.enabled AND e.enabled ORDER BY r.id",project);}
  private Map<String,Object> requireResource(long project,long resource,String actor){
    access.require(project,actor,"ENGINEER");var rows=jdbc.queryForList("SELECT r.* FROM warehouse.ingest_resource r JOIN warehouse.resource_project p ON p.resource_id=r.id JOIN warehouse.execution_environment e ON e.code=r.environment_code WHERE r.id=? AND p.project_id=? AND p.enabled AND r.enabled AND e.enabled",resource,project);
    if(rows.isEmpty())denied();return rows.getFirst();
  }
  public Map<String,Object> connection(long project,long id,String actor,String role){
    access.require(project,actor,role);var rows=jdbc.queryForList("""
        SELECT c.*,r.kind,r.environment_code,r.code AS resource_ref,v.config FROM warehouse.ingest_connection c
        JOIN warehouse.connection_project cp ON cp.connection_id=c.id AND cp.project_id=? AND cp.enabled
        JOIN warehouse.ingest_resource r ON r.id=c.resource_id JOIN warehouse.connection_version v ON v.connection_id=c.id AND v.version=c.active_version
        WHERE c.id=?
        """,project,id);
    if(rows.isEmpty())denied();var row=rows.getFirst();systems.requireInstance(project,((Number)row.get("instance_id")).longValue(),actor,role);requireResource(project,((Number)row.get("resource_id")).longValue(),actor);decode(row,"config");return row;
  }
  public Object connections(long project,long instance,String actor){
    systems.requireInstance(project,instance,actor,"ENGINEER");return jdbc.queryForList("""
        SELECT c.id,c.code,c.name,c.active_version,c.lifecycle,c.revision,r.kind,r.name AS resource_name,r.environment_code,
          (SELECT count(*) FROM warehouse.ingest_channel ch JOIN warehouse.project_source ps ON ps.source_id=ch.source_id WHERE ch.connection_id=c.id AND ps.project_id=?) AS channel_count
        FROM warehouse.ingest_connection c JOIN warehouse.connection_project p ON p.connection_id=c.id AND p.project_id=? AND p.enabled
        JOIN warehouse.ingest_resource r ON r.id=c.resource_id JOIN warehouse.resource_project rp ON rp.resource_id=r.id AND rp.project_id=p.project_id AND rp.enabled
        WHERE c.instance_id=? ORDER BY c.id
        """,project,project,instance);
  }
  @Transactional public Object createConnection(long project,long instance,JsonNode b,String actor){
    systems.requireInstance(project,instance,actor,"ENGINEER");long resource=b.path("resourceId").asLong(-1);var resourceRow=requireResource(project,resource,actor);
    JsonNode config=configuration(b.path("config"),resourceRow.get("kind").toString(),false);
    var row=jdbc.queryForMap("INSERT INTO warehouse.ingest_connection(instance_id,code,name,resource_id,managing_project_id,active_version) VALUES (?,?,?,?,?,1) RETURNING *",instance,code(b,"code"),text(b,"name",100,true),resource,project);
    jdbc.update("INSERT INTO warehouse.connection_version(connection_id,version,config,created_by) VALUES (?,1,?::jsonb,?)",row.get("id"),config.toString(),actor);
    jdbc.update("INSERT INTO warehouse.connection_project(connection_id,project_id) VALUES (?,?)",row.get("id"),project);
    systems.audit(actor,"INGEST_CONNECTION_CREATE",row.get("id"),Map.of("instanceId",instance));return row;
  }
  @Transactional public Object versionConnection(long project,long id,JsonNode b,String actor){
    var old=connection(project,id,actor,"OWNER");if(!access.admin(actor)&&((Number)old.get("managing_project_id")).longValue()!=project)denied();
    int expected=integer(b,"expectedVersion",-1,1,Integer.MAX_VALUE-1);JsonNode config=configuration(b.path("config"),old.get("kind").toString(),false);
    if(!((JsonNode)old.get("config")).path("database").equals(config.path("database")))conflict("NEW_LOGICAL_SOURCE_REQUIRES_NEW_CONNECTION");
    if(jdbc.update("UPDATE warehouse.ingest_connection SET active_version=active_version+1,revision=revision+1 WHERE id=? AND active_version=? AND lifecycle<>'RETIRED'",id,expected)!=1)conflict("CONNECTION_VERSION_CHANGED");
    jdbc.update("INSERT INTO warehouse.connection_version(connection_id,version,config,created_by) VALUES (?,?,?::jsonb,?)",id,expected+1,config.toString(),actor);
    systems.audit(actor,"INGEST_CONNECTION_VERSION",id,Map.of("version",expected+1,"reason",text(b,"reason",300,true)));return Map.of("id",id,"version",expected+1);
  }
  public Map<String,Object> channel(long project,long source,String actor,String role){
    access.require(project,actor,role);var rows=jdbc.queryForList("""
        SELECT ch.*,s.code,p.project_id,v.config,v.connection_version FROM warehouse.ingest_channel ch
        JOIN control.source_connection s ON s.id=ch.source_id JOIN warehouse.project_source p ON p.source_id=s.id
        JOIN warehouse.channel_version v ON v.source_id=ch.source_id AND v.version=ch.active_version WHERE ch.source_id=? AND p.project_id=?
        """,source,project);
    if(rows.isEmpty())denied();var row=rows.getFirst();connection(project,((Number)row.get("connection_id")).longValue(),actor,role);decode(row,"config");
    var plans=jdbc.queryForList("SELECT p.id,p.active_version,p.state,v.timezone,v.trigger_time,v.start_date,v.historical_read,v.contract FROM lake.ingestion_plan p JOIN lake.plan_version v ON v.plan_id=p.id AND v.version=p.active_version WHERE p.source_id=?",source);
    if(!plans.isEmpty()){var plan=plans.getFirst();decode(plan,"contract");row.put("plan",plan);row.put("plan_id",plan.get("id"));row.put("plan_version",plan.get("active_version"));}return row;
  }
  public Object channels(long project,long connection,String actor){
    connection(project,connection,actor,"ENGINEER");return jdbc.queryForList("""
        SELECT ch.*,s.code,p.id AS plan_id,p.state AS plan_state,p.active_version AS plan_version,
          (SELECT state FROM warehouse.ingestion_probe pr WHERE pr.source_id=ch.source_id AND pr.channel_version=ch.active_version ORDER BY pr.id DESC LIMIT 1) AS probe_state
        FROM warehouse.ingest_channel ch JOIN control.source_connection s ON s.id=ch.source_id
        JOIN warehouse.project_source ps ON ps.source_id=s.id LEFT JOIN lake.ingestion_plan p ON p.source_id=s.id
        WHERE ch.connection_id=? AND ps.project_id=? ORDER BY ch.source_id
        """,connection,project);
  }
  @Transactional public Object createChannel(long project,long connection,JsonNode b,String actor){
    var c=connection(project,connection,actor,"ENGINEER");JsonNode config=configuration(b.path("config"),c.get("kind").toString(),true);
    String code=text(b,"code",100,true);long source;
    if(b.has("existingSourceId")){
      access.requireAdmin(actor);source=b.path("existingSourceId").asLong(-1);
      if(jdbc.queryForObject("SELECT count(*) FROM warehouse.project_source ps JOIN control.source_connection s ON s.id=ps.source_id WHERE ps.source_id=? AND ps.project_id=? AND s.code=?",Long.class,source,project,code)!=1)bad("LEGACY_SOURCE_NOT_IN_PROJECT");
      var expected=Map.of("MYSQL_SNAPSHOT","MYSQL","FILE_SCAN","FILE","REST_PULL","REST").get(c.get("kind"));
      if(!expected.equals(jdbc.queryForObject("SELECT source_type FROM control.source_connection WHERE id=?",String.class,source)))bad("LEGACY_SOURCE_KIND_MISMATCH");
    }else{
      var request=new CreateSourceRequest(code,Map.of("MYSQL_SNAPSHOT","MYSQL","FILE_SCAN","FILE","REST_PULL","REST").get(c.get("kind")),json.createObjectNode().put("managed",true),"env://MANAGED_RESOURCE");
      source=sources.create(request,actor).id();jdbc.update("INSERT INTO warehouse.project_source(source_id,project_id) VALUES (?,?)",source,project);
    }
    jdbc.update("INSERT INTO warehouse.ingest_channel(source_id,connection_id,name,active_version) VALUES (?,?,?,1)",source,connection,text(b,"name",100,true));
    jdbc.update("INSERT INTO warehouse.channel_version(source_id,version,connection_id,connection_version,config,created_by) VALUES (?,1,?,?,?::jsonb,?)",source,connection,c.get("active_version"),config.toString(),actor);
    systems.audit(actor,"INGEST_CHANNEL_CREATE",source,Map.of("connectionId",connection,"legacyMapping",b.has("existingSourceId")));return channel(project,source,actor,"ENGINEER");
  }
  @Transactional public Object versionChannel(long project,long source,JsonNode b,String actor){
    var ch=channel(project,source,actor,"ENGINEER");var c=connection(project,((Number)ch.get("connection_id")).longValue(),actor,"ENGINEER");
    int expected=integer(b,"expectedVersion",-1,1,Integer.MAX_VALUE-1),cv=integer(b,"connectionVersion",((Number)c.get("active_version")).intValue(),1,Integer.MAX_VALUE-1);
    JsonNode config=configuration(b.path("config"),c.get("kind").toString(),true);
    if(c.get("kind").equals("REST_PULL")&&!((JsonNode)ch.get("config")).path("path").equals(config.path("path")))conflict("NEW_API_OBJECT_REQUIRES_NEW_CHANNEL");
    if(c.get("kind").equals("FILE_SCAN")&&!((JsonNode)ch.get("config")).path("relativeDirectory").equals(config.path("relativeDirectory")))conflict("NEW_FILE_FEED_REQUIRES_NEW_CHANNEL");
    if(jdbc.update("UPDATE warehouse.ingest_channel SET active_version=active_version+1,revision=revision+1 WHERE source_id=? AND active_version=? AND lifecycle<>'RETIRED'",source,expected)!=1)conflict("CHANNEL_VERSION_CHANGED");
    jdbc.update("INSERT INTO warehouse.channel_version(source_id,version,connection_id,connection_version,config,created_by) VALUES (?,?,?,?,?::jsonb,?)",source,expected+1,c.get("id"),cv,config.toString(),actor);
    systems.audit(actor,"INGEST_CHANNEL_VERSION",source,Map.of("version",expected+1,"reason",text(b,"reason",300,true)));return channel(project,source,actor,"ENGINEER");
  }
  @Transactional public Object probe(long project,long source,JsonNode b,String actor){
    var ch=channel(project,source,actor,"ENGINEER");String key=text(b,"requestKey",100,true);
    runtime.configuration(source,((Number)ch.get("active_version")).intValue(),null);
    jdbc.update("INSERT INTO warehouse.ingestion_probe(source_id,channel_version,project_id,requested_by,request_key) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",source,ch.get("active_version"),project,actor,key);
    var row=jdbc.queryForMap("SELECT id,state,channel_version FROM warehouse.ingestion_probe WHERE source_id=? AND request_key=?",source,key);
    if(!row.get("channel_version").equals(ch.get("active_version")))conflict("PROBE_REQUEST_CONFLICT");return row;
  }
  public Object probes(long project,long source,String actor){channel(project,source,actor,"ENGINEER");var rows=jdbc.queryForList("SELECT id,channel_version,state,error_code,result,created_at,finished_at FROM warehouse.ingestion_probe WHERE source_id=? ORDER BY id DESC LIMIT 50",source);rows.forEach(r->decode(r,"result"));return rows;}
  @Transactional public Object claimProbe(String environment,String actor){
    if(environment==null||!environment.matches("[a-z][a-z0-9_-]{1,70}"))bad("INVALID_ENVIRONMENT");
    jdbc.update("UPDATE warehouse.ingestion_probe SET state='FAILED',error_code='PROBE_LEASE_EXPIRED',finished_at=clock_timestamp() WHERE state='RUNNING' AND lease_expires_at<=clock_timestamp()");
    var rows=jdbc.queryForList("""
        SELECT p.* FROM warehouse.ingestion_probe p JOIN warehouse.ingest_channel c ON c.source_id=p.source_id
        JOIN warehouse.ingest_connection cn ON cn.id=c.connection_id JOIN warehouse.ingest_resource r ON r.id=cn.resource_id
        WHERE p.state='QUEUED' AND r.environment_code=? ORDER BY p.id FOR UPDATE OF p SKIP LOCKED LIMIT 100
        """,environment);
    for(var row:rows){long source=((Number)row.get("source_id")).longValue();int version=((Number)row.get("channel_version")).intValue();
      if(!runtime.eligible(source,version,actor))continue;access.require(((Number)row.get("project_id")).longValue(),row.get("requested_by").toString(),"ENGINEER");
      UUID token=UUID.randomUUID();jdbc.update("UPDATE warehouse.ingestion_probe SET state='RUNNING',lease_owner=?,lease_token=?,lease_expires_at=clock_timestamp()+interval '120 seconds' WHERE id=?",actor,token,row.get("id"));
      jdbc.update("UPDATE warehouse.execution_environment SET last_seen_at=clock_timestamp() WHERE code=?",environment);
      var result=new java.util.LinkedHashMap<String,Object>(runtime.configuration(source,version,actor));result.put("id",row.get("id"));result.put("leaseToken",token);result.put("state","RUNNING");
      result.put("inventoryVersion",jdbc.queryForObject("SELECT coalesce(max(plan_version),0)+1 FROM lake.inventory WHERE source_id=?",Long.class,source));return result;
    }return Map.of("state","IDLE");
  }
  @Transactional public Object finishProbe(long id,JsonNode b,String actor){
    String state=text(b,"state",20,true);if(!List.of("COMPLETE","FAILED").contains(state)||b.toString().length()>2_000_000)bad("INVALID_PROBE_RESULT");
    UUID token;try{token=UUID.fromString(b.path("leaseToken").asText());}catch(Exception e){bad("INVALID_PROBE_LEASE");return Map.of();}
    var rows=jdbc.queryForList("SELECT * FROM warehouse.ingestion_probe WHERE id=? AND lease_owner=? AND lease_token=? FOR UPDATE",id,actor,token);
    if(rows.isEmpty())conflict("PROBE_LEASE_LOST");var old=rows.getFirst();
    if(!old.get("state").equals("RUNNING")){
      if(old.get("state").equals(state)&&b.path("result").equals(tree(old.get("result"))))return Map.of("id",id,"state",state);
      conflict("PROBE_RESULT_IMMUTABLE");
    }
    if(jdbc.queryForObject("SELECT lease_expires_at>clock_timestamp() FROM warehouse.ingestion_probe WHERE id=?",Boolean.class,id)!=Boolean.TRUE)conflict("PROBE_LEASE_LOST");
    String error=b.path("errorCode").asText("");if(!error.isEmpty()&&!error.matches("[A-Z0-9_:-]{1,120}"))bad("INVALID_PROBE_ERROR");
    jdbc.update("UPDATE warehouse.ingestion_probe SET state=?,result=?::jsonb,error_code=?,finished_at=clock_timestamp() WHERE id=?",state,b.path("result").toString(),error.isEmpty()?null:error,id);
    return Map.of("id",id,"state",state);
  }
  @Transactional public Object activate(long project,long source,JsonNode b,String actor){
    var ch=channel(project,source,actor,"OWNER");jdbc.queryForObject("SELECT pg_advisory_xact_lock(?)",Object.class,source);
    var c=connection(project,((Number)ch.get("connection_id")).longValue(),actor,"OWNER");
    var probes=jdbc.queryForList("SELECT result FROM warehouse.ingestion_probe WHERE id=? AND source_id=? AND channel_version=? AND state='COMPLETE'",b.path("probeId").asLong(-1),source,ch.get("active_version"));
    if(probes.isEmpty())bad("SUCCESSFUL_CURRENT_PROBE_REQUIRED");JsonNode result=tree(probes.getFirst().get("result"));
    Long inventoryVersion=null;
    if(c.get("kind").equals("MYSQL_SNAPSHOT")){
      try{
        var request=json.treeToValue(result.path("inventoryRequest"),RegisterInventoryRequest.class);
        if(!request.sourceCode().equals(ch.get("code"))||result.path("inventory").path("plan_version").asLong()!=request.planVersion())bad("PROBE_INVENTORY_MISMATCH");
        var saved=registration.registerInventory(request,actor);inventoryVersion=request.planVersion();
        jdbc.update("UPDATE lake.inventory SET runtime_json=?::jsonb WHERE id=? AND runtime_json IS NULL",result.path("inventory").toString(),saved.inventoryId());
      }catch(com.fasterxml.jackson.core.JsonProcessingException e){bad("INVALID_DISCOVERED_INVENTORY");}
    }
    var contract=json.createObjectNode().put("channelVersion",((Number)ch.get("active_version")).intValue()).put("pollSeconds",integer(b,"pollSeconds",60,60,3600)).put("lateDays",integer(b,"lateDays",7,0,31));
    String timezone=text(b,"timezone",80,true);if(!timezone.equals("Asia/Shanghai")&&!c.get("kind").equals("MYSQL_SNAPSHOT"))bad("CONNECTOR_TIMEZONE_NOT_SUPPORTED");
    Map<String,Object> saved;
    try{saved=lake.savePlan(new LakePlanRequest(ch.get("code").toString(),integer(b,"expectedPlanVersion",0,0,Integer.MAX_VALUE-1),inventoryVersion,c.get("kind").toString(),"managed-"+c.get("environment_code"),contract,timezone,LocalTime.parse(b.path("triggerTime").asText()),LocalDate.parse(b.path("startDate").asText()),!c.get("kind").equals("MYSQL_SNAPSHOT")&&b.path("historicalRead").asBoolean(false),integer(b,"maxAttempts",3,1,8),integer(b,"timeoutSeconds",3600,30,86400)),actor);}
    catch(java.time.DateTimeException e){bad("INVALID_SCHEDULE");return Map.of();}
    jdbc.update("UPDATE warehouse.ingest_channel SET lifecycle='ACTIVE',revision=revision+1 WHERE source_id=?",source);
    jdbc.update("UPDATE warehouse.ingest_connection SET lifecycle='ACTIVE' WHERE id=? AND lifecycle IN ('DRAFT','ONBOARDING')",c.get("id"));
    systems.audit(actor,"INGEST_CHANNEL_ACTIVATE",source,Map.of("planId",saved.get("id")));return saved;
  }
  public Object trigger(long project,long source,JsonNode b,String actor){var ch=channel(project,source,actor,"ENGINEER");runtime.configuration(source,((Number)ch.get("active_version")).intValue(),null);Long plan=jdbc.queryForObject("SELECT id FROM lake.ingestion_plan WHERE source_id=?",Long.class,source);return lake.trigger(plan,LocalDate.parse(b.path("day").asText()),b.path("revision").asBoolean(false),text(b,"reason",300,true),actor);}
  public JsonNode tree(Object value){try{return value==null?json.nullNode():json.readTree(value.toString());}catch(Exception e){throw new IllegalStateException("INVALID_STORED_JSON");}}
  private void decode(Map<String,Object> row,String field){row.put(field,tree(row.get(field)));}
  private JsonNode configuration(JsonNode config,String kind,boolean channel){
    if(!config.isObject()||config.toString().length()>65536)bad("INVALID_INGEST_CONFIGURATION");
    Set<String> allowed=channel?switch(kind){case "FILE_SCAN"->Set.of("relativeDirectory","datePartitioned","delivery");case "MYSQL_SNAPSHOT"->Set.of("tables");default->Set.of("path","query","pagination","success","window","allow_empty","json_schema");}:switch(kind){case "MYSQL_SNAPSHOT"->Set.of("database");default->Set.of("description");};
    config.fieldNames().forEachRemaining(k->{if(!allowed.contains(k))bad("CONFIGURATION_FIELD_NOT_ALLOWED");});
    if(!channel&&kind.equals("MYSQL_SNAPSHOT"))text(config,"database",64,true);
    if(channel&&kind.equals("FILE_SCAN")){
      String relative=text(config,"relativeDirectory",300,false);if(relative.startsWith("/")||relative.contains("\\")||java.util.Arrays.asList(relative.split("/",-1)).contains(".."))bad("DIRECTORY_OUTSIDE_RESOURCE");
      if(!config.path("delivery").isObject())bad("FILE_DELIVERY_CONTRACT_REQUIRED");
    }
    if(channel&&kind.equals("REST_PULL")){String path=text(config,"path",300,true);if(!path.startsWith("/")||path.startsWith("//")||path.contains("..")||path.contains("?")||path.contains("#"))bad("INVALID_API_PATH");}
    if(channel&&kind.equals("MYSQL_SNAPSHOT")&&config.has("tables")){
      if(!config.path("tables").isArray()||config.path("tables").size()>10000)bad("INVALID_TABLE_SCOPE");
      for(JsonNode t:config.path("tables"))if(!t.isTextual()||t.asText().isBlank()||t.asText().length()>64)bad("INVALID_TABLE_SCOPE");
    }
    rejectSecrets(config);return config;
  }
  private void rejectSecrets(JsonNode node){if(node.isObject())node.fields().forEachRemaining(e->{if(e.getKey().matches("(?i).*(password|secret|authorization|cookie|credential|api[-_]?key).*"))bad("SECRET_VALUE_FORBIDDEN");rejectSecrets(e.getValue());});else if(node.isArray())node.forEach(this::rejectSecrets);}
  private static int integer(JsonNode b,String key,int fallback,int min,int max){return (int)longInteger(b,key,fallback,min,max);}
  private static long longInteger(JsonNode b,String key,long fallback,long min,long max){JsonNode n=b.get(key);if(n!=null&&(!n.isIntegralNumber()||!n.canConvertToLong()))bad("INVALID_NUMBER");long value=n==null?fallback:n.asLong();if(value<min||value>max)bad("INVALID_NUMBER");return value;}
  private static double decimal(JsonNode b,String key,double fallback,double min,double max){JsonNode n=b.get(key);if(n!=null&&!n.isNumber())bad("INVALID_NUMBER");double value=n==null?fallback:n.asDouble();if(!Double.isFinite(value)||value<min||value>max)bad("INVALID_NUMBER");return value;}
}
