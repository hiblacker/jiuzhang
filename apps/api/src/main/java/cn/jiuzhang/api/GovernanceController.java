package cn.jiuzhang.api;
import cn.jiuzhang.platform.dataset.application.DatasetService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/governance/{category:quality|masking}")
public class GovernanceController{
 private final DatasetService service;public GovernanceController(DatasetService service){this.service=service;}
 @GetMapping Object list(@PathVariable String category,HttpServletRequest r){return HttpSupport.page(service.rules(SessionFilter.session(r).user(),category),r);}
 @GetMapping("/{id}") Object get(@PathVariable String category,@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.rule(SessionFilter.session(r).user(),category,id),r);}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) Object create(@PathVariable String category,@RequestBody Map<String,Object>b,HttpServletRequest r){return HttpSupport.ok(service.saveRule(SessionFilter.session(r).user(),category,null,b,HttpSupport.requestId(r)),r);}
 @PatchMapping("/{id}") Object patch(@PathVariable String category,@PathVariable String id,@RequestBody Map<String,Object>b,HttpServletRequest r){return HttpSupport.ok(service.saveRule(SessionFilter.session(r).user(),category,id,b,HttpSupport.requestId(r)),r);}
 @DeleteMapping("/{id}") Object delete(@PathVariable String category,@PathVariable String id,HttpServletRequest r){service.deleteRule(SessionFilter.session(r).user(),category,id,HttpSupport.requestId(r));return HttpSupport.ok(Map.of("message","OK"),r);}
}
