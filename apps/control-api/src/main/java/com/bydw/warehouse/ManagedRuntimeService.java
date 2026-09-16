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
}
