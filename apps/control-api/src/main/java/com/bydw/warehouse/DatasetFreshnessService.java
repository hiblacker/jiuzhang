package com.bydw.warehouse;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
@Service
public class DatasetFreshnessService {
  private final JdbcTemplate jdbc;private final ModelService models;
  public DatasetFreshnessService(JdbcTemplate jdbc,ModelService models){this.jdbc=jdbc;this.models=models;}
  public Map<String,Object> describe(long dataset,Long release){
    var result=new LinkedHashMap<String,Object>();result.put("queryableVersionExists",release!=null);
    var plans=jdbc.queryForList("SELECT v.config,p.state FROM warehouse.refresh_plan p JOIN warehouse.refresh_plan_version v ON v.plan_id=p.id AND v.version=p.active_version WHERE p.dataset_id=?",dataset);
    Long threshold=plans.isEmpty()?null:models.tree(plans.getFirst().get("config")).path("freshnessSeconds").asLong();
    result.put("freshnessSeconds",threshold);result.put("refreshPlanState",plans.isEmpty()?"NOT_CONFIGURED":plans.getFirst().get("state"));
    var tasks=jdbc.queryForList("SELECT w.state,w.reason,w.business_date FROM warehouse.refresh_window w JOIN warehouse.refresh_plan p ON p.id=w.plan_id WHERE p.dataset_id=? AND p.active_version=w.plan_version ORDER BY w.business_date DESC LIMIT 1",dataset);
    result.put("currentTask",tasks.isEmpty()?Map.of("state","NOT_CONFIGURED"):tasks.getFirst());
    if(release==null){result.put("state","UNPUBLISHED");result.put("inputs",java.util.List.of());return result;}
    var rows=jdbc.queryForList("SELECT b.watermark,b.result,r.model_version FROM warehouse.dataset_release r JOIN warehouse.model_build b ON b.id=r.build_id WHERE r.id=? AND r.dataset_id=?",release,dataset);
    if(rows.isEmpty()){result.put("state","UNKNOWN");return result;}
    var row=rows.getFirst();JsonNode marks=models.tree(row.get("watermark"));Instant oldest=null;
    for(JsonNode mark:marks){Instant at=Instant.parse(mark.path("at").asText());if(oldest==null||at.isBefore(oldest))oldest=at;}
    result.put("inputs",marks);result.put("dataAsOf",oldest==null?null:oldest.toString());result.put("modelVersion",row.get("model_version"));
    result.put("quality",row.get("result")==null?null:models.tree(row.get("result")));
    result.put("state",threshold==null?"NOT_CONFIGURED":oldest==null?"UNKNOWN":oldest.plusSeconds(threshold).isBefore(Instant.now())?"STALE":"FRESH");
    return result;
  }
}
