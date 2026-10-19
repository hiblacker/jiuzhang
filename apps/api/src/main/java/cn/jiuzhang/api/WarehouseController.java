package cn.jiuzhang.api;
import cn.jiuzhang.platform.warehouse.application.WarehouseService;
import cn.jiuzhang.platform.shared.application.Failure;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1")
public class WarehouseController{
 private final WarehouseService service;public WarehouseController(WarehouseService service){this.service=service;}
 @GetMapping("/warehouse/tables") Object tables(HttpServletRequest r){var rows=service.tables(SessionFilter.session(r).user()).stream().filter(x->matches(x,"layer",r)).filter(x->matches(x,"subjectDomain",r)).filter(x->matches(x,"datasetId",r)).filter(x->r.getParameter("q")==null||r.getParameter("q").isEmpty()||x.get("name").toString().contains(r.getParameter("q"))).toList();return HttpSupport.page(rows,r);}
 @GetMapping("/warehouse/tables/{id}") Object table(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.table(SessionFilter.session(r).user(),id),r);}
 @GetMapping("/warehouse/metrics") Object metrics(HttpServletRequest r){return HttpSupport.ok(service.metrics(SessionFilter.session(r).user(),r.getParameter("tableId")),r);}
 @GetMapping("/warehouse/subject-domains") Object domains(HttpServletRequest r){return HttpSupport.ok(service.tables(SessionFilter.session(r).user()).stream().map(x->x.get("subjectDomain")).filter(x->!x.equals("")).distinct().sorted().toList(),r);}
 @PostMapping("/queries") @ResponseStatus(HttpStatus.CREATED) Object query(@RequestBody Map<String,Object>b,HttpServletRequest r){HttpSupport.fields(b,"sql");return HttpSupport.ok(service.query(SessionFilter.session(r).user(),HttpSupport.string(b,"sql",true),r.getHeader("Idempotency-Key"),HttpSupport.requestId(r)),r);}
 @GetMapping("/queries") Object queries(HttpServletRequest r){return HttpSupport.page(service.queries(SessionFilter.session(r).user()),r);}
 @GetMapping("/queries/{id}") Object query(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.query(SessionFilter.session(r).user(),id),r);}
 @PostMapping("/queries/{id}/cancel") Object cancel(@PathVariable String id,HttpServletRequest r){service.query(SessionFilter.session(r).user(),id);throw new Failure(409,"QUERY_ALREADY_FINISHED");}
 @PostMapping("/exports") @ResponseStatus(HttpStatus.CREATED) Object export(@RequestBody Map<String,Object>b,HttpServletRequest r){HttpSupport.fields(b,"queryId","format");return HttpSupport.ok(service.export(SessionFilter.session(r).user(),HttpSupport.string(b,"queryId",true),HttpSupport.string(b,"format",true),r.getHeader("Idempotency-Key"),HttpSupport.requestId(r)),r);}
 @GetMapping("/exports") Object exports(HttpServletRequest r){return HttpSupport.page(service.exports(SessionFilter.session(r).user()),r);}
 @GetMapping("/exports/{id}") Object export(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.export(SessionFilter.session(r).user(),id),r);}
 private boolean matches(Map<String,Object>x,String key,HttpServletRequest r){return r.getParameter(key)==null||r.getParameter(key).isEmpty()||r.getParameter(key).equals(x.get(key));}
}
