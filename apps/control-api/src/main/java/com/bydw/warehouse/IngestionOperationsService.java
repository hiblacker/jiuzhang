package com.bydw.warehouse;

import static com.bydw.warehouse.SystemCatalogService.*;
import com.bydw.api.ApiException;
import com.bydw.lake.LakeExecutionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class IngestionOperationsService {
  private final JdbcTemplate jdbc;private final ObjectMapper json;private final ProductAccessService access;
  private final SystemCatalogService systems;private final ManagedIngestionService ingestion;private final LakeExecutionService lake;
  private final TransactionTemplate itemTransaction;
  public IngestionOperationsService(JdbcTemplate jdbc,ObjectMapper json,ProductAccessService access,SystemCatalogService systems,
      ManagedIngestionService ingestion,LakeExecutionService lake,PlatformTransactionManager transactions){
    this.jdbc=jdbc;this.json=json;this.access=access;this.systems=systems;this.ingestion=ingestion;this.lake=lake;
    itemTransaction=new TransactionTemplate(transactions);itemTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }
  private Map<String,Object> subject(long project,String type,long id,String actor){
    access.require(project,actor,"OWNER");Map<String,Object> result;
    switch(type){
      case "system" -> {result=systems.requireSystem(project,id,actor,"OWNER");manage(result,project,actor);}
      case "instance" -> {result=systems.requireInstance(project,id,actor,"OWNER");manage(systems.requireSystem(project,((Number)result.get("system_id")).longValue(),actor,"OWNER"),project,actor);}
      case "connection" -> {result=ingestion.connection(project,id,actor,"OWNER");manage(result,project,actor);}
      case "channel" -> result=ingestion.channel(project,id,actor,"OWNER");
      default -> {bad("INVALID_OPERATION_TARGET");return Map.of();}
    }
    return result;
  }
  private void manage(Map<String,Object> object,long project,String actor){if(!access.admin(actor)&&((Number)object.get("managing_project_id")).longValue()!=project)denied();}
  private String table(String type){return switch(type){case "system"->"warehouse.business_system";case "instance"->"warehouse.system_instance";case "connection"->"warehouse.ingest_connection";case "channel"->"warehouse.ingest_channel";default->throw new IllegalArgumentException("INVALID_TARGET");};}
  private String key(String type){return type.equals("channel")?"source_id":"id";}
  public List<Long> affected(String type,long id){
    String predicate=switch(type){case "system"->"i.system_id=?";case "instance"->"i.id=?";case "connection"->"c.id=?";case "channel"->"ch.source_id=?";default->throw new IllegalArgumentException("INVALID_TARGET");};
    return jdbc.queryForList("SELECT ch.source_id FROM warehouse.ingest_channel ch JOIN warehouse.ingest_connection c ON c.id=ch.connection_id JOIN warehouse.system_instance i ON i.id=c.instance_id WHERE "+predicate+" ORDER BY ch.source_id",Long.class,id);
  }
  private List<Map<String,Object>> downstream(List<Long> sources,Long project){
    if(sources.isEmpty())return List.of();String placeholders=String.join(",",java.util.Collections.nCopies(sources.size(),"?"));
    var args=new ArrayList<Object>(sources);if(project!=null)args.add(project);
    return jdbc.queryForList("""
        SELECT DISTINCT d.id,d.name,d.project_id FROM warehouse.dataset d JOIN warehouse.model_version v ON v.dataset_id=d.id AND v.version=d.active_model_version
        CROSS JOIN LATERAL jsonb_array_elements(v.contract->'inputs') input
        JOIN control.source_connection s ON s.code=input->>'sourceCode' WHERE s.id IN (%s)
        """.formatted(placeholders)+(project==null?"":" AND d.project_id=?")+" ORDER BY d.id",args.toArray());
  }
  public Object impact(long project,String type,long id,String actor){
    subject(project,type,id,actor);var all=affected(type,id);
    var visible=all.stream().filter(source->jdbc.queryForObject("SELECT count(*) FROM warehouse.project_source WHERE source_id=? AND project_id=?",Long.class,source,project)==1).toList();
    long running=0;
    for(long source:visible)running+=jdbc.queryForObject("SELECT count(*) FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id JOIN lake.ingestion_plan p ON p.id=w.plan_id WHERE p.source_id=? AND a.state='RUNNING'",Long.class,source);
    return Map.of("type",type,"id",id,"sourceIds",visible,"runningCount",running,"datasets",downstream(visible,project),"scope","CURRENT_PROJECT");
  }
  @Transactional public Object preview(long project,JsonNode b,String actor){
    access.require(project,actor,"OWNER");String action=text(b,"action",20,true),reason=text(b,"reason",300,true);
    if(!List.of("PAUSE","RESUME","RETIRE","RETRY","CANCEL").contains(action)||!b.path("targets").isArray()||b.path("targets").isEmpty()||b.path("targets").size()>200)bad("INVALID_BULK_OPERATION");
    var frozen=json.createArrayNode();var preview=json.createArrayNode();var seen=new java.util.HashSet<String>();
    for(JsonNode target:b.path("targets")){
      String type=text(target,"type",20,true);long id=target.path("id").asLong(-1);if(!seen.add(type+":"+id))bad("DUPLICATE_OPERATION_TARGET");
      var entry=json.createObjectNode().put("type",type).put("id",id);
      try{
        var record=subject(project,type,id,actor);long expected=target.path("expectedVersion").asLong(-1);
        if(((Number)record.get("revision")).longValue()!=expected)conflict("TARGET_VERSION_CHANGED");entry.put("expectedVersion",expected);
        if(List.of("RETRY","CANCEL").contains(action)){
          if(!type.equals("channel"))bad("EXECUTION_OPERATION_REQUIRES_CHANNEL");
          var attempts=jdbc.queryForList("SELECT a.id FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id JOIN lake.ingestion_plan p ON p.id=w.plan_id WHERE p.source_id=? AND a.state IN ('FAILED','INCOMPLETE','CANCELLED','QUEUED','RUNNING') ORDER BY a.id DESC LIMIT 1",id);
          if(attempts.isEmpty())bad("EXECUTION_NOT_FOUND");entry.put("executionId",((Number)attempts.getFirst().get("id")).longValue());
        }
        entry.set("impact",json.valueToTree(impact(project,type,id,actor)));entry.put("eligible",true);
      }catch(ApiException error){entry.put("eligible",false).put("errorCode",error.code());}
      frozen.add(entry);preview.add(entry.deepCopy());
    }
    UUID id=UUID.randomUUID();jdbc.update("INSERT INTO warehouse.bulk_operation(id,project_id,actor,action,targets,preview,reason) VALUES (?,?,?,?,?::jsonb,?::jsonb,?)",id,project,actor,action,frozen.toString(),preview.toString(),reason);
    return Map.of("id",id,"action",action,"items",preview,"reason",reason);
  }
  @Transactional public Object execute(long project,UUID id,String actor){
    access.require(project,actor,"OWNER");
    var rows=jdbc.queryForList("SELECT * FROM warehouse.bulk_operation WHERE id=? AND project_id=? AND actor=? FOR NO KEY UPDATE",id,project,actor);
    if(rows.isEmpty())denied();var operation=rows.getFirst();if(operation.get("state").equals("COMPLETE"))return ingestion.tree(operation.get("results"));
    var results=json.createArrayNode();int index=0;
    for(JsonNode target:ingestion.tree(operation.get("targets"))){final int itemIndex=index++;
      var previous=jdbc.queryForList("SELECT result FROM warehouse.bulk_operation_item WHERE operation_id=? AND item_index=?",id,itemIndex);
      if(!previous.isEmpty()){results.add(ingestion.tree(previous.getFirst().get("result")));continue;}
      JsonNode result;
      try{result=itemTransaction.execute(status->{
        if(!target.path("eligible").asBoolean())return target;
        var value=change(project,target,operation.get("action").toString(),operation.get("reason").toString(),actor);
        jdbc.update("INSERT INTO warehouse.bulk_operation_item(operation_id,item_index,result) VALUES (?,?,?::jsonb)",id,itemIndex,value.toString());return value;
      });}catch(ApiException error){result=json.createObjectNode().put("type",target.path("type").asText()).put("id",target.path("id").asLong()).put("success",false).put("errorCode",error.code());}
      results.add(result);
    }
    var response=json.createObjectNode().put("id",id.toString()).put("state","COMPLETE");response.set("items",results);
    jdbc.update("UPDATE warehouse.bulk_operation SET state='COMPLETE',results=?::jsonb,completed_at=clock_timestamp() WHERE id=?",response.toString(),id);return response;
  }
  private JsonNode change(long project,JsonNode target,String action,String reason,String actor){
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(73401921)",Object.class);
    String type=target.path("type").asText();long id=target.path("id").asLong(),expected=target.path("expectedVersion").asLong();
    subject(project,type,id,actor);
    var row=jdbc.queryForMap("SELECT revision,lifecycle FROM "+table(type)+" WHERE "+key(type)+"=? FOR UPDATE",id);
    if(((Number)row.get("revision")).longValue()!=expected)conflict("TARGET_VERSION_CHANGED");
    var sources=affected(type,id);
    if(!access.admin(actor))for(long source:sources)if(jdbc.queryForObject("SELECT count(*) FROM warehouse.project_source WHERE source_id=? AND project_id=?",Long.class,source,project)!=1)denied();
    if(List.of("RETRY","CANCEL").contains(action)){
      long execution=target.path("executionId").asLong();
      if(action.equals("RETRY"))lake.retry(execution,actor);else lake.cancel(execution,actor);
    }else{
      if(row.get("lifecycle").equals("RETIRED"))conflict("TARGET_RETIRED");
      if(action.equals("RETIRE")){
        if(!downstream(sources,null).isEmpty())conflict("DOWNSTREAM_DEPENDENCIES_REMAIN");
        for(long source:sources)if(jdbc.queryForObject("SELECT count(*) FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id JOIN lake.ingestion_plan p ON p.id=w.plan_id WHERE p.source_id=? AND a.state='RUNNING'",Long.class,source)>0)conflict("IN_FLIGHT_EXECUTIONS_REMAIN");
      }
      if(action.equals("RETIRE"))for(long source:sources){
        jdbc.update("UPDATE lake.execution_attempt a SET state='CANCELLED',cancel_requested=true,finished_at=clock_timestamp(),error_code='SOURCE_RETIRED' FROM lake.execution_window w JOIN lake.ingestion_plan p ON p.id=w.plan_id WHERE a.window_id=w.id AND p.source_id=? AND a.state='QUEUED'",source);
        jdbc.update("UPDATE lake.execution_window w SET state='CANCELLED',reason='SOURCE_RETIRED' FROM lake.ingestion_plan p WHERE p.id=w.plan_id AND p.source_id=? AND w.state IN ('QUEUED','INCOMPLETE')",source);
        jdbc.update("UPDATE warehouse.ingestion_probe SET state='FAILED',error_code='SOURCE_RETIRED',finished_at=clock_timestamp() WHERE source_id=? AND state='QUEUED'",source);
      }
      String lifecycle=switch(action){case "PAUSE"->"PAUSED";case "RESUME"->"ACTIVE";case "RETIRE"->"RETIRED";default->throw new IllegalStateException();};
      jdbc.update("UPDATE "+table(type)+" SET lifecycle=?,revision=revision+1 WHERE "+key(type)+"=?",lifecycle,id);
    }
    systems.audit(actor,"INGEST_"+action,id,Map.of("type",type,"reason",reason,"previousVersion",expected));
    return json.createObjectNode().put("type",type).put("id",id).put("success",true).put("action",action);
  }
}
