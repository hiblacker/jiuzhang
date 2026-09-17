package com.bydw.api;

import com.bydw.warehouse.ProductAccessService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
public class BrowserAccountController {
  private final BrowserAccountService accounts;
  private final ProductAccessService access;
  public BrowserAccountController(BrowserAccountService accounts, ProductAccessService access) {this.accounts=accounts;this.access=access;}
  public record Invitation(String identity,String displayName,Long projectId,String role,boolean platformAdmin) {}
  public record Activation(String invitation,String password) {}
  @GetMapping("/api/v1/auth/csrf") public Object csrf(CsrfToken token) { return Map.of("headerName",token.getHeaderName(),"token",token.getToken()); }
  @PostMapping("/api/v1/auth/activate") public Object activate(@RequestBody Activation body) { accounts.activate(body.invitation(),body.password());return Map.of("activated",true); }
  @GetMapping("/api/v1/warehouse/me") public Object me(HttpServletRequest request) {
    String actor=actor(request);return Map.of("identity",actor,"platformAdmin",access.admin(actor),"projects",access.projects(actor));
  }
  @PostMapping("/api/v1/warehouse/accounts/invite") public Object invite(@RequestBody Invitation body,HttpServletRequest request) {
    return accounts.invite(body.identity(),body.displayName(),body.projectId(),body.role(),body.platformAdmin(),actor(request));
  }
  @PostMapping("/api/v1/warehouse/accounts/{id}/reset") public Object reset(@PathVariable String id,HttpServletRequest request) {return accounts.reset(id,actor(request));}
  @PostMapping("/api/v1/warehouse/accounts/{id}/revoke-sessions") public Object revoke(@PathVariable String id,HttpServletRequest request) {accounts.revokeSessions(id,actor(request));return Map.of("revoked",true);}
  private String actor(HttpServletRequest request) {return (String)request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
