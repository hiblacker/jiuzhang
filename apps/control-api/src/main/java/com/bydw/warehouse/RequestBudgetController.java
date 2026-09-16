package com.bydw.warehouse;
import com.bydw.api.RequestAuthenticationFilter;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
@RestController
public class RequestBudgetController{
  private final ManagedRuntimeService service;
  public RequestBudgetController(ManagedRuntimeService service){this.service=service;}
  @PostMapping("/api/v1/lake/request-budget") public Object budget(@RequestBody JsonNode body,HttpServletRequest request){return service.requestBudget(body,(String)request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE));}
}
