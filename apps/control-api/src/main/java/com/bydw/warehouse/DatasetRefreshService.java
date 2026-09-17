package com.bydw.warehouse;

import static com.bydw.warehouse.ModelService.*;
import com.bydw.api.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Date;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** Reconciles bounded metadata windows; ingestion and SQL execution remain worker jobs. */
@Service
public class DatasetRefreshService {
  private final JdbcTemplate jdbc;
  private final ModelService models;
  private final ModelExecutionService execution;
  private final ProductAccessService access;
  private final ObjectMapper json;
  private final TransactionTemplate transaction;
  public DatasetRefreshService(JdbcTemplate jdbc,ModelService models,ModelExecutionService execution,ProductAccessService access,ObjectMapper json,PlatformTransactionManager manager){
    this.jdbc=jdbc;this.models=models;this.execution=execution;this.access=access;this.json=json;transaction=new TransactionTemplate(manager);
  }
  @Transactional public Object save(long project,long dataset,JsonNode body,String actor){
    var data=models.dataset(project,dataset,actor,"OWNER");
    int version=body.path("modelVersion").asInt(-1);
    if(version!=((Number)data.get("active_model_version")).intValue())conflict("REFRESH_MODEL_NOT_CURRENT");
    String service=body.path("serviceIdentity").asText(),mode=body.path("publishMode").asText("MANUAL"),late=body.path("latePolicy").asText("CONTINUE");
    if(!Set.of("MANUAL","AUTO").contains(mode)||!Set.of("CONTINUE","MANUAL").contains(late))bad("INVALID_REFRESH_POLICY");
    requireService(project,service,mode.equals("AUTO")?"OWNER":"ENGINEER");
    ZoneId timezone;LocalDate start;LocalTime trigger,deadline;
    try{timezone=ZoneId.of(body.path("timezone").asText());start=LocalDate.parse(body.path("startDate").asText());trigger=LocalTime.parse(body.path("triggerTime").asText());deadline=LocalTime.parse(body.path("deadline").asText());}
    catch(DateTimeException e){bad("INVALID_REFRESH_CALENDAR");return Map.of();}
    if(start.getYear()<2000||start.getYear()>2100)bad("INVALID_REFRESH_CALENDAR");
    for(String field:List.of("maxSkewSeconds","freshnessSeconds"))if(body.has(field)&&!body.path(field).isIntegralNumber())bad("INVALID_REFRESH_TOLERANCE");
    long skew=body.path("maxSkewSeconds").asLong(86400),freshness=body.path("freshnessSeconds").asLong(172800);
    if(skew<0||skew>2678400||freshness<60||freshness>31536000)bad("INVALID_REFRESH_TOLERANCE");
    JsonNode contract=models.tree(jdbc.queryForObject("SELECT contract FROM warehouse.model_version WHERE dataset_id=? AND version=?",String.class,dataset,version));
    models.requireInputsActive(project,contract,actor);models.requireInputsActive(project,contract,service);
    if(mode.equals("AUTO"))requireApprovedModel(data,version);
    var selectors=json.createArrayNode();var sources=new HashMap<String,Integer>();
    if(!body.path("inputSelectors").isObject()||body.path("inputSelectors").size()!=contract.path("inputs").size())bad("INPUT_SELECTORS_REQUIRED");
    for(JsonNode input:contract.path("inputs")){
      String alias=input.path("alias").asText(),source=input.path("sourceCode").asText();JsonNode selection=body.path("inputSelectors").path(alias);
      if(!selection.isObject()||!selection.path("businessDayOffset").isIntegralNumber())bad("INVALID_INPUT_DATE_MAPPING");
      int offset=selection.path("businessDayOffset").asInt();if(offset< -31||offset>0)bad("INVALID_INPUT_DATE_MAPPING");
      Integer previous=sources.putIfAbsent(source,offset);if(previous!=null&&previous!=offset)bad("INPUT_BATCHES_NOT_COHERENT");
      var plans=jdbc.queryForList("SELECT p.id,p.active_version,v.timezone FROM lake.ingestion_plan p JOIN control.source_connection s ON s.id=p.source_id JOIN lake.plan_version v ON v.plan_id=p.id AND v.version=p.active_version WHERE s.code=?",source);
      if(plans.isEmpty())bad("INPUT_INGESTION_PLAN_REQUIRED");var plan=plans.getFirst();
      selectors.addObject().put("alias",alias).put("sourceCode",source).put("objectName",input.path("objectName").asText()).put("businessDayOffset",offset)
          .put("ingestionPlanId",((Number)plan.get("id")).longValue()).put("ingestionPlanVersion",((Number)plan.get("active_version")).intValue()).put("sourceTimezone",plan.get("timezone").toString());
    }
    var config=json.createObjectNode().put("timezone",timezone.toString()).put("startDate",start.toString()).put("triggerTime",trigger.toString())
        .put("deadline",deadline.toString()).put("publishMode",mode).put("latePolicy",late).put("maxSkewSeconds",skew).put("freshnessSeconds",freshness);
    config.set("inputSelectors",selectors);
    var days=body.path("daysOfWeek");if(days.isMissingNode())days=json.valueToTree(List.of(1,2,3,4,5,6,7));
    if(!days.isArray()||days.isEmpty()||days.size()>7)bad("INVALID_REFRESH_DAYS");var unique=new HashSet<Integer>();
    for(JsonNode day:days)if(!day.isIntegralNumber()||day.asInt()<1||day.asInt()>7||!unique.add(day.asInt()))bad("INVALID_REFRESH_DAYS");config.set("daysOfWeek",days);
    jdbc.queryForMap("SELECT id FROM warehouse.dataset WHERE id=? FOR UPDATE",dataset);
    var current=jdbc.queryForList("SELECT * FROM warehouse.refresh_plan WHERE dataset_id=? FOR UPDATE",dataset);
    int expected=current.isEmpty()?0:((Number)current.getFirst().get("active_version")).intValue();
    if(expected!=body.path("expectedVersion").asInt(-1))conflict("REFRESH_PLAN_VERSION_CHANGED");
    long plan=current.isEmpty()?jdbc.queryForObject("INSERT INTO warehouse.refresh_plan(dataset_id,active_version) VALUES (?,1) RETURNING id",Long.class,dataset):((Number)current.getFirst().get("id")).longValue();
    if(!current.isEmpty())jdbc.update("UPDATE warehouse.refresh_plan SET active_version=?,revision=revision+1 WHERE id=?",expected+1,plan);
    jdbc.update("INSERT INTO warehouse.refresh_plan_version(plan_id,version,model_version,config,operational_owner,service_identity,approved_by) VALUES (?,?,?,?::jsonb,?,?,?)",plan,expected+1,version,config.toString(),actor,service,actor);
    models.audit(actor,"REFRESH_PLAN_SAVE",dataset,Map.of("version",expected+1,"serviceIdentity",service,"publishMode",mode));return Map.of("id",plan,"version",expected+1);
  }
  private void requireService(long project,String identity,String role){
    if(identity==null||identity.startsWith("local-")||access.admin(identity)||jdbc.queryForObject("SELECT count(*) FROM warehouse.identity WHERE id=? AND enabled",Long.class,identity)!=1)bad("PROJECT_SERVICE_IDENTITY_REQUIRED");
    access.require(project,identity,role);
  }
  private void requireApprovedModel(Map<String,Object> data,int model){
    if(data.get("active_release_id")==null||jdbc.queryForObject("SELECT count(*) FROM warehouse.dataset_release WHERE id=? AND model_version=?",Long.class,data.get("active_release_id"),model)!=1)conflict("MANUAL_MODEL_PUBLICATION_REQUIRED");
  }
  public Object detail(long project,long dataset,String actor){
    models.dataset(project,dataset,actor,"VIEWER");var plans=jdbc.queryForList("SELECT p.*,v.model_version,v.config,v.operational_owner,v.service_identity,v.approved_by FROM warehouse.refresh_plan p JOIN warehouse.refresh_plan_version v ON v.plan_id=p.id AND v.version=p.active_version WHERE p.dataset_id=?",dataset);
    if(plans.isEmpty())return Map.of("configured",false);var row=plans.getFirst();row.put("config",models.tree(row.get("config")));row.put("configured",true);return row;
  }
  @Transactional public Object state(long project,long dataset,JsonNode body,String actor){
    models.dataset(project,dataset,actor,"OWNER");String state=body.path("state").asText();if(!Set.of("ACTIVE","PAUSED").contains(state)||body.path("reason").asText().isBlank())bad("REFRESH_STATE_REASON_REQUIRED");
    if(jdbc.update("UPDATE warehouse.refresh_plan SET state=?,revision=revision+1 WHERE dataset_id=? AND revision=?",state,dataset,body.path("expectedRevision").asLong(-1))!=1)conflict("REFRESH_PLAN_VERSION_CHANGED");
    models.audit(actor,"REFRESH_PLAN_STATE",dataset,Map.of("state",state,"reason",body.path("reason").asText()));return Map.of("state",state);
  }
  @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public Object windows(long project,long dataset,String actor,int limit,int offset){
    models.dataset(project,dataset,actor,"VIEWER");SystemCatalogService.page("",limit,offset);
    var rows=jdbc.queryForList("SELECT w.* FROM warehouse.refresh_window w JOIN warehouse.refresh_plan p ON p.id=w.plan_id WHERE p.dataset_id=? ORDER BY w.business_date DESC,w.plan_version DESC LIMIT ? OFFSET ?",dataset,limit,offset);
    rows.forEach(r->{models.decode(r,"details");models.decode(r,"selected_inputs");});return Map.of("items",rows,"total",jdbc.queryForObject("SELECT count(*) FROM warehouse.refresh_window w JOIN warehouse.refresh_plan p ON p.id=w.plan_id WHERE p.dataset_id=?",Long.class,dataset),"limit",limit,"offset",offset);
  }
  public Object reconcileUser(long project,long dataset,JsonNode body,String actor){
    models.dataset(project,dataset,actor,"OWNER");LocalDate day=null;
    if(body.has("day")){try{day=LocalDate.parse(body.path("day").asText());}catch(DateTimeException e){bad("INVALID_REFRESH_DAY");}}
    boolean approve=body.path("approveLate").asBoolean(false);if(approve&&body.path("reason").asText().isBlank())bad("LATE_APPROVAL_REASON_REQUIRED");
    Object result=reconcile(dataset,day,approve,Instant.now());models.audit(actor,"REFRESH_RECONCILE",dataset,Map.of("approveLate",approve,"reason",body.path("reason").asText()));return result;
  }
  public Object reconcileAll(Instant now){return reconcile(null,null,false,now);}
  private Object reconcile(Long dataset,LocalDate requested,boolean approve,Instant now){
    int checked=0;
    var plans=jdbc.queryForList("SELECT p.*,v.model_version,v.config,v.service_identity,v.operational_owner,d.project_id FROM warehouse.refresh_plan p JOIN warehouse.refresh_plan_version v ON v.plan_id=p.id AND v.version=p.active_version JOIN warehouse.dataset d ON d.id=p.dataset_id WHERE p.state='ACTIVE'"+(dataset==null?"":" AND p.dataset_id=?")+" ORDER BY p.id",dataset==null?new Object[]{}:new Object[]{dataset});
    for(var plan:plans){
      JsonNode config=models.tree(plan.get("config"));ZoneId timezone=ZoneId.of(config.path("timezone").asText());LocalDate today=now.atZone(timezone).toLocalDate();
      LocalDate start=LocalDate.parse(config.path("startDate").asText());LocalDate due=now.atZone(timezone).toLocalTime().isBefore(LocalTime.parse(config.path("triggerTime").asText()))?today.minusDays(1):today;
      if(requested!=null&&(requested.isBefore(start)||requested.isAfter(today)))bad("REFRESH_DAY_OUTSIDE_PLAN");
      var dates=new LinkedHashSet<LocalDate>();
      if(requested!=null)dates.add(requested);
      else{
        // Revisit recent complete windows for correction sets, and advance old gaps without starving today.
        for(LocalDate day=due;!day.isBefore(start)&&!day.isBefore(due.minusDays(30));day=day.minusDays(1))dates.add(day);
        var gaps=jdbc.queryForList("SELECT day::date FROM generate_series(?::date,?::date,interval '1 day') day WHERE NOT EXISTS(SELECT 1 FROM warehouse.refresh_window w WHERE w.plan_id=? AND w.plan_version=? AND w.business_date=day::date) AND (?::jsonb) @> to_jsonb(extract(isodow FROM day)::integer) ORDER BY day LIMIT 31",Date.valueOf(start),Date.valueOf(due),plan.get("id"),plan.get("active_version"),config.path("daysOfWeek").toString());
        for(var row:gaps)dates.add(((Date)row.get("day")).toLocalDate());
      }
      for(LocalDate day:dates){boolean scheduled=false;for(JsonNode weekday:config.path("daysOfWeek"))if(weekday.asInt()==day.getDayOfWeek().getValue())scheduled=true;if(!scheduled)continue;
        Long window=transaction.execute(status->{jdbc.update("INSERT INTO warehouse.refresh_window(plan_id,plan_version,business_date) VALUES (?,?,?) ON CONFLICT DO NOTHING",plan.get("id"),plan.get("active_version"),Date.valueOf(day));return jdbc.queryForObject("SELECT id FROM warehouse.refresh_window WHERE plan_id=? AND plan_version=? AND business_date=?",Long.class,plan.get("id"),plan.get("active_version"),Date.valueOf(day));});
        try{transaction.executeWithoutResult(status->advance(plan,window,day,config,approve,now));}
        catch(ApiException e){jdbc.update("UPDATE warehouse.refresh_window SET state='NEEDS_ATTENTION',reason=?,checked_at=clock_timestamp() WHERE id=?",e.code(),window);}
        checked++;
      }
    }
    return Map.of("checked",checked);
  }
  @Transactional public Object retry(long project,long dataset,long window,JsonNode body,String actor){
    models.dataset(project,dataset,actor,"OWNER");
    String reason=SystemCatalogService.text(body,"reason",1000,true);
    long expected=body.path("expectedBuildId").asLong(-1);
    var data=jdbc.queryForMap("SELECT * FROM warehouse.dataset WHERE id=? FOR UPDATE",dataset);
    var plans=jdbc.queryForList("SELECT p.*,v.model_version,v.config,v.service_identity,v.operational_owner FROM warehouse.refresh_plan p JOIN warehouse.refresh_plan_version v ON v.plan_id=p.id AND v.version=p.active_version WHERE p.dataset_id=? FOR UPDATE OF p",dataset);
    if(plans.isEmpty())conflict("REFRESH_PLAN_REQUIRED");var plan=plans.getFirst();
    var rows=jdbc.queryForList("SELECT * FROM warehouse.refresh_window WHERE id=? AND plan_id=? FOR UPDATE",window,plan.get("id"));
    if(rows.isEmpty())missing("REFRESH_WINDOW_NOT_FOUND");var row=rows.getFirst();
    if(!plan.get("state").equals("ACTIVE")||!plan.get("active_version").equals(row.get("plan_version"))||!data.get("active_model_version").equals(plan.get("model_version")))conflict("REFRESH_PLAN_PAUSED_OR_CHANGED");
    var replay=jdbc.queryForList("SELECT build_id FROM warehouse.refresh_build WHERE window_id=? AND retry_of=?",window,expected);
    if(!replay.isEmpty())return Map.of("buildId",replay.getFirst().get("build_id"),"reused",true);
    if(!(row.get("build_id") instanceof Number n)||n.longValue()!=expected)conflict("REFRESH_BUILD_CHANGED");
    String state=jdbc.queryForObject("SELECT state FROM warehouse.model_build WHERE id=?",String.class,expected);
    if(!Set.of("FAILED","CANCELLED").contains(state))conflict("REFRESH_BUILD_NOT_RETRYABLE");
    JsonNode config=models.tree(plan.get("config"));String service=plan.get("service_identity").toString();
    requireService(project,service,config.path("publishMode").asText().equals("AUTO")?"OWNER":"ENGINEER");access.require(project,plan.get("operational_owner").toString(),"OWNER");
    var request=json.createObjectNode().put("requestKey","refresh-retry-"+window+"-"+expected).put("modelVersion",((Number)plan.get("model_version")).intValue());request.set("inputs",models.tree(row.get("selected_inputs")));
    long build=((Number)models.build(project,dataset,request,service).get("id")).longValue();
    jdbc.update("INSERT INTO warehouse.refresh_build(window_id,input_hash,build_id,retry_of) VALUES (?,?,?,?)",window,row.get("input_hash"),build,expected);
    jdbc.update("UPDATE warehouse.refresh_window SET build_id=?,state='BUILDING',reason=NULL,release_id=NULL,checked_at=clock_timestamp() WHERE id=?",build,window);
    models.audit(actor,"REFRESH_RETRY",dataset,Map.of("windowId",window,"previousBuildId",expected,"buildId",build,"reason",reason));
    return Map.of("buildId",build,"reused",false);
  }
  private void advance(Map<String,Object> plan,long window,LocalDate day,JsonNode config,boolean approve,Instant now){
    // Same lock order as user plan changes: dataset -> refresh plan -> window.
    long dataset=((Number)plan.get("dataset_id")).longValue(),project=((Number)plan.get("project_id")).longValue();
    var data=jdbc.queryForMap("SELECT * FROM warehouse.dataset WHERE id=? FOR UPDATE",dataset);
    var current=jdbc.queryForMap("SELECT * FROM warehouse.refresh_plan WHERE id=? FOR UPDATE",plan.get("id"));
    if(!current.get("state").equals("ACTIVE")||!current.get("active_version").equals(plan.get("active_version")))return;
    var row=jdbc.queryForMap("SELECT * FROM warehouse.refresh_window WHERE id=? FOR UPDATE",window);
    String service=plan.get("service_identity").toString();boolean automatic=config.path("publishMode").asText().equals("AUTO");
    requireService(project,service,automatic?"OWNER":"ENGINEER");access.require(project,plan.get("operational_owner").toString(),"OWNER");
    int model=((Number)plan.get("model_version")).intValue();
    if(!data.get("active_model_version").equals(model))conflict("REFRESH_MODEL_CHANGED_REVIEW_REQUIRED");
    JsonNode contract=models.tree(jdbc.queryForObject("SELECT contract FROM warehouse.model_version WHERE dataset_id=? AND version=?",String.class,dataset,model));models.requireInputsActive(project,contract,service);
    var selected=json.createObjectNode();var observations=json.createArrayNode();var missing=json.createArrayNode();var batches=new HashMap<String,Map<String,Object>>();
    Instant earliest=null,latest=null;
    for(JsonNode selector:config.path("inputSelectors")){
      String source=selector.path("sourceCode").asText(),alias=selector.path("alias").asText();LocalDate inputDay=day.plusDays(selector.path("businessDayOffset").asInt());
      Map<String,Object> batch=batches.get(source);
      if(batch==null){
        Integer active=jdbc.queryForObject("SELECT active_version FROM lake.ingestion_plan WHERE id=?",Integer.class,selector.path("ingestionPlanId").asLong());
        if(active!=selector.path("ingestionPlanVersion").asInt())conflict("INPUT_PLAN_CHANGED_REVIEW_REQUIRED");
        var windows=jdbc.queryForList("SELECT w.*,v.kind,p.active_version FROM lake.execution_window w JOIN lake.ingestion_plan p ON p.id=w.plan_id JOIN lake.plan_version v ON v.plan_id=w.plan_id AND v.version=w.plan_version WHERE w.plan_id=? AND w.plan_version=? AND w.business_date=? ORDER BY w.revision DESC LIMIT 1",selector.path("ingestionPlanId").asLong(),selector.path("ingestionPlanVersion").asInt(),Date.valueOf(inputDay));
        if(windows.isEmpty()){missing.addObject().put("alias",alias).put("reason","DELIVERY_WINDOW_MISSING").put("businessDate",inputDay.toString());continue;}
        batch=windows.getFirst();batches.put(source,batch);
      }
      if(!batch.get("state").equals("COMPLETE")){missing.addObject().put("alias",alias).put("reason","DELIVERY_"+batch.get("state")).put("businessDate",inputDay.toString());continue;}
      var attempts=jdbc.queryForList("SELECT * FROM lake.execution_attempt WHERE window_id=? ORDER BY attempt DESC LIMIT 1",batch.get("id"));
      if(attempts.isEmpty()||!attempts.getFirst().get("state").equals("COMPLETE")){missing.addObject().put("alias",alias).put("reason","DELIVERY_NOT_COMPLETE");continue;}
      var attempt=attempts.getFirst();List<Map<String,Object>> assets;
      if(batch.get("kind").equals("MYSQL_SNAPSHOT"))assets=jdbc.queryForList("SELECT 'mysql:'||o.id AS id,r.started_at AS observed_at FROM lake.object_run o JOIN lake.system_run r ON r.id=o.system_run_id JOIN lake.source_object so ON so.id=o.source_object_id WHERE r.id=? AND r.state='COMPLETE' AND o.state='RAW_COMMITTED' AND so.object_name=?",attempt.get("system_run_id"),selector.path("objectName").asText());
      else assets=jdbc.queryForList("SELECT 'external:'||a.id AS id,a.created_at AS observed_at FROM warehouse.external_asset a WHERE a.execution_id=? AND a.state='PARSED' AND a.object_key=?",attempt.get("id"),selector.path("objectName").asText());
      if(assets.size()!=1){missing.addObject().put("alias",alias).put("reason","OBJECT_NOT_AVAILABLE").put("object",selector.path("objectName").asText());continue;}
      var asset=assets.getFirst();selected.put(alias,asset.get("id").toString());Instant observed=((java.sql.Timestamp)asset.get("observed_at")).toInstant();
      if(earliest==null||observed.isBefore(earliest))earliest=observed;if(latest==null||observed.isAfter(latest))latest=observed;
      observations.addObject().put("alias",alias).put("assetId",asset.get("id").toString()).put("businessDate",inputDay.toString()).put("sourceTimezone",selector.path("sourceTimezone").asText()).put("observedAt",observed.toString()).put("windowId",((Number)batch.get("id")).longValue()).put("revision",((Number)batch.get("revision")).intValue()).put("executionId",((Number)attempt.get("id")).longValue());
    }
    var details=json.createObjectNode();details.set("inputs",observations);details.set("missing",missing);
    boolean overdue=now.isAfter(day.atTime(LocalTime.parse(config.path("deadline").asText())).atZone(ZoneId.of(config.path("timezone").asText())).toInstant());details.put("overdue",overdue);
    if(!missing.isEmpty()){update(window,"WAITING_INPUTS",overdue?"INPUT_DEADLINE_EXCEEDED":"INPUTS_PENDING",details);return;}
    if(earliest!=null&&Duration.between(earliest,latest).getSeconds()>config.path("maxSkewSeconds").asLong()){update(window,"NEEDS_ATTENTION","CROSS_SOURCE_TIME_SKEW",details);return;}
    String hash=ProductAccessService.hash(selected.toString());
    if(!hash.equals(row.get("input_hash"))){
      if(overdue&&config.path("latePolicy").asText().equals("MANUAL")&&!approve){update(window,"NEEDS_ATTENTION","LATE_INPUT_REQUIRES_APPROVAL",details);return;}
      String requestKey="refresh-"+window+"-"+hash;
      var request=json.createObjectNode().put("requestKey",requestKey).put("modelVersion",model);request.set("inputs",selected);
      var build=models.build(project,dataset,request,service);long buildId=((Number)build.get("id")).longValue();
      jdbc.update("INSERT INTO warehouse.refresh_build(window_id,input_hash,build_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",window,hash,buildId);
      jdbc.update("UPDATE warehouse.refresh_window SET selected_inputs=?::jsonb,input_hash=?,build_id=?,release_id=NULL WHERE id=?",selected.toString(),hash,buildId,window);
      row.put("build_id",buildId);
    }
    long buildId=((Number)row.get("build_id")).longValue();var build=jdbc.queryForMap("SELECT state,error_code FROM warehouse.model_build WHERE id=?",buildId);
    var releases=jdbc.queryForList("SELECT id FROM warehouse.dataset_release WHERE build_id=?",buildId);
    if(!releases.isEmpty()){jdbc.update("UPDATE warehouse.refresh_window SET release_id=? WHERE id=?",releases.getFirst().get("id"),window);update(window,"PUBLISHED",null,details);return;}
    switch(build.get("state").toString()){
      case "QUEUED","RUNNING" -> update(window,"BUILDING",null,details);
      case "READY" -> {
        if(automatic){requireApprovedModel(data,model);var published=execution.publish(project,dataset,buildId,"Approved refresh plan "+plan.get("id")+" version "+plan.get("active_version")+" / "+day,service);jdbc.update("UPDATE warehouse.refresh_window SET release_id=? WHERE id=?",published.get("releaseId"),window);update(window,"PUBLISHED",null,details);}
        else update(window,"READY_TO_PUBLISH",null,details);
      }
      case "REJECTED" -> update(window,"QUALITY_REJECTED","MODEL_QUALITY_REJECTED",details);
      case "CANCELLED" -> update(window,"CANCELLED","MODEL_CANCELLED",details);
      default -> update(window,"FAILED",build.get("error_code")==null?"MODEL_BUILD_FAILED":build.get("error_code").toString(),details);
    }
  }
  private void update(long window,String state,String reason,ObjectNode details){jdbc.update("UPDATE warehouse.refresh_window SET state=?,reason=?,details=?::jsonb,checked_at=clock_timestamp() WHERE id=?",state,reason,details.toString(),window);}
}
