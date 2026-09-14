package com.bydw.source;

import com.bydw.api.ApiException;
import com.bydw.api.RequestAuthenticationFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/sources")
public class SourceController {
  private final SourceService service;

  public SourceController(SourceService service) { this.service = service; }

  @PostMapping
  public ResponseEntity<SourceConnection> create(
      @RequestBody CreateSourceRequest request, HttpServletRequest httpRequest) {
    SourceConnection source = service.create(request, principal(httpRequest));
    return ResponseEntity.created(URI.create("/api/v1/sources/" + source.id())).body(source);
  }

  @GetMapping
  public SourcePage list(
      @RequestParam(defaultValue = "50") int limit,
      @RequestParam(defaultValue = "0") int offset,
      HttpServletRequest request) {
    return service.list(limit, offset, principal(request));
  }

  @GetMapping("/{id}")
  public SourceConnection find(@PathVariable long id, HttpServletRequest request) {
    return service.find(id, principal(request));
  }

  private String principal(HttpServletRequest request) {
    Object value = request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);
    if (value instanceof String principal) return principal;
    throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authenticated principal required");
  }
}
