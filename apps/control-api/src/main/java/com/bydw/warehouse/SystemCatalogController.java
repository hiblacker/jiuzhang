package com.bydw.warehouse;

import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/warehouse/projects/{project}/systems")
public class SystemCatalogController {
  private final SystemCatalogService service;
  public SystemCatalogController(SystemCatalogService service){this.service=service;}
  @GetMapping public Object list(@PathVariable long project,@RequestParam(defaultValue="") String q,
      @RequestParam(defaultValue="") String environment,@RequestParam(defaultValue="") String lifecycle,
      @RequestParam(defaultValue="25") int limit,@RequestParam(defaultValue="0") int offset,HttpServletRequest r){return service.list(project,actor(r),q,environment,lifecycle,limit,offset);}
  @PostMapping public Object create(@PathVariable long project,@RequestBody JsonNode body,HttpServletRequest r){return service.create(project,body,actor(r));}
  @GetMapping("/{system}") public Object detail(@PathVariable long project,@PathVariable long system,HttpServletRequest r){return service.detail(project,system,actor(r));}
  @PostMapping("/{system}") public Object update(@PathVariable long project,@PathVariable long system,@RequestBody JsonNode body,HttpServletRequest r){return service.update(project,system,body,actor(r));}
  @PostMapping("/{system}/instances") public Object instance(@PathVariable long project,@PathVariable long system,@RequestBody JsonNode body,HttpServletRequest r){return service.instance(project,system,body,actor(r));}
  @PostMapping("/{system}/share") public Object share(@PathVariable long project,@PathVariable long system,@RequestBody JsonNode body,HttpServletRequest r){return service.share(project,system,body,actor(r));}
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
