package com.bydw.warehouse;

import static com.bydw.warehouse.SystemCatalogService.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OperationalIncidentService {
  private final JdbcTemplate jdbc;private final ProductAccessService access;private final ObjectMapper json;
  public OperationalIncidentService(JdbcTemplate jdbc,ProductAccessService access,ObjectMapper json){this.jdbc=jdbc;this.access=access;this.json=json;}
  @Transactional public Object reconcile(Long project,String actor){
    if(project!=null)access.require(project,actor,"ENGINEER");int observed=0;
    var windows=jdbc.queryForList("""
        SELECT DISTINCT ON(ps.project_id,p.id,w.plan_version,w.business_date) ps.project_id,p.source_id,p.id AS plan_id,w.id,w.plan_version,w.business_date,w.revision,w.state,w.reason,
          a.id AS attempt_id,a.error_code
        FROM lake.execution_window w JOIN lake.ingestion_plan p ON p.id=w.plan_id JOIN warehouse.project_source ps ON ps.source_id=p.source_id
        LEFT JOIN LATERAL(SELECT id,error_code FROM lake.execution_attempt WHERE window_id=w.id ORDER BY attempt DESC LIMIT 1) a ON true
        """+(project==null?"":" WHERE ps.project_id=?")+" ORDER BY ps.project_id,p.id,w.plan_version,w.business_date,w.revision DESC",project==null?new Object[]{}:new Object[]{project});
    for(var row:windows){
      String key="lake/"+row.get("plan_id")+"/"+row.get("plan_version")+"/"+row.get("business_date"),reference="lake-window/"+row.get("id");
      if(row.get("state").equals("COMPLETE")){recover(((Number)row.get("project_id")).longValue(),key,reference);continue;}
      if(!Set.of("FAILED","INCOMPLETE","MISSING").contains(row.get("state")))continue;
      String category=row.get("error_code")!=null?row.get("error_code").toString():row.get("reason")!=null?row.get("reason").toString():"DELIVERY_INCOMPLETE";
      var details=new LinkedHashMap<String,Object>();details.put("windowId",row.get("id"));details.put("attemptId",row.get("attempt_id"));details.put("businessDate",row.get("business_date").toString());details.put("reason",category);
      observe(((Number)row.get("project_id")).longValue(),key,category,((Number)row.get("source_id")).longValue(),null,
          reference+"/"+row.get("attempt_id")+"/"+row.get("state"),row.get("state").toString(),details);observed++;
    }
    var refresh=jdbc.queryForList("SELECT w.*,d.project_id,p.dataset_id FROM warehouse.refresh_window w JOIN warehouse.refresh_plan p ON p.id=w.plan_id JOIN warehouse.dataset d ON d.id=p.dataset_id"+(project==null?"":" WHERE d.project_id=?"),project==null?new Object[]{}:new Object[]{project});
    for(var row:refresh){String key="refresh/"+row.get("id"),reference="refresh-window/"+row.get("id");
      if(row.get("state").equals("PUBLISHED")){recover(((Number)row.get("project_id")).longValue(),key,"release/"+row.get("release_id"));continue;}
      boolean overdue=tree(row.get("details")).path("overdue").asBoolean();
      if(!Set.of("FAILED","QUALITY_REJECTED","NEEDS_ATTENTION").contains(row.get("state"))&&!(row.get("state").equals("WAITING_INPUTS")&&overdue))continue;
      String reason=row.get("reason")==null?"DATASET_DELIVERY_FAILED":row.get("reason").toString();
      observe(((Number)row.get("project_id")).longValue(),key,reason,null,((Number)row.get("dataset_id")).longValue(),reference+"/"+row.get("build_id")+"/"+row.get("state"),row.get("state").toString(),Map.of("windowId",row.get("id"),"businessDate",row.get("business_date").toString(),"reason",reason));observed++;
    }
    var builds=jdbc.queryForList("SELECT DISTINCT ON(b.dataset_id,b.model_version) b.id,b.dataset_id,b.model_version,b.state,b.error_code,d.project_id FROM warehouse.model_build b JOIN warehouse.dataset d ON d.id=b.dataset_id WHERE NOT EXISTS(SELECT 1 FROM warehouse.refresh_build rb WHERE rb.build_id=b.id)"+(project==null?"":" AND d.project_id=?")+" ORDER BY b.dataset_id,b.model_version,b.id DESC",project==null?new Object[]{}:new Object[]{project});
    for(var build:builds){
      String key="model/"+build.get("dataset_id")+"/"+build.get("model_version");long scope=((Number)build.get("project_id")).longValue();
      var published=jdbc.queryForList("SELECT r.id FROM warehouse.dataset d JOIN warehouse.dataset_release r ON r.id=d.active_release_id JOIN warehouse.model_build b ON b.id=r.build_id WHERE d.id=? AND r.model_version>=? AND b.id>=?",build.get("dataset_id"),build.get("model_version"),build.get("id"));
      if(!published.isEmpty()){recover(scope,key,"release/"+published.getFirst().get("id"));continue;}
      if(!Set.of("FAILED","REJECTED").contains(build.get("state")))continue;
      String category=build.get("error_code")==null?"MODEL_QUALITY_REJECTED":build.get("error_code").toString();
      observe(scope,key,category,null,((Number)build.get("dataset_id")).longValue(),"model-build/"+build.get("id"),build.get("state").toString(),Map.of("buildId",build.get("id"),"modelVersion",build.get("model_version"),"reason",category));observed++;
    }
    return Map.of("observed",observed);
  }
  private void observe(long project,String key,String category,Long source,Long dataset,String reference,String state,Object details){
    jdbc.update("INSERT INTO warehouse.operational_incident(project_id,logical_key,category,source_id,dataset_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",project,key,category,source,dataset);
    long id=jdbc.queryForObject("SELECT id FROM warehouse.operational_incident WHERE project_id=? AND logical_key=? AND category=? FOR UPDATE",Long.class,project,key,category);
    int created=jdbc.update("INSERT INTO warehouse.incident_observation(incident_id,observation_key,state,details) VALUES (?,?,?,?::jsonb) ON CONFLICT DO NOTHING",id,reference,state,json.valueToTree(details).toString());
    if(created>0)jdbc.update("UPDATE warehouse.operational_incident SET last_seen_at=clock_timestamp(),state=CASE WHEN state='RECOVERED' THEN 'OPEN' ELSE state END,recovery_reference=NULL,recovered_at=NULL,revision=revision+1 WHERE id=?",id);
  }
  private void recover(long project,String key,String reference){jdbc.update("UPDATE warehouse.operational_incident SET state='RECOVERED',recovery_reference=?,recovered_at=clock_timestamp(),revision=revision+1 WHERE project_id=? AND logical_key=? AND state<>'RECOVERED'",reference,project,key);}
  @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public Object list(long project,String actor,String q,String state,int limit,int offset){
    access.require(project,actor,"VIEWER");page(q,limit,offset);if(!state.isEmpty()&&!Set.of("OPEN","ACKNOWLEDGED","RECOVERED").contains(state))bad("INVALID_INCIDENT_STATE");
    String from=" FROM warehouse.operational_incident i LEFT JOIN control.source_connection s ON s.id=i.source_id LEFT JOIN warehouse.dataset d ON d.id=i.dataset_id LEFT JOIN warehouse.ingest_channel ch ON ch.source_id=s.id LEFT JOIN warehouse.ingest_connection c ON c.id=ch.connection_id AND EXISTS(SELECT 1 FROM warehouse.connection_project cp WHERE cp.connection_id=c.id AND cp.project_id=i.project_id AND cp.enabled) LEFT JOIN warehouse.system_instance si ON si.id=c.instance_id AND EXISTS(SELECT 1 FROM warehouse.instance_project ip WHERE ip.instance_id=si.id AND ip.project_id=i.project_id) LEFT JOIN warehouse.business_system bs ON bs.id=si.system_id AND EXISTS(SELECT 1 FROM warehouse.system_project sp WHERE sp.system_id=bs.id AND sp.project_id=i.project_id) WHERE i.project_id=? AND (?='' OR i.state=?) AND strpos(lower(i.category||' '||coalesce(s.code,'')||' '||coalesce(d.name,'')),lower(?))>0";
    var rows=jdbc.queryForList("SELECT i.*,s.code AS source_code,d.name AS dataset_name,c.name AS connection_name,si.name AS instance_name,bs.name AS system_name"+from+" ORDER BY i.last_seen_at DESC,i.id DESC LIMIT ? OFFSET ?",project,state,state,q,limit,offset);
    return Map.of("items",rows,"total",jdbc.queryForObject("SELECT count(*)"+from,Long.class,project,state,state,q),"limit",limit,"offset",offset);
  }
  public Object detail(long project,long id,String actor){
    access.require(project,actor,"VIEWER");var rows=jdbc.queryForList("SELECT * FROM warehouse.operational_incident WHERE id=? AND project_id=?",id,project);if(rows.isEmpty())denied();
    var observations=jdbc.queryForList("SELECT observation_key,state,details,observed_at FROM warehouse.incident_observation WHERE incident_id=? ORDER BY observed_at",id);observations.forEach(r->r.put("details",tree(r.get("details"))));return Map.of("incident",rows.getFirst(),"observations",observations);
  }
  @Transactional public Object acknowledge(long project,long id,JsonNode body,String actor){
    access.require(project,actor,"ENGINEER");String reason=text(body,"reason",1000,true),owner=text(body,"ownerIdentity",100,true);access.require(project,owner,"ENGINEER");
    if(jdbc.update("UPDATE warehouse.operational_incident SET state='ACKNOWLEDGED',owner_identity=?,acknowledged_by=?,acknowledgment_reason=?,acknowledged_at=clock_timestamp(),revision=revision+1 WHERE id=? AND project_id=? AND revision=? AND state IN ('OPEN','ACKNOWLEDGED')",owner,actor,reason,id,project,body.path("expectedRevision").asLong(-1))!=1)conflict("INCIDENT_CHANGED");
    jdbc.update("INSERT INTO control.audit_log(principal,action,resource,result,details) VALUES (?,'INCIDENT_ACKNOWLEDGE',?,'SUCCESS',?::jsonb)",actor,"incident/"+id,json.createObjectNode().put("reason",reason).put("owner",owner).toString());return Map.of("id",id,"state","ACKNOWLEDGED");
  }
  private JsonNode tree(Object value){try{return json.readTree(value.toString());}catch(Exception e){throw new IllegalStateException("INVALID_INCIDENT_DETAILS");}}
}
