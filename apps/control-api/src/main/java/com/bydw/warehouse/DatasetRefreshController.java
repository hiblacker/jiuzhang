package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/warehouse/projects/{project}/datasets/{dataset}/refresh")
public class DatasetRefreshController {
  private final DatasetRefreshService service;
  public DatasetRefreshController(DatasetRefreshService service){this.service=service;}
  @GetMapping public Object detail(@PathVariable long project,@PathVariable long dataset,HttpServletRequest r){return service.detail(project,dataset,actor(r));}
  @PostMapping public Object save(@PathVariable long project,@PathVariable long dataset,@RequestBody JsonNode b,HttpServletRequest r){return service.save(project,dataset,b,actor(r));}
  @PostMapping("/state")public Object state(@PathVariable long project,@PathVariable long dataset,@RequestBody JsonNode b,HttpServletRequest r){return service.state(project,dataset,b,actor(r));}
  @PostMapping("/reconcile")public Object reconcile(@PathVariable long project,@PathVariable long dataset,@RequestBody JsonNode b,HttpServletRequest r){return service.reconcileUser(project,dataset,b,actor(r));}
  @GetMapping("/windows")public Object windows(@PathVariable long project,@PathVariable long dataset,@RequestParam(defaultValue="25")int limit,@RequestParam(defaultValue="0")int offset,HttpServletRequest r){return service.windows(project,dataset,actor(r),limit,offset);}
  @PostMapping("/windows/{window}/retry")public Object retry(@PathVariable long project,@PathVariable long dataset,@PathVariable long window,@RequestBody JsonNode b,HttpServletRequest r){return service.retry(project,dataset,window,b,actor(r));}
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
