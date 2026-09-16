package com.bydw.warehouse;

import static com.bydw.warehouse.ModelService.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Rules operate on sealed relations and bind parameters; neither rule text nor client SQL is executed. */
@Service
public class QualityRuleService {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private static final Set<String> TYPES=Set.of("NOT_NULL","UNIQUE","ENUM","RANGE","REFERENCE","ROW_COUNT_CHANGE","FRESHNESS","TYPE");
  public QualityRuleService(JdbcTemplate jdbc,ObjectMapper json){this.jdbc=jdbc;this.json=json;}

  public void validate(JsonNode contract){
    if(!contract.has("qualityRules"))return;
    JsonNode rules=contract.path("qualityRules");
    if(!rules.isArray()||rules.size()>100)bad("INVALID_QUALITY_RULES");
    var fields=new HashMap<String,String>();contract.path("fields").forEach(f->fields.put(f.path("name").asText(),f.path("type").asText()));
    var ids=new HashSet<String>();
    for(JsonNode rule:rules){
      String type=rule.path("type").asText(),column=rule.path("column").asText();
      if(!rule.path("id").asText().matches("[A-Za-z][A-Za-z0-9_-]{0,63}")||!ids.add(rule.path("id").asText())||rule.path("version").asInt()<1
          ||!TYPES.contains(type)||!Set.of("BLOCK","WARN").contains(rule.path("severity").asText())||rule.path("description").asText().length()>500)bad("INVALID_QUALITY_RULE");
      if(!Set.of("ROW_COUNT_CHANGE","FRESHNESS").contains(type)&&!fields.containsKey(column))bad("QUALITY_FIELD_NOT_FOUND");
      if(type.equals("ENUM")){
        if(!rule.path("values").isArray()||rule.path("values").isEmpty()||rule.path("values").size()>100)bad("INVALID_ENUM_RULE");
        for(JsonNode value:rule.path("values"))if(!value.isValueNode()||value.isNull()||value.asText().length()>1000)bad("INVALID_ENUM_RULE");
      }
      if(type.equals("RANGE")){
        if(!Set.of("integer","bigint").contains(fields.get(column))&&!fields.get(column).startsWith("numeric("))bad("RANGE_REQUIRES_NUMERIC_FIELD");
        if(!rule.has("min")&&!rule.has("max"))bad("RANGE_BOUND_REQUIRED");
        if(rule.has("min"))number(rule.path("min"));if(rule.has("max"))number(rule.path("max"));
        if(rule.has("min")&&rule.has("max")&&number(rule.get("min")).compareTo(number(rule.get("max")))>0)bad("INVALID_RANGE_RULE");
      }
      if(type.equals("REFERENCE")){
        String alias=rule.path("inputAlias").asText(),inputColumn=rule.path("inputColumn").asText();boolean found=false;
        for(JsonNode input:contract.path("inputs"))if(input.path("alias").asText().equals(alias))for(JsonNode field:input.path("columns"))if(field.path("name").asText().equals(inputColumn)&&field.path("type").asText().equals(fields.get(column)))found=true;
        if(!found)bad("REFERENCE_TYPE_OR_FIELD_MISMATCH");
      }
      if(type.equals("TYPE")&&!fields.get(column).equals(rule.path("expectedType").asText()))bad("QUALITY_TYPE_CONTRACT_MISMATCH");
      if(type.equals("FRESHNESS")&&(rule.path("maxAgeSeconds").asLong()<1||rule.path("maxAgeSeconds").asLong()>31536000))bad("INVALID_FRESHNESS_RULE");
      if(type.equals("ROW_COUNT_CHANGE")){
        if(number(rule.path("maxChangeRatio")).signum()<0||number(rule.path("maxChangeRatio")).compareTo(BigDecimal.valueOf(100))>0)bad("INVALID_ROW_CHANGE_RULE");
        if(!Set.of("REQUIRE_BASELINE","ALLOW_FIRST").contains(rule.path("baselinePolicy").asText()))bad("ROW_CHANGE_BASELINE_REQUIRED");
      }
    }
  }
  public ArrayNode evaluate(JsonNode contract,Map<String,Object> build,long count){
    var results=json.createArrayNode();String schema=quote(build.get("schema_name").toString()),table=schema+"."+quote(contract.path("output").asText());
    for(JsonNode rule:contract.path("qualityRules")){
      String type=rule.path("type").asText(),column=rule.path("column").asText();long failures=0;boolean passed=true;Object measured=0L;String status="EVALUATED";
      switch(type){
        case "NOT_NULL" -> failures=jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE "+quote(column)+" IS NULL",Long.class);
        case "UNIQUE" -> failures=jdbc.queryForObject("SELECT count(*) FROM (SELECT "+quote(column)+" FROM "+table+" GROUP BY "+quote(column)+" HAVING count(*)>1) duplicate_groups",Long.class);
        case "ENUM" -> {
          var values=new ArrayList<String>();rule.path("values").forEach(v->values.add(v.asText()));
          failures=jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE "+quote(column)+" IS NOT NULL AND "+quote(column)+"::text NOT IN ("+String.join(",",Collections.nCopies(values.size(),"?"))+")",Long.class,values.toArray());
        }
        case "RANGE" -> {
          var terms=new ArrayList<String>();var values=new ArrayList<BigDecimal>();
          if(rule.has("min")){terms.add(quote(column)+" < ?");values.add(number(rule.get("min")));}
          if(rule.has("max")){terms.add(quote(column)+" > ?");values.add(number(rule.get("max")));}
          failures=jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE "+String.join(" OR ",terms),Long.class,values.toArray());
        }
        case "REFERENCE" -> failures=jdbc.queryForObject("SELECT count(*) FROM "+table+" output WHERE output."+quote(column)+" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "+schema+"."+quote("raw_"+rule.path("inputAlias").asText())+" input WHERE input."+quote(rule.path("inputColumn").asText())+"=output."+quote(column)+")",Long.class);
        case "TYPE" -> {measured=rule.path("expectedType").asText();}
        case "FRESHNESS" -> {
          Instant oldest=Instant.now();for(JsonNode mark:tree(build.get("watermark"))){Instant at=Instant.parse(mark.path("at").asText());if(at.isBefore(oldest))oldest=at;}
          measured=Math.max(0,java.time.Duration.between(oldest,Instant.now()).getSeconds());passed=((Long)measured)<=rule.path("maxAgeSeconds").asLong();
        }
        case "ROW_COUNT_CHANGE" -> {
          var previous=jdbc.queryForList("SELECT b.result->>'rowCount' AS count FROM warehouse.dataset d JOIN warehouse.dataset_release r ON r.id=d.active_release_id JOIN warehouse.model_build b ON b.id=r.build_id WHERE d.id=?",build.get("dataset_id"));
          if(previous.isEmpty()||previous.getFirst().get("count")==null){status="NO_BASELINE";measured=null;passed=rule.path("baselinePolicy").asText().equals("ALLOW_FIRST");}
          else{long before=Long.parseLong(previous.getFirst().get("count").toString());if(before==0){status="ZERO_BASELINE";measured=null;passed=count==0;}else{BigDecimal ratio=BigDecimal.valueOf(count).subtract(BigDecimal.valueOf(before)).abs().divide(BigDecimal.valueOf(before),12,java.math.RoundingMode.HALF_UP);measured=ratio.toPlainString();passed=ratio.compareTo(number(rule.path("maxChangeRatio")))<=0;}}
        }
        default -> bad("UNKNOWN_QUALITY_RULE");
      }
      if(Set.of("NOT_NULL","UNIQUE","ENUM","RANGE","REFERENCE").contains(type)){measured=failures;passed=failures==0;}
      var result=results.addObject().put("id",rule.path("id").asText()).put("version",rule.path("version").asInt()).put("type",type).put("severity",rule.path("severity").asText()).put("passed",passed).put("status",status).put("description",rule.path("description").asText());
      result.set("measured",json.valueToTree(measured));result.set("definition",rule); // No source rows are returned as samples.
    }
    return results;
  }
  public void checkPublicationPolicies(long dataset,JsonNode contract){
    var fields=new HashMap<String,String>();contract.path("fields").forEach(f->fields.put(f.path("name").asText(),f.path("type").asText()));
    for(var policy:jdbc.queryForList("SELECT columns_json,row_equals,field_types FROM warehouse.dataset_policy WHERE dataset_id=?",dataset)){
      var used=new HashSet<String>();tree(policy.get("columns_json")).forEach(c->used.add(c.asText()));tree(policy.get("row_equals")).fieldNames().forEachRemaining(used::add);
      JsonNode types=policy.get("field_types")==null?json.nullNode():tree(policy.get("field_types"));
      for(String name:used)if(!fields.containsKey(name)||(types.has(name)&&!types.path(name).asText().equals(fields.get(name))))conflict("POLICY_VERSION_MISMATCH");
    }
  }
  private JsonNode tree(Object value){try{return json.readTree(value.toString());}catch(Exception e){throw new IllegalStateException("INVALID_QUALITY_METADATA");}}
  private static BigDecimal number(JsonNode value){try{if(!value.isNumber()&&!value.isTextual()||value.asText().length()>100)bad("INVALID_QUALITY_NUMBER");return new BigDecimal(value.asText());}catch(NumberFormatException e){bad("INVALID_QUALITY_NUMBER");return BigDecimal.ZERO;}}
}
