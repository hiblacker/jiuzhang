package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/warehouse/projects/{project}/ingestion-operations")
public class IngestionOperationsController{
  private final IngestionOperationsService service;
  public IngestionOperationsController(IngestionOperationsService service){this.service=service;}
  @GetMapping("/impact/{type}/{id}")public Object impact(@PathVariable long project,@PathVariable String type,@PathVariable long id,HttpServletRequest r){return service.impact(project,type,id,actor(r));}
  @PostMapping("/preview")public Object preview(@PathVariable long project,@RequestBody JsonNode b,HttpServletRequest r){return service.preview(project,b,actor(r));}
  @PostMapping("/{id}/execute")public Object execute(@PathVariable long project,@PathVariable UUID id,HttpServletRequest r){return service.execute(project,id,actor(r));}
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
