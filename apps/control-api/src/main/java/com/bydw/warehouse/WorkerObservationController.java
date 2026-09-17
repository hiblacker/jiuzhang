package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
@RestController
public class WorkerObservationController {
  private final JdbcTemplate jdbc;private final ProductAccessService access;private final ObjectMapper json;
  public WorkerObservationController(JdbcTemplate jdbc,ProductAccessService access,ObjectMapper json){this.jdbc=jdbc;this.access=access;this.json=json;}
  @PostMapping("/api/v1/lake/environment-heartbeat") @Transactional public Object heartbeat(@RequestBody JsonNode body,HttpServletRequest request){
    String worker=(String)request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE),environment=body.path("environment").asText();
    var rows=jdbc.queryForList("SELECT worker_ids FROM warehouse.execution_environment WHERE code=? AND enabled",environment);
    if(rows.isEmpty())SystemCatalogService.denied();boolean allowed=false;
    try{for(JsonNode id:json.readTree(rows.getFirst().get("worker_ids").toString()))if(id.asText().equals(worker))allowed=true;}catch(Exception e){throw new IllegalStateException("INVALID_WORKER_REGISTRY");}
    if(!allowed)SystemCatalogService.denied();
    var metrics=json.createObjectNode();for(String key:new String[]{"availableBytes","totalBytes"}){
      String value=body.path(key).asText();if(!value.matches("[0-9]{1,20}"))SystemCatalogService.bad("INVALID_STORAGE_METRICS");metrics.put(key,value);
    }
    jdbc.update("INSERT INTO warehouse.worker_observation(environment_code,worker_id,protocol,metrics) VALUES (?,?,2,?::jsonb) ON CONFLICT(environment_code,worker_id) DO UPDATE SET metrics=EXCLUDED.metrics,last_seen_at=clock_timestamp()",environment,worker,metrics.toString());
    jdbc.update("UPDATE warehouse.execution_environment SET last_seen_at=clock_timestamp() WHERE code=?",environment);return Map.of("accepted",true);
  }
  @GetMapping("/api/v1/warehouse/workers") public Object list(HttpServletRequest request){
    access.requireAdmin((String)request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE));
    var rows=jdbc.queryForList("SELECT w.*,w.last_seen_at>clock_timestamp()-interval '90 seconds' AS online FROM warehouse.worker_observation w ORDER BY w.environment_code,w.worker_id");
    rows.forEach(r->{try{r.put("metrics",json.readTree(r.get("metrics").toString()));}catch(Exception e){throw new IllegalStateException("INVALID_WORKER_METRICS");}});return rows;
  }
}
