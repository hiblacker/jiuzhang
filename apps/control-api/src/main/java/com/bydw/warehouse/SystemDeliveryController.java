package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/warehouse/projects/{project}/instances/{instance}/delivery")
public class SystemDeliveryController{
  private final SystemDeliveryService service;
  public SystemDeliveryController(SystemDeliveryService service){this.service=service;}
  @GetMapping("/agreements")public Object agreements(@PathVariable long project,@PathVariable long instance,HttpServletRequest r){return service.agreements(project,instance,actor(r));}
  @PostMapping("/agreements")public Object save(@PathVariable long project,@PathVariable long instance,@RequestBody JsonNode body,HttpServletRequest r){return service.save(project,instance,body,actor(r));}
  @PostMapping("/check")public Object freeze(@PathVariable long project,@PathVariable long instance,@RequestBody JsonNode body,HttpServletRequest r){return service.freeze(project,instance,LocalDate.parse(body.path("day").asText()),actor(r));}
  @GetMapping public Object status(@PathVariable long project,@PathVariable long instance,@RequestParam LocalDate day,HttpServletRequest r){return service.status(project,instance,day,actor(r));}
  private String actor(HttpServletRequest r){return (String)r.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
