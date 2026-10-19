package cn.jiuzhang.api;

import cn.jiuzhang.platform.source.application.SourceService;
import cn.jiuzhang.platform.source.application.SourceStore;
import cn.jiuzhang.platform.shared.application.Failure;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/sources")
public class SourceController {
    private final SourceService service;
    public SourceController(SourceService service){this.service=service;}
    @GetMapping Object list(HttpServletRequest r){
        var rows=service.list(SessionFilter.session(r).user()).stream()
            .filter(x->r.getParameter("q")==null||r.getParameter("q").isBlank()||(x.name()+x.owner()+x.tags()).toLowerCase().contains(r.getParameter("q").toLowerCase()))
            .filter(x->r.getParameter("type")==null||r.getParameter("type").isBlank()||r.getParameter("type").equals("MySQL"))
            .filter(x->r.getParameter("status")==null||r.getParameter("status").isBlank()||x.status().equals(r.getParameter("status")))
            .map(this::data).toList();return HttpSupport.page(rows,r);
    }
    @GetMapping("/{id}") Object get(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(data(service.get(SessionFilter.session(r).user(),id)),r);}
    @PostMapping @ResponseStatus(HttpStatus.CREATED) Object create(@RequestBody Map<String,Object> input,HttpServletRequest r){return HttpSupport.ok(data(service.save(SessionFilter.session(r).user(),null,draft(input,null),HttpSupport.requestId(r))),r);}
    @PatchMapping("/{id}") Object patch(@PathVariable String id,@RequestBody Map<String,Object> input,HttpServletRequest r){
        var old=service.get(SessionFilter.session(r).user(),id);return HttpSupport.ok(data(service.save(SessionFilter.session(r).user(),id,draft(input,old),HttpSupport.requestId(r))),r);
    }
    @DeleteMapping("/{id}") Object delete(@PathVariable String id,HttpServletRequest r){service.delete(SessionFilter.session(r).user(),id,HttpSupport.requestId(r));return HttpSupport.ok(Map.of("message","OK"),r);}
    @PostMapping("/test") Object test(@RequestBody Map<String,Object> input,HttpServletRequest r){return HttpSupport.ok(service.test(SessionFilter.session(r).user(),draft(input,null),HttpSupport.string(input,"credentialSourceId",false),HttpSupport.requestId(r)),r);}
    @PostMapping("/{id}/test") Object test(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.testSaved(SessionFilter.session(r).user(),id,HttpSupport.requestId(r)),r);}
    @GetMapping("/{id}/objects") Object objects(@PathVariable String id,HttpServletRequest r){return HttpSupport.ok(service.discover(SessionFilter.session(r).user(),id).stream().map(this::object).toList(),r);}
    @GetMapping("/{id}/objects/{objectId}/fields") Object fields(@PathVariable String id,@PathVariable String objectId,HttpServletRequest r){return HttpSupport.ok(service.object(SessionFilter.session(r).user(),id,objectId).columns().stream().map(SourceService::field).toList(),r);}
    @PostMapping("/{id}/preview") Object preview(@PathVariable String id,@RequestBody Map<String,Object> input,HttpServletRequest r){HttpSupport.fields(input,"objectId");return HttpSupport.ok(service.preview(SessionFilter.session(r).user(),id,HttpSupport.string(input,"objectId",true)),r);}
    private Map<String,Object> object(SourceStore.SourceObject x){return Map.of("id",x.id(),"sourceId",x.sourceId(),"name",x.name(),"rowCount","0","rowCountKnown",false,"fields",x.columns().stream().map(SourceService::field).toList());}
    private Map<String,Object> data(SourceStore.Source s){var m=new LinkedHashMap<String,Object>();m.put("id",s.id());m.put("name",s.name());m.put("description",s.description());m.put("owner",s.owner());m.put("tags",s.tags());m.put("updatedAt",s.updatedAt());m.put("type","MySQL");m.put("settings",s.settings());m.put("status",s.status());m.put("objectCount",s.objectCount());m.put("connectionUsername",s.username());m.put("credentialConfigured",true);return m;}
    @SuppressWarnings("unchecked")
    private SourceService.Draft draft(Map<String,Object> input,SourceStore.Source old){
        HttpSupport.fields(input,"name","description","owner","tags","type","settings","credentials","credentialSourceId");
        var merged=new LinkedHashMap<String,Object>();if(old!=null)merged.putAll(data(old));merged.putAll(input);
        if(!(merged.get("tags") instanceof List<?> tags)||tags.stream().anyMatch(x->!(x instanceof String))||!(merged.get("settings") instanceof Map<?,?>))throw new Failure(422,"VALIDATION_ERROR");
        SourceService.Credentials credentials=null;
        if(input.containsKey("credentials")){
            if(!(input.get("credentials") instanceof Map<?,?>))throw new Failure(422,"VALIDATION_ERROR");
            Map<String,Object> c=(Map<String,Object>)input.get("credentials");HttpSupport.fields(c,"username","password");credentials=new SourceService.Credentials(HttpSupport.string(c,"username",true),HttpSupport.string(c,"password",true));
        }
        return new SourceService.Draft(HttpSupport.string(merged,"name",true),HttpSupport.string(merged,"description",true),HttpSupport.string(merged,"owner",true),(List<String>)merged.get("tags"),HttpSupport.string(merged,"type",true),(Map<String,Object>)merged.get("settings"),credentials);
    }
}
