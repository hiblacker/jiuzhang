package cn.jiuzhang.api;
import cn.jiuzhang.platform.execution.application.RunService;
import cn.jiuzhang.platform.shared.application.Failure;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1")
public class RunController{
 private final RunService service;public RunController(RunService service){this.service=service;}
 @PostMapping("/datasets/{id}/runs") @ResponseStatus(HttpStatus.CREATED) Object start(@PathVariable String id,@RequestBody Map<String,Object>b,HttpServletRequest r){return HttpSupport.ok(service.start(SessionFilter.session(r).user(),id,allow(b),r.getHeader("Idempotency-Key"),null,HttpSupport.requestId(r)),r);}
 @GetMapping("/runs") Object list(HttpServletRequest r){var dataset=r.getParameter("datasetId");var status=r.getParameter("status");var quality=r.getParameter("qualityRuleId");return HttpSupport.page(service.list(SessionFilter.session(r).user()).stream().filter(x->dataset==null||dataset.isEmpty()||dataset.equals(x.get("datasetId"))).filter(x->status==null||status.isEmpty()||status.equals(x.get("status"))).filter(x->quality==null||quality.isEmpty()||x.get("qualityResults").toString().contains("ruleId="+quality+"," )).toList(),r);}
 @GetMapping("/runs/{id}") Object get(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.get(SessionFilter.session(r).user(),id),r);}
 @PostMapping("/runs/{id}/cancel") Object cancel(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.cancel(SessionFilter.session(r).user(),id,HttpSupport.requestId(r)),r);}
 @PostMapping("/runs/{id}/retry") @ResponseStatus(HttpStatus.CREATED) Object retry(@PathVariable String id,@RequestBody Map<String,Object>b,HttpServletRequest r){return HttpSupport.ok(service.retry(SessionFilter.session(r).user(),id,allow(b),r.getHeader("Idempotency-Key"),HttpSupport.requestId(r)),r);}
 private boolean allow(Map<String,Object>b){HttpSupport.fields(b,"allowEmptySnapshot");if(!b.containsKey("allowEmptySnapshot"))return false;if(!(b.get("allowEmptySnapshot") instanceof Boolean v))throw new Failure(422,"VALIDATION_ERROR");return v;}
}
