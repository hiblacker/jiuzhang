package com.bydw.lake;

import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/lake")
public class LakeExecutionController {
  private final LakeExecutionService service;
  private final com.bydw.warehouse.SystemDeliveryService delivery;
  public LakeExecutionController(LakeExecutionService service,com.bydw.warehouse.SystemDeliveryService delivery) { this.service = service;this.delivery=delivery; }
  @GetMapping("/plans") public List<Map<String, Object>> plans() { return service.plans(); }
  @PostMapping("/plans") public Map<String, Object> plan(@RequestBody LakePlanRequest body, HttpServletRequest request) { return service.savePlan(body, actor(request)); }
  @PostMapping("/plans/{id}/state") public Map<String, Object> state(@PathVariable long id, @RequestBody State body, HttpServletRequest request) {
    service.setState(id, body.state(), actor(request)); return Map.of("id", id, "state", body.state());
  }
  @PostMapping("/plans/{id}/trigger") public Map<String, Object> trigger(@PathVariable long id, @RequestBody Trigger body, HttpServletRequest request) {
    return service.trigger(id, body.day(), body.revision(), body.reason(), actor(request));
  }
  @PostMapping("/calendar/reconcile") public Map<String, Object> reconcile() { var result=new java.util.LinkedHashMap<String,Object>(service.reconcile(Instant.now()));result.put("systemDelivery",delivery.reconcile(Instant.now()));return result; }
  @GetMapping("/windows") public List<Map<String, Object>> windows(@RequestParam(required = false) Long planId) { return service.windows(planId); }
  @GetMapping("/executions") public List<Map<String, Object>> attempts(@RequestParam(required = false) Long planId) { return service.attempts(planId); }
  @PostMapping("/executions/claim") public Map<String, Object> claim(@RequestBody Capabilities body, HttpServletRequest request) { return service.claim(actor(request), body.runtimeRefs()); }
  @PostMapping("/executions/{id}/heartbeat") public Map<String, Object> heartbeat(@PathVariable long id, @RequestBody Lease body, HttpServletRequest request) { return service.heartbeat(id, body.leaseToken(), actor(request)); }
  @PostMapping("/executions/{id}/finish") public Map<String, Object> finish(@PathVariable long id, @RequestBody Completion body, HttpServletRequest request) {
    return service.finish(id, body.leaseToken(), actor(request), body.state(), body.errorCode(), body.result(), body.manifest());
  }
  @PostMapping("/executions/{id}/cancel") public Map<String, Object> cancel(@PathVariable long id, HttpServletRequest request) { service.cancel(id, actor(request)); return Map.of("id", id, "cancelRequested", true); }
  @PostMapping("/executions/{id}/retry") public Map<String, Object> retry(@PathVariable long id, HttpServletRequest request) { return service.retry(id, actor(request)); }
  @PostMapping("/executions/{id}/reprocess") public Map<String, Object> reprocess(@PathVariable long id, HttpServletRequest request) { return service.reprocess(id, actor(request)); }
  @PostMapping("/executions/{id}/approve-schema") public Map<String, Object> approveSchema(@PathVariable long id, @RequestBody SchemaReview body, HttpServletRequest request) { return service.approveSchema(id, body.reason(), actor(request)); }
  public record SchemaReview(String reason) {}
  private String actor(HttpServletRequest request) { return (String) request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE); }
  public record State(String state) {}
  public record Capabilities(List<String> runtimeRefs) {}
  public record Trigger(LocalDate day, boolean revision, String reason) {}
  public record Lease(UUID leaseToken) {}
  public record Completion(UUID leaseToken, String state, String errorCode, JsonNode result, RegisterManifestRequest manifest) {}
}
