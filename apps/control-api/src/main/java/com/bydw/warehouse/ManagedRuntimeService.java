package com.bydw.warehouse;

import static com.bydw.warehouse.SystemCatalogService.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Resolves immutable non-secret configuration, independently from the scheduling service. */
@Service
public class ManagedRuntimeService {
  private final JdbcTemplate jdbc;private final ObjectMapper json;private final ProductAccessService access;
  public ManagedRuntimeService(JdbcTemplate jdbc,ObjectMapper json,ProductAccessService access){this.jdbc=jdbc;this.json=json;this.access=access;}
  public Map<String,Object> configuration(long source,int version,String worker) {
    var rows=jdbc.queryForList("""
        SELECT s.code AS source_code,v.config AS channel_config,cv.config AS connection_config,v.created_by,ps.project_id,
          r.code AS resource_ref,r.kind,r.environment_code,r.resource_group,r.max_bytes,r.requests_per_second,
          e.worker_ids,c.lifecycle AS channel_state,cn.lifecycle AS connection_state,i.lifecycle AS instance_state,bs.lifecycle AS system_state
        FROM warehouse.channel_version v JOIN warehouse.ingest_channel c ON c.source_id=v.source_id
        JOIN control.source_connection s ON s.id=c.source_id JOIN warehouse.project_source ps ON ps.source_id=s.id
        JOIN warehouse.connection_version cv ON cv.connection_id=v.connection_id AND cv.version=v.connection_version
        JOIN warehouse.ingest_connection cn ON cn.id=cv.connection_id
        JOIN warehouse.ingest_resource r ON r.id=cn.resource_id AND r.enabled
        JOIN warehouse.execution_environment e ON e.code=r.environment_code AND e.enabled
        JOIN warehouse.resource_project rp ON rp.resource_id=r.id AND rp.project_id=ps.project_id AND rp.enabled
        JOIN warehouse.connection_project cp ON cp.connection_id=cn.id AND cp.project_id=ps.project_id AND cp.enabled
        JOIN warehouse.system_instance i ON i.id=cn.instance_id
        JOIN warehouse.instance_project ip ON ip.instance_id=i.id AND ip.project_id=ps.project_id
        JOIN warehouse.business_system bs ON bs.id=i.system_id
        JOIN warehouse.system_project sp ON sp.system_id=bs.id AND sp.project_id=ps.project_id
        WHERE v.source_id=? AND v.version=?
        """,source,version);
    if(rows.isEmpty())denied();var row=rows.getFirst();
    access.require(((Number)row.get("project_id")).longValue(),row.get("created_by").toString(),"ENGINEER");
    for(String state:List.of("channel_state","connection_state","instance_state","system_state")) if(List.of("PAUSED","RETIRED").contains(row.get(state)))conflict("INGESTION_PAUSED");
    try{
      if(worker!=null){boolean allowed=false;for(JsonNode item:json.readTree(row.get("worker_ids").toString()))if(item.asText().equals(worker))allowed=true;if(!allowed)denied();}
      var config=json.createObjectNode().put("protocol",2).put("sourceCode",row.get("source_code").toString())
          .put("sourceId",source).put("channelVersion",version).put("resourceRef",row.get("resource_ref").toString())
          .put("environment",row.get("environment_code").toString()).put("kind",row.get("kind").toString())
          .put("resourceGroup",row.get("resource_group").toString()).put("maxBytes",((Number)row.get("max_bytes")).longValue())
          .put("requestsPerSecond",((Number)row.get("requests_per_second")).doubleValue());
      config.set("connection",json.readTree(row.get("connection_config").toString()));config.set("channel",json.readTree(row.get("channel_config").toString()));
      String serialized=config.toString();return Map.of("configurationJson",serialized,"configurationSha256",ProductAccessService.hash(serialized));
    }catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException("INVALID_STORED_CONFIG");}
  }
  public void attach(Map<String,Object> task,String worker) {
    Object raw=task.get("contract");if(!(raw instanceof JsonNode contract)||!contract.has("channelVersion"))return;
    Long source=jdbc.queryForObject("SELECT id FROM control.source_connection WHERE code=?",Long.class,task.get("source_code"));
    task.putAll(configuration(source,contract.get("channelVersion").asInt(),worker));
  }
  public boolean eligible(long source,int version,String worker){
    try{configuration(source,version,worker);return true;}catch(com.bydw.api.ApiException e){return false;}
  }
  public String dispatchReason(long source,JsonNode contract,String worker) {
    var channels=jdbc.queryForList("SELECT active_version FROM warehouse.ingest_channel WHERE source_id=?",source);
    if(channels.isEmpty())return null;
    int version=contract.has("channelVersion")?contract.path("channelVersion").asInt():((Number)channels.getFirst().get("active_version")).intValue();
    try{configuration(source,version,worker);}catch(com.bydw.api.ApiException e){return e.code();}
    var row=jdbc.queryForMap("""
        SELECT r.resource_group,r.environment_code,e.max_parallel AS environment_limit,s.id AS system_id,s.max_parallel AS system_limit,
          (SELECT min(max_parallel) FROM warehouse.ingest_resource r2 WHERE r2.resource_group=r.resource_group) AS resource_limit
        FROM warehouse.ingest_channel ch JOIN warehouse.ingest_connection c ON c.id=ch.connection_id
        JOIN warehouse.ingest_resource r ON r.id=c.resource_id JOIN warehouse.execution_environment e ON e.code=r.environment_code
        JOIN warehouse.system_instance i ON i.id=c.instance_id JOIN warehouse.business_system s ON s.id=i.system_id WHERE ch.source_id=?
        """,source);
    var running=jdbc.queryForMap("""
        SELECT count(*) FILTER(WHERE r.resource_group=?) AS resource_count,
          count(*) FILTER(WHERE r.environment_code=?) AS environment_count,
          count(*) FILTER(WHERE i.system_id=?) AS system_count
        FROM (SELECT p.source_id FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id
          JOIN lake.ingestion_plan p ON p.id=w.plan_id WHERE a.state='RUNNING' AND a.lease_expires_at>clock_timestamp()
          UNION ALL SELECT source_id FROM warehouse.ingestion_probe WHERE state='RUNNING' AND lease_expires_at>clock_timestamp()) active
        JOIN warehouse.ingest_channel ch ON ch.source_id=active.source_id
        JOIN warehouse.ingest_connection c ON c.id=ch.connection_id JOIN warehouse.ingest_resource r ON r.id=c.resource_id
        JOIN warehouse.system_instance i ON i.id=c.instance_id
        """,row.get("resource_group"),row.get("environment_code"),row.get("system_id"));
    for(String scope:List.of("resource","environment","system"))if(((Number)running.get(scope+"_count")).longValue()>=((Number)row.get(scope+"_limit")).longValue())return scope.toUpperCase()+"_QUOTA_WAIT";
    return null;
  }
  public void guardSource(long source){
    jdbc.queryForList("SELECT ch.source_id FROM warehouse.ingest_channel ch JOIN warehouse.ingest_connection c ON c.id=ch.connection_id JOIN warehouse.system_instance i ON i.id=c.instance_id JOIN warehouse.business_system s ON s.id=i.system_id WHERE ch.source_id=? FOR SHARE OF ch,c,i,s",source);
    if(sourcePaused(source))conflict("MODEL_INPUT_SOURCE_PAUSED");
  }
  public boolean sourcePaused(long source) {
    return Boolean.TRUE.equals(jdbc.queryForObject("""
        SELECT EXISTS(SELECT 1 FROM warehouse.ingest_channel ch JOIN warehouse.ingest_connection c ON c.id=ch.connection_id
          JOIN warehouse.system_instance i ON i.id=c.instance_id JOIN warehouse.business_system s ON s.id=i.system_id
          WHERE ch.source_id=? AND (ch.lifecycle IN ('PAUSED','RETIRED') OR c.lifecycle IN ('PAUSED','RETIRED')
            OR i.lifecycle IN ('PAUSED','RETIRED') OR s.lifecycle IN ('PAUSED','RETIRED')))
        """,Boolean.class,source));
  }
  public void markDispatched(long source) {
    jdbc.update("""
        UPDATE warehouse.business_system SET last_claimed_at=clock_timestamp() WHERE id IN (
          SELECT i.system_id FROM warehouse.ingest_channel ch JOIN warehouse.ingest_connection c ON c.id=ch.connection_id
          JOIN warehouse.system_instance i ON i.id=c.instance_id WHERE ch.source_id=?)
        """,source);
  }
  @org.springframework.transaction.annotation.Transactional
  public Object requestBudget(JsonNode body,String worker){
    long id=body.path("id").asLong(-1);java.util.UUID token;try{token=java.util.UUID.fromString(body.path("leaseToken").asText());}catch(Exception e){bad("INVALID_REQUEST_BUDGET_LEASE");return Map.of();}
    String scope=body.path("scope").asText();String sourceSql;
    if(scope.equals("execution"))sourceSql="SELECT p.source_id FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id JOIN lake.ingestion_plan p ON p.id=w.plan_id WHERE a.id=? AND a.lease_owner=? AND a.lease_token=? AND a.state='RUNNING' AND NOT a.cancel_requested AND a.lease_expires_at>clock_timestamp()";
    else if(scope.equals("probe"))sourceSql="SELECT a.source_id FROM warehouse.ingestion_probe a WHERE a.id=? AND a.lease_owner=? AND a.lease_token=? AND a.state='RUNNING' AND a.lease_expires_at>clock_timestamp()";
    else{bad("INVALID_REQUEST_BUDGET_SCOPE");return Map.of();}
    var rows=jdbc.queryForList("""
        SELECT r.resource_group,(SELECT min(requests_per_second) FROM warehouse.ingest_resource same WHERE same.resource_group=r.resource_group) AS rate
        FROM (%s) task JOIN warehouse.ingest_channel ch ON ch.source_id=task.source_id
        JOIN warehouse.project_source ps ON ps.source_id=ch.source_id JOIN warehouse.ingest_connection c ON c.id=ch.connection_id
        JOIN warehouse.ingest_resource r ON r.id=c.resource_id AND r.enabled
        JOIN warehouse.resource_project rp ON rp.resource_id=r.id AND rp.project_id=ps.project_id AND rp.enabled
        WHERE r.kind='REST_PULL'
        """.formatted(sourceSql),id,worker,token);
    if(rows.isEmpty())conflict("REQUEST_BUDGET_LEASE_LOST");if(body.path("validateOnly").asBoolean(false))return Map.of("valid",true);var row=rows.getFirst();String group=row.get("resource_group").toString();
    jdbc.update("INSERT INTO warehouse.resource_request_budget(resource_group,next_allowed_at) VALUES (?,clock_timestamp()) ON CONFLICT DO NOTHING",group);
    jdbc.queryForMap("SELECT * FROM warehouse.resource_request_budget WHERE resource_group=? FOR UPDATE",group);
    var reserved=jdbc.queryForMap("UPDATE warehouse.resource_request_budget SET next_allowed_at=greatest(next_allowed_at,clock_timestamp())+(1.0/? * interval '1 second') WHERE resource_group=? RETURNING greatest(0,extract(epoch FROM (next_allowed_at-clock_timestamp()))*1000-(1000.0/?)) AS wait_ms",row.get("rate"),group,row.get("rate"));
    return Map.of("waitMillis",Math.max(0,((Number)reserved.get("wait_ms")).longValue()));
  }
}
