package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/warehouse")
public class ModelPackageController {
  private final ModelPackageService service;
  public ModelPackageController(ModelPackageService service){this.service=service;}
  @PostMapping("/model-repositories")public Object register(@RequestBody JsonNode b,HttpServletRequest r){return service.register(b,actor(r));}
  @PostMapping("/model-repositories/{code}/grant")public Object grant(@PathVariable String code,@RequestBody JsonNode b,HttpServletRequest r){return service.grant(code,b,actor(r));}
  @GetMapping("/projects/{project}/model-repositories")public Object repositories(@PathVariable long project,HttpServletRequest r){return service.repositories(project,actor(r));}
  @PostMapping("/projects/{project}/model-packages")public Object submit(@PathVariable long project,@RequestBody JsonNode b,HttpServletRequest r){return service.submit(project,b,actor(r));}
  @GetMapping("/projects/{project}/model-packages")public Object list(@PathVariable long project,@RequestParam(defaultValue="25")int limit,@RequestParam(defaultValue="0")int offset,HttpServletRequest r){return service.list(project,actor(r),limit,offset);}
  @PostMapping("/model-packages/claim")public Object claim(@RequestBody Capabilities b,HttpServletRequest r){return service.claim(b.repositories(),actor(r));}
  @PostMapping("/model-packages/{id}/finish")public Object finish(@PathVariable long id,@RequestBody JsonNode b,HttpServletRequest r){return service.finish(id,b,actor(r));}
  public record Capabilities(List<String> repositories){}
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
