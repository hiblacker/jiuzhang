package com.bydw.warehouse;

import static com.bydw.warehouse.SystemCatalogService.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SystemDeliveryService {
  private final JdbcTemplate jdbc;private final ObjectMapper json;private final SystemCatalogService systems;private final ManagedIngestionService ingestion;
  public SystemDeliveryService(JdbcTemplate jdbc,ObjectMapper json,SystemCatalogService systems,ManagedIngestionService ingestion){this.jdbc=jdbc;this.json=json;this.systems=systems;this.ingestion=ingestion;}
  @Transactional public Object save(long project,long instance,JsonNode body,String actor){
    systems.requireInstance(project,instance,actor,"OWNER");String timezone=text(body,"timezone",80,true),reason=text(body,"reason",300,true);
    LocalDate from;try{ZoneId.of(timezone);from=LocalDate.parse(body.path("effectiveFrom").asText());}catch(Exception e){bad("INVALID_DELIVERY_CALENDAR");return Map.of();}
    if(from.isBefore(LocalDate.now(ZoneId.of(timezone)))||!body.path("channels").isArray()||body.path("channels").size()>1000)bad("INVALID_DELIVERY_AGREEMENT");
    var channels=json.createArrayNode();var unique=new java.util.HashSet<Long>();
    for(JsonNode item:body.path("channels")){
      long source=item.path("sourceId").asLong(-1);if(!unique.add(source)||!item.path("required").isBoolean())bad("INVALID_DELIVERY_MEMBER");
      var channel=ingestion.channel(project,source,actor,"OWNER");var connection=ingestion.connection(project,((Number)channel.get("connection_id")).longValue(),actor,"OWNER");
      if(((Number)connection.get("instance_id")).longValue()!=instance)bad("CHANNEL_OUTSIDE_INSTANCE");
      String due=text(item,"deadline",8,true);try{LocalTime.parse(due);}catch(Exception e){bad("INVALID_DEADLINE");}
      int offset=item.path("businessDayOffset").asInt(0);if(offset< -1||offset>1)bad("INVALID_BUSINESS_DATE_MAPPING");
      channels.addObject().put("sourceId",source).put("required",item.path("required").asBoolean()).put("deadline",due).put("businessDayOffset",offset);
    }
    jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,"delivery/"+project+"/"+instance);
    int current=jdbc.queryForObject("SELECT coalesce(max(version),0) FROM warehouse.system_delivery_agreement WHERE project_id=? AND instance_id=?",Integer.class,project,instance);
    if(current!=body.path("expectedVersion").asInt(-1))conflict("DELIVERY_AGREEMENT_CHANGED");
    var contract=json.createObjectNode();contract.set("channels",channels);
    jdbc.update("INSERT INTO warehouse.system_delivery_agreement(instance_id,project_id,version,timezone,effective_from,contract,created_by) VALUES (?,?,?,?,?,?::jsonb,?)",instance,project,current+1,timezone,Date.valueOf(from),contract.toString(),actor);
    systems.audit(actor,"SYSTEM_DELIVERY_AGREEMENT",instance,Map.of("version",current+1,"reason",reason));return Map.of("version",current+1);
  }
  public Object agreements(long project,long instance,String actor){systems.requireInstance(project,instance,actor,"VIEWER");var rows=jdbc.queryForList("SELECT version,timezone,effective_from,contract,created_by,created_at FROM warehouse.system_delivery_agreement WHERE project_id=? AND instance_id=? ORDER BY version DESC",project,instance);rows.forEach(r->r.put("contract",ingestion.tree(r.get("contract"))));return rows;}
  @Transactional public Object freeze(long project,long instance,LocalDate day,String actor){systems.requireInstance(project,instance,actor,"OWNER");if(day==null)bad("INVALID_DELIVERY_DAY");return freezeWindow(project,instance,day);}
  private Object freezeWindow(long project,long instance,LocalDate day){
    if(jdbc.queryForObject("SELECT count(*) FROM warehouse.system_delivery_window WHERE project_id=? AND instance_id=? AND business_date=?",Long.class,project,instance,Date.valueOf(day))>0)return Map.of("frozen",true);
    var agreements=jdbc.queryForList("SELECT * FROM warehouse.system_delivery_agreement WHERE project_id=? AND instance_id=? AND effective_from<=? ORDER BY version DESC LIMIT 1",project,instance,Date.valueOf(day));
    if(agreements.isEmpty())return Map.of("frozen",false,"reason","AGREEMENT_NOT_CONFIGURED");var agreement=agreements.getFirst();
    if(day.isAfter(LocalDate.now(ZoneId.of(agreement.get("timezone").toString()))))bad("FUTURE_DELIVERY_DAY");
    var expected=json.createArrayNode();
    for(JsonNode item:ingestion.tree(agreement.get("contract")).path("channels")){
      long source=item.path("sourceId").asLong();LocalDate sourceDay=day.plusDays(item.path("businessDayOffset").asInt());
      var plans=jdbc.queryForList("SELECT p.id,p.active_version,v.timezone,v.contract,v.start_date FROM lake.ingestion_plan p JOIN lake.plan_version v ON v.plan_id=p.id AND v.version=p.active_version WHERE p.source_id=?",source);
      var member=json.createObjectNode().put("sourceId",source).put("required",item.path("required").asBoolean()).put("businessDate",sourceDay.toString()).put("deadline",item.path("deadline").asText()).put("summaryTimezone",agreement.get("timezone").toString());
      member.put("configured",!plans.isEmpty());member.put("scheduled",true);
      if(!plans.isEmpty()){
        var plan=plans.getFirst();JsonNode contract=ingestion.tree(plan.get("contract"));boolean scheduled=!sourceDay.isBefore(((Date)plan.get("start_date")).toLocalDate());
        if(contract.has("daysOfWeek")){boolean matches=false;for(JsonNode weekday:contract.path("daysOfWeek"))if(weekday.asInt()==sourceDay.getDayOfWeek().getValue())matches=true;scheduled=scheduled&&matches;}
        member.put("planId",((Number)plan.get("id")).longValue()).put("planVersion",((Number)plan.get("active_version")).intValue()).put("timezone",plan.get("timezone").toString()).put("scheduled",scheduled);
      }
      expected.add(member);
    }
    jdbc.update("INSERT INTO warehouse.system_delivery_window(instance_id,project_id,business_date,agreement_version,expected) VALUES (?,?,?,?,?::jsonb) ON CONFLICT DO NOTHING",instance,project,Date.valueOf(day),agreement.get("version"),expected.toString());return Map.of("frozen",true);
  }
  @Transactional public Object reconcile(Instant now){
    int checked=0;
    var agreements=jdbc.queryForList("SELECT DISTINCT ON(instance_id,project_id) *,min(effective_from) OVER(PARTITION BY instance_id,project_id) AS first_day FROM warehouse.system_delivery_agreement ORDER BY instance_id,project_id,version DESC");
    for(var row:agreements){LocalDate today=now.atZone(ZoneId.of(row.get("timezone").toString())).toLocalDate();
      var missing=jdbc.queryForList("SELECT d::date AS day FROM generate_series(?::date,?::date,interval '1 day') d WHERE NOT EXISTS(SELECT 1 FROM warehouse.system_delivery_window w WHERE w.instance_id=? AND w.project_id=? AND w.business_date=d::date) ORDER BY d LIMIT 31",row.get("first_day"),Date.valueOf(today),row.get("instance_id"),row.get("project_id"));
      for(var date:missing){
        freezeWindow(((Number)row.get("project_id")).longValue(),((Number)row.get("instance_id")).longValue(),((Date)date.get("day")).toLocalDate());checked++;
      }
    }return Map.of("checked",checked);
  }
  @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public Object status(long project,long instance,LocalDate day,String actor){
    systems.requireInstance(project,instance,actor,"VIEWER");var rows=jdbc.queryForList("SELECT * FROM warehouse.system_delivery_window WHERE instance_id=? AND project_id=? AND business_date=?",instance,project,Date.valueOf(day));
    if(rows.isEmpty())return Map.of("state","NOT_CHECKED","items",List.of(),"scope","CURRENT_PROJECT");
    var row=rows.getFirst();var items=json.createArrayNode();int required=0,complete=0,hidden=0,scheduledCount=0;
    for(JsonNode item:ingestion.tree(row.get("expected"))){
      if(jdbc.queryForObject("SELECT count(*) FROM warehouse.project_source WHERE source_id=? AND project_id=?",Long.class,item.path("sourceId").asLong(),project)!=1){hidden++;continue;}
      var value=(com.fasterxml.jackson.databind.node.ObjectNode)item.deepCopy();boolean scheduled=item.path("scheduled").asBoolean();
      String state=scheduled?"MISSING":"NO_SCHEDULE";
      if(scheduled&&item.path("configured").asBoolean()){
        var windows=jdbc.queryForList("SELECT id,state,revision,window_start,window_end FROM lake.execution_window WHERE plan_id=? AND plan_version=? AND business_date=? ORDER BY revision DESC LIMIT 1",item.path("planId").asLong(),item.path("planVersion").asInt(),Date.valueOf(item.path("businessDate").asText()));
        if(!windows.isEmpty()){state=windows.getFirst().get("state").toString();value.set("window",json.valueToTree(windows.getFirst()));}
      }else if(scheduled)state="NOT_CONFIGURED";
      value.put("name",jdbc.queryForObject("SELECT code FROM control.source_connection WHERE id=?",String.class,item.path("sourceId").asLong()));value.put("state",state);items.add(value);
      if(scheduled)scheduledCount++;
      Instant due=day.atTime(LocalTime.parse(item.path("deadline").asText())).atZone(ZoneId.of(item.path("summaryTimezone").asText())).toInstant();
      value.put("overdue",scheduled&&!state.equals("COMPLETE")&&Instant.now().isAfter(due));
      if(scheduled&&item.path("required").asBoolean()){required++;if(state.equals("COMPLETE"))complete++;}
    }
    String state=hidden>0?"PARTIAL_SCOPE":scheduledCount==0?"NO_SCHEDULE":required==0?"NO_REQUIRED_DELIVERY":complete==required?"COMPLETE":"INCOMPLETE";
    return Map.of("state",state,"items",items,"required",required,"complete",complete,"agreementVersion",row.get("agreement_version"),"businessDate",day.toString(),"scope","CURRENT_PROJECT");
  }
}
