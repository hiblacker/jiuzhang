package com.bydw.warehouse;

import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
public class ManagedIngestionController {
  private final ManagedIngestionService service;
  public ManagedIngestionController(ManagedIngestionService service){this.service=service;}
  @GetMapping("/api/v1/warehouse/environments") public Object environments(HttpServletRequest r){return service.environments(actor(r));}
  @PostMapping("/api/v1/warehouse/environments") public Object environment(@RequestBody JsonNode b,HttpServletRequest r){return service.environment(b,actor(r));}
  @PostMapping("/api/v1/warehouse/resources") public Object resource(@RequestBody JsonNode b,HttpServletRequest r){return service.resource(b,actor(r));}
  @PostMapping("/api/v1/warehouse/resources/{id}/grant") public Object grant(@PathVariable long id,@RequestBody JsonNode b,HttpServletRequest r){return service.grantResource(id,b,actor(r));}
  @GetMapping("/api/v1/warehouse/projects/{project}/resources") public Object resources(@PathVariable long project,HttpServletRequest r){return service.resources(project,actor(r));}
  @GetMapping("/api/v1/warehouse/projects/{project}/instances/{instance}/connections") public Object connections(@PathVariable long project,@PathVariable long instance,HttpServletRequest r){return service.connections(project,instance,actor(r));}
  @PostMapping("/api/v1/warehouse/projects/{project}/instances/{instance}/connections") public Object createConnection(@PathVariable long project,@PathVariable long instance,@RequestBody JsonNode b,HttpServletRequest r){return service.createConnection(project,instance,b,actor(r));}
  @GetMapping("/api/v1/warehouse/projects/{project}/connections/{connection}") public Object connection(@PathVariable long project,@PathVariable long connection,HttpServletRequest r){return service.connection(project,connection,actor(r),"ENGINEER");}
  @PostMapping("/api/v1/warehouse/projects/{project}/connections/{connection}/versions") public Object connectionVersion(@PathVariable long project,@PathVariable long connection,@RequestBody JsonNode b,HttpServletRequest r){return service.versionConnection(project,connection,b,actor(r));}
  @PostMapping("/api/v1/warehouse/projects/{project}/connections/{connection}/grant") public Object connectionGrant(@PathVariable long project,@PathVariable long connection,@RequestBody JsonNode b,HttpServletRequest r){return service.grantConnection(project,connection,b,actor(r));}
  @GetMapping("/api/v1/warehouse/projects/{project}/connections/{connection}/channels") public Object channels(@PathVariable long project,@PathVariable long connection,HttpServletRequest r){return service.channels(project,connection,actor(r));}
  @PostMapping("/api/v1/warehouse/projects/{project}/connections/{connection}/channels") public Object createChannel(@PathVariable long project,@PathVariable long connection,@RequestBody JsonNode b,HttpServletRequest r){return service.createChannel(project,connection,b,actor(r));}
  @GetMapping("/api/v1/warehouse/projects/{project}/channels/{source}") public Object channel(@PathVariable long project,@PathVariable long source,HttpServletRequest r){return service.channel(project,source,actor(r),"ENGINEER");}
  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/versions") public Object channelVersion(@PathVariable long project,@PathVariable long source,@RequestBody JsonNode b,HttpServletRequest r){return service.versionChannel(project,source,b,actor(r));}
  @GetMapping("/api/v1/warehouse/projects/{project}/channels/{source}/probes") public Object probes(@PathVariable long project,@PathVariable long source,HttpServletRequest r){return service.probes(project,source,actor(r));}
  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/probes") @ResponseStatus(HttpStatus.ACCEPTED)
  public Object probe(@PathVariable long project,@PathVariable long source,@RequestBody JsonNode b,HttpServletRequest r){return service.probe(project,source,b,actor(r));}
  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/activate") public Object activate(@PathVariable long project,@PathVariable long source,@RequestBody JsonNode b,HttpServletRequest r){return service.activate(project,source,b,actor(r));}
  @PostMapping("/api/v1/warehouse/projects/{project}/channels/{source}/trigger") public Object trigger(@PathVariable long project,@PathVariable long source,@RequestBody JsonNode b,HttpServletRequest r){return service.trigger(project,source,b,actor(r));}
  @PostMapping("/api/v1/lake/probes/claim") public Object claim(@RequestBody JsonNode b,HttpServletRequest r){return service.claimProbe(b.path("environment").asText(),actor(r));}
  @PostMapping("/api/v1/lake/probes/{id}/finish") public Object finish(@PathVariable long id,@RequestBody JsonNode b,HttpServletRequest r){return service.finishProbe(id,b,actor(r));}
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
