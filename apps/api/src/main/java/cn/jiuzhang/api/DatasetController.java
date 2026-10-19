package cn.jiuzhang.api;
import cn.jiuzhang.platform.dataset.application.DatasetService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/datasets")
public class DatasetController{
 private final DatasetService service;public DatasetController(DatasetService service){this.service=service;}
 @GetMapping Object list(HttpServletRequest r){var q=r.getParameter("q");var status=r.getParameter("status");return HttpSupport.page(service.list(SessionFilter.session(r).user()).stream().filter(x->q==null||q.isBlank()||(x.get("name")+" "+x.get("owner")).toLowerCase().contains(q.toLowerCase())).filter(x->status==null||status.isEmpty()||status.equals(x.get("status"))).toList(),r);}
 @GetMapping("/{id}") Object get(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.get(SessionFilter.session(r).user(),id),r);}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) Object create(@RequestBody Map<String,Object>b,HttpServletRequest r){return HttpSupport.ok(service.save(SessionFilter.session(r).user(),null,b,HttpSupport.requestId(r)),r);}
 @PatchMapping("/{id}") Object patch(@PathVariable String id,@RequestBody Map<String,Object>b,HttpServletRequest r){return HttpSupport.ok(service.save(SessionFilter.session(r).user(),id,b,HttpSupport.requestId(r)),r);}
 @DeleteMapping("/{id}") Object delete(@PathVariable String id,HttpServletRequest r){service.delete(SessionFilter.session(r).user(),id,HttpSupport.requestId(r));return HttpSupport.ok(Map.of("message","OK"),r);}
 @PostMapping("/{id}/validate") Object validate(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.validate(SessionFilter.session(r).user(),id),r);}
 @PostMapping("/preview") Object preview(@RequestBody Map<String,Object>b,HttpServletRequest r){return HttpSupport.ok(service.preview(SessionFilter.session(r).user(),b),r);}
 @PostMapping("/{id}/preview") Object preview(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.preview(SessionFilter.session(r).user(),id),r);}
 @PostMapping("/{id}/publish") Object publish(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.publish(SessionFilter.session(r).user(),id,r.getHeader("Idempotency-Key"),HttpSupport.requestId(r)),r);}
 @GetMapping("/{id}/versions") Object versions(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.versions(SessionFilter.session(r).user(),id),r);}
 @GetMapping("/{id}/versions/{v}") Object version(@PathVariable String id,@PathVariable int v,HttpServletRequest r){return HttpSupport.ok(service.version(SessionFilter.session(r).user(),id,v),r);}
 @PostMapping("/{id}/versions/{v}/restore") Object restore(@PathVariable String id,@PathVariable int v,HttpServletRequest r){return HttpSupport.ok(service.restore(SessionFilter.session(r).user(),id,v,HttpSupport.requestId(r)),r);}
}
