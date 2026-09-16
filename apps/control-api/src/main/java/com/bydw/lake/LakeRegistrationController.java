package com.bydw.lake;

import com.bydw.api.ApiException;
import com.bydw.api.RequestAuthenticationFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/lake")
public class LakeRegistrationController {
  private final LakeRegistrationService service;

  public LakeRegistrationController(LakeRegistrationService service) { this.service = service; }

  @PostMapping("/inventories")
  public ResponseEntity<LakeInventoryResponse> inventory(
      @RequestBody RegisterInventoryRequest request, HttpServletRequest httpRequest) {
    LakeInventoryResponse response = service.registerInventory(request, principal(httpRequest));
    return ResponseEntity.created(URI.create("/api/v1/lake/inventories/" + response.inventoryId())).body(response);
  }

  @PostMapping("/manifests")
  public ResponseEntity<LakeManifestResponse> manifest(
      @RequestBody RegisterManifestRequest request, HttpServletRequest httpRequest) {
    LakeManifestResponse response = service.registerManifest(request, principal(httpRequest));
    return ResponseEntity.created(URI.create("/api/v1/lake/runs/" + response.systemRunId())).body(response);
  }

  private String principal(HttpServletRequest request) {
    Object value = request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);
    if (value instanceof String principal) return principal;
    throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authenticated principal required");
  }
}
