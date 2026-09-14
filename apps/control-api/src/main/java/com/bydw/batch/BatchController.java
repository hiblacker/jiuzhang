package com.bydw.batch;

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
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BatchController {
  private final BatchService service;

  public BatchController(BatchService service) { this.service = service; }

  @PostMapping("/api/v1/ingestion-jobs/{jobId}/batches")
  public ResponseEntity<IngestionBatch> start(@PathVariable long jobId,
      @RequestBody StartBatchRequest request, HttpServletRequest httpRequest) {
    IngestionBatch batch = service.start(jobId, request, principal(httpRequest));
    return ResponseEntity.created(URI.create("/api/v1/ingestion-batches/" + batch.id())).body(batch);
  }

  @PostMapping("/api/v1/ingestion-batches/{batchId}/complete")
  public ResponseEntity<IngestionBatch> complete(@PathVariable long batchId,
      @RequestBody CompleteBatchRequest request, HttpServletRequest httpRequest) {
    IngestionBatch batch = service.complete(batchId, request, principal(httpRequest));
    return ResponseEntity.status("STALE".equals(batch.state()) ? HttpStatus.CONFLICT : HttpStatus.OK)
        .body(batch);
  }

  @PostMapping("/api/v1/ingestion-batches/{batchId}/fail")
  public IngestionBatch fail(@PathVariable long batchId,
      @RequestBody FailBatchRequest request, HttpServletRequest httpRequest) {
    return service.fail(batchId, request, principal(httpRequest));
  }

  @GetMapping("/api/v1/ingestion-jobs/{jobId}/checkpoint")
  public CheckpointView checkpoint(@PathVariable long jobId, HttpServletRequest request) {
    return service.checkpoint(jobId, principal(request));
  }

  private String principal(HttpServletRequest request) {
    Object value = request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);
    if (value instanceof String principal) return principal;
    throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authenticated principal required");
  }
}
