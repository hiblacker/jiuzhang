package com.bydw.warehouse;

import static com.bydw.warehouse.ModelService.*;
import com.bydw.api.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DatasetQueryService {
  private final JdbcTemplate jdbc;
  private final ModelService models;
  private final ProductAccessService access;
  private final QueryAuditService audit;
  private final DatasetFreshnessService freshness;
  public DatasetQueryService(JdbcTemplate jdbc,ModelService models,ProductAccessService access,QueryAuditService audit,DatasetFreshnessService freshness){this.jdbc=jdbc;this.models=models;this.access=access;this.audit=audit;this.freshness=freshness;}

  @Transactional public Map<String,Object> policy(long project,long dataset,JsonNode request,String actor){
    models.dataset(project,dataset,actor,"OWNER");
    String identity=request.path("identity").asText();access.require(project,identity,"VIEWER");
    var data=jdbc.queryForMap("SELECT active_model_version FROM warehouse.dataset WHERE id=? FOR UPDATE",dataset);
    JsonNode contract=models.tree(jdbc.queryForObject("SELECT contract FROM warehouse.model_version WHERE dataset_id=? AND version=?",String.class,dataset,data.get("active_model_version")));
    var types=types(contract);var fields=new LinkedHashSet<>(types.keySet());
    if(!request.path("columns").isArray()||request.path("columns").isEmpty()||request.path("columns").size()>200||!request.path("rowEquals").isObject())bad("INVALID_DATASET_POLICY");
    var seen=new HashSet<String>();for(JsonNode column:request.path("columns"))if(!column.isTextual()||!fields.contains(column.asText())||!seen.add(column.asText()))bad("INVALID_POLICY_COLUMN");
    equalPredicates(request.path("rowEquals"),fields,types,new ArrayList<>(),new ArrayList<>());
    var current=jdbc.queryForList("SELECT revision FROM warehouse.dataset_policy WHERE dataset_id=? AND identity_id=? FOR UPDATE",dataset,identity);
    long revision=current.isEmpty()?0:((Number)current.getFirst().get("revision")).longValue();
    if(request.has("expectedRevision")&&request.path("expectedRevision").asLong(-1)!=revision)conflict("POLICY_REVISION_CHANGED");
    jdbc.update("INSERT INTO warehouse.dataset_policy(dataset_id,identity_id,columns_json,row_equals,field_types) VALUES (?,?,?::jsonb,?::jsonb,?::jsonb) ON CONFLICT(dataset_id,identity_id) DO UPDATE SET columns_json=EXCLUDED.columns_json,row_equals=EXCLUDED.row_equals,field_types=EXCLUDED.field_types,revision=warehouse.dataset_policy.revision+1",dataset,identity,request.path("columns").toString(),request.path("rowEquals").toString(),new ObjectMapper().valueToTree(types).toString());
    models.audit(actor,"DATASET_POLICY_CHANGE",dataset,Map.of("identity",identity,"revision",revision+1));return Map.of("identity",identity,"datasetId",dataset,"revision",revision+1);
  }
  public Object policies(long project,long dataset,String actor){
    models.dataset(project,dataset,actor,"OWNER");var rows=jdbc.queryForList("SELECT identity_id,columns_json,row_equals,revision FROM warehouse.dataset_policy WHERE dataset_id=? ORDER BY identity_id",dataset);
    rows.forEach(r->{models.decode(r,"columns_json");models.decode(r,"row_equals");});return rows;
  }
  public Object description(long project,long dataset,String actor){
    var data=models.dataset(project,dataset,actor,"VIEWER");Long release=data.get("active_release_id") instanceof Number n?n.longValue():null;
    var response=new LinkedHashMap<String,Object>(data);response.put("freshness",freshness.describe(dataset,release));
    if(release==null){response.put("fields",List.of());return response;}
    JsonNode contract=models.tree(jdbc.queryForObject("SELECT v.contract FROM warehouse.dataset_release r JOIN warehouse.model_version v ON v.dataset_id=r.dataset_id AND v.version=r.model_version WHERE r.id=?",String.class,release));
    var allowed=new LinkedHashSet<>(types(contract).keySet());
    if(access.require(project,actor,"VIEWER").equals("VIEWER")){
      var policies=jdbc.queryForList("SELECT columns_json FROM warehouse.dataset_policy WHERE dataset_id=? AND identity_id=?",dataset,actor);
      if(policies.isEmpty()){response.put("fields",List.of());response.put("queryAuthorized",false);return response;}
      var granted=new HashSet<String>();models.tree(policies.getFirst().get("columns_json")).forEach(c->granted.add(c.asText()));allowed.retainAll(granted);
    }
    var fields=new ArrayList<JsonNode>();for(JsonNode field:contract.path("fields"))if(allowed.contains(field.path("name").asText()))fields.add(field);
    response.put("fields",fields);response.put("grain",contract.path("grain").asText());response.put("domain",contract.path("domain").asText());response.put("queryAuthorized",true);return response;
  }
  @Transactional(isolation=Isolation.REPEATABLE_READ)
  public Map<String,Object> query(long project,long dataset,JsonNode request,String actor){return audited(project,dataset,request,actor,"QUERY");}
  @Transactional(isolation=Isolation.REPEATABLE_READ)
  public Map<String,Object> export(long project,long dataset,JsonNode request,String actor){return audited(project,dataset,request,actor,"EXPORT");}
  private Map<String,Object> audited(long project,long dataset,JsonNode request,String actor,String action){
    long started=System.nanoTime();
    try{var result=execute(project,dataset,request,actor);audit.record(project,dataset,actor,action,request,result,"SUCCESS",(System.nanoTime()-started)/1_000_000);return result;}
    catch(RuntimeException e){audit.record(project,dataset,actor,action,request,null,e instanceof ApiException a?a.code():"QUERY_EXECUTION_FAILED",(System.nanoTime()-started)/1_000_000);throw e;}
  }
  private Map<String,Object> execute(long project,long dataset,JsonNode request,String actor){
    if(request==null||!request.isObject()||request.toString().length()>65536)bad("INVALID_QUERY_REQUEST");
    request.fieldNames().forEachRemaining(k->{if(!Set.of("releaseId","columns","limit","offset","equals","filters","sort").contains(k))bad("UNSUPPORTED_QUERY_OPERATION");});
    var data=models.dataset(project,dataset,actor,"VIEWER");String role=access.require(project,actor,"VIEWER");
    for(String key:List.of("releaseId","limit","offset"))if(request.has(key)&&(!request.path(key).isIntegralNumber()||!request.path(key).canConvertToLong()))bad("INVALID_QUERY_LIMIT");
    long release=request.path("releaseId").asLong(data.get("active_release_id") instanceof Number n?n.longValue():0);
    var releases=jdbc.queryForList("SELECT b.schema_name,v.contract,r.model_version FROM warehouse.dataset_release r JOIN warehouse.model_build b ON b.id=r.build_id JOIN warehouse.model_version v ON v.dataset_id=r.dataset_id AND v.version=r.model_version WHERE r.id=? AND r.dataset_id=? AND b.frozen_at IS NOT NULL",release,dataset);
    if(releases.isEmpty())missing("RELEASE_NOT_FOUND");var record=releases.getFirst();JsonNode contract=models.tree(record.get("contract"));
    var types=types(contract);var fields=new LinkedHashSet<>(types.keySet());JsonNode rowPolicy=null;long policyRevision=0;
    if(role.equals("VIEWER")){
      var policies=jdbc.queryForList("SELECT columns_json,row_equals,field_types,revision FROM warehouse.dataset_policy WHERE dataset_id=? AND identity_id=?",dataset,actor);
      if(policies.isEmpty())throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,"DATASET_ACCESS_DENIED","数据集尚未授权");
      var policy=policies.getFirst();var allowed=new LinkedHashSet<String>();models.tree(policy.get("columns_json")).forEach(f->allowed.add(f.asText()));
      rowPolicy=models.tree(policy.get("row_equals"));var used=new HashSet<>(allowed);rowPolicy.fieldNames().forEachRemaining(used::add);
      if(!fields.containsAll(used))conflict("POLICY_VERSION_MISMATCH");
      if(policy.get("field_types")!=null){JsonNode grantedTypes=models.tree(policy.get("field_types"));for(String name:used)if(grantedTypes.has(name)&&!grantedTypes.path(name).asText().equals(types.get(name)))conflict("POLICY_VERSION_MISMATCH");}
      fields.retainAll(allowed);policyRevision=((Number)policy.get("revision")).longValue();
    }
    var columns=new ArrayList<String>();
    if(request.has("columns")){
      if(!request.path("columns").isArray()||request.path("columns").isEmpty()||request.path("columns").size()>200)bad("INVALID_QUERY_COLUMNS");
      for(JsonNode column:request.path("columns")){if(!column.isTextual()||!fields.contains(column.asText())||columns.contains(column.asText()))bad("QUERY_COLUMN_NOT_ALLOWED");columns.add(column.asText());}
    }else columns.addAll(fields);
    long requestedLimit=request.path("limit").asLong(100),requestedOffset=request.path("offset").asLong(0);
    if(requestedLimit<1||requestedLimit>1000||requestedOffset<0||requestedOffset>100000)bad("INVALID_QUERY_LIMIT");int limit=(int)requestedLimit,offset=(int)requestedOffset;
    var where=new ArrayList<String>();var values=new ArrayList<Object>();
    if(rowPolicy!=null)equalPredicates(rowPolicy,types.keySet(),types,where,values);
    if(request.has("equals"))equalPredicates(request.path("equals"),fields,types,where,values);
    if(request.has("filters"))filters(request.path("filters"),fields,types,where,values);
    var order=new LinkedHashMap<String,String>();
    if(request.has("sort")){
      if(!request.path("sort").isArray()||request.path("sort").size()>5)bad("INVALID_QUERY_SORT");
      for(JsonNode item:request.path("sort")){String field=item.path("field").asText(),direction=item.path("direction").asText();if(!fields.contains(field)||types.get(field).equals("jsonb")||!Set.of("ASC","DESC").contains(direction)||order.putIfAbsent(field,direction)!=null)bad("QUERY_SORT_NOT_ALLOWED");}
    }
    contract.path("uniqueKey").forEach(k->order.putIfAbsent(k.asText(),"ASC"));
    String sql="SELECT "+String.join(",",columns.stream().map(c->quote(c)+"::text AS "+quote(c)).toList())+" FROM "+quote(record.get("schema_name").toString())+"."+quote(contract.path("output").asText());
    if(!where.isEmpty())sql+=" WHERE "+String.join(" AND ",where);
    sql+=" ORDER BY "+String.join(",",order.entrySet().stream().map(e->quote(e.getKey())+" "+e.getValue()+" NULLS LAST").toList())+" LIMIT ? OFFSET ?";values.add(limit+1);values.add(offset);
    jdbc.execute("SET LOCAL statement_timeout = '5s'");var rows=jdbc.queryForList(sql,values.toArray());boolean more=rows.size()>limit;if(more)rows.removeLast();
    var result=new LinkedHashMap<String,Object>();result.put("datasetId",dataset);result.put("releaseId",release);result.put("modelVersion",record.get("model_version"));result.put("policyRevision",policyRevision);result.put("columns",columns);result.put("rows",rows);result.put("offset",offset);result.put("limit",limit);result.put("hasMore",more);result.put("scalarEncoding","sql-text-v1");result.put("freshness",freshness.describe(dataset,release));return result;
  }
  private static LinkedHashMap<String,String> types(JsonNode contract){var types=new LinkedHashMap<String,String>();contract.path("fields").forEach(f->types.put(f.path("name").asText(),f.path("type").asText()));return types;}
  private static void equalPredicates(JsonNode object,Set<String> allowed,Map<String,String> types,List<String> where,List<Object> values){
    if(!object.isObject()||object.size()>32)bad("INVALID_QUERY_FILTER");object.fields().forEachRemaining(e->{String name=e.getKey();if(!allowed.contains(name))bad("QUERY_FILTER_NOT_ALLOWED");if(e.getValue().isNull())where.add(quote(name)+" IS NULL");else{where.add(quote(name)+"=CAST(? AS "+types.get(name)+")");values.add(typed(e.getValue(),types.get(name)));}});
  }
  private static void filters(JsonNode filters,Set<String> allowed,Map<String,String> types,List<String> where,List<Object> values){
    if(!filters.isArray()||filters.size()>32)bad("INVALID_QUERY_FILTER");
    for(JsonNode filter:filters){String field=filter.path("field").asText(),op=filter.path("op").asText();if(!allowed.contains(field))bad("QUERY_FILTER_NOT_ALLOWED");String type=types.get(field),column=quote(field),cast="CAST(? AS "+type+")";
      if(op.equals("IN")){
        JsonNode items=filter.path("values");if(!items.isArray()||items.isEmpty()||items.size()>100)bad("INVALID_QUERY_SET");
        var terms=new ArrayList<String>();boolean hasNull=false;for(JsonNode value:items){if(value.isNull()){hasNull=true;continue;}values.add(typed(value,type));terms.add(cast);}
        String term=terms.isEmpty()?"FALSE":column+" IN ("+String.join(",",terms)+")";where.add("("+term+(hasNull?" OR "+column+" IS NULL":"")+")");
      }else if(Set.of("EQ","NE","GT","GTE","LT","LTE").contains(op)){
        if(filter.path("value").isNull()){if(!Set.of("EQ","NE").contains(op))bad("NULL_RANGE_NOT_ALLOWED");where.add(column+(op.equals("EQ")?" IS NULL":" IS NOT NULL"));continue;}
        if(Set.of("GT","GTE","LT","LTE").contains(op)&&Set.of("jsonb","boolean").contains(type))bad("QUERY_RANGE_TYPE_NOT_ALLOWED");
        String operator=switch(op){case "EQ"->"=";case "NE"->"<>";case "GT"->">";case "GTE"->">=";case "LT"->"<";default->"<=";};where.add(column+operator+cast);values.add(typed(filter.path("value"),type));
      }else bad("UNSUPPORTED_QUERY_OPERATOR");
    }
  }
  private static String typed(JsonNode value,String type){
    if(value.isMissingNode()||!value.isValueNode()||value.isNull()||value.asText().length()>1000)bad("INVALID_TYPED_VALUE");String text=value.asText();
    try{
      if(type.equals("integer"))Integer.parseInt(text);else if(type.equals("bigint"))Long.parseLong(text);else if(type.startsWith("numeric(")){
        BigDecimal number=new BigDecimal(text);var spec=type.substring(8,type.length()-1).split(",");int precision=Integer.parseInt(spec[0]),scale=Integer.parseInt(spec[1]);
        if(number.scale()>scale||number.precision()-number.scale()>precision-scale)bad("NUMERIC_VALUE_OUT_OF_RANGE");
      }else if(type.equals("boolean")&&!Set.of("true","false").contains(text))bad("INVALID_TYPED_VALUE");
      else if(type.equals("date"))LocalDate.parse(text);else if(type.equals("timestamp"))LocalDateTime.parse(text.replace(' ','T'));else if(type.equals("timestamptz"))OffsetDateTime.parse(text.replace(' ','T'));
      else if(type.equals("jsonb")){new ObjectMapper().readTree(text);}
    }catch(Exception e){if(e instanceof ApiException api)throw api;bad("INVALID_TYPED_VALUE");}
    return text;
  }
}
