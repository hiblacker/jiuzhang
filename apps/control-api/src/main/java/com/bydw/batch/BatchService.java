package com.bydw.batch;

import com.bydw.api.ApiException;
import com.bydw.ingestion.IngestionJob;
import com.bydw.ingestion.IngestionJobRepository;
import com.bydw.source.SourceRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BatchService {
  private static final Pattern RUN_KEY = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,119}");
  private static final Pattern CHECKSUM = Pattern.compile("[a-fA-F0-9]{64}");
  private static final Pattern ERROR_CODE = Pattern.compile("[A-Z][A-Z0-9_]{1,79}");
  private static final Pattern DIAGNOSTIC_REF = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}");
  private static final int MAX_JSON_BYTES = 16_384;

  private final BatchRepository repository;
  private final IngestionJobRepository jobRepository;
  private final SourceRepository sourceRepository;
  private final ObjectMapper objectMapper;
  private final int leaseSeconds;

  public BatchService(BatchRepository repository, IngestionJobRepository jobRepository,
      SourceRepository sourceRepository, ObjectMapper objectMapper,
      @Value("${bydw.ingestion.lease-duration-seconds:300}") int leaseSeconds) {
    if (leaseSeconds < 30 || leaseSeconds > 3600) {
      throw new IllegalArgumentException("Batch lease duration must be between 30 and 3600 seconds");
    }
    this.repository = repository;
    this.jobRepository = jobRepository;
    this.sourceRepository = sourceRepository;
    this.objectMapper = objectMapper;
    this.leaseSeconds = leaseSeconds;
  }

  @Transactional
  public IngestionBatch start(long jobId, StartBatchRequest request, String principal) {
    IngestionJob job = jobRepository.findById(jobId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
            "INGESTION_JOB_NOT_FOUND", "Ingestion job not found"));
    if (!"ACTIVE".equals(job.state())) {
      throw new ApiException(HttpStatus.CONFLICT, "INGESTION_JOB_DISABLED",
          "Disabled ingestion job cannot start a batch");
    }
    if (request == null || request.runKey() == null || !RUN_KEY.matcher(request.runKey()).matches()) {
      throw badRequest("INVALID_RUN_KEY", "runKey must be a stable identifier");
    }
    JsonNode cursorTo = request.cursorTo();
    if (cursorTo == null || !cursorTo.isObject() || cursorTo.isEmpty()) {
      throw badRequest("INVALID_CURSOR_TO", "cursorTo must be a non-empty object");
    }
    validateSize(cursorTo, "CURSOR_TO_TOO_LARGE");
    IngestionBatch batch = repository.start(
        jobId, request.runKey(), json(cursorTo), principal, leaseSeconds).orElse(null);
    if (batch != null) {
      sourceRepository.audit(principal, "INGESTION_BATCH_START", "ingestion-batch/" + batch.id(),
          json(Map.of("jobId", jobId, "runKey", request.runKey(),
              "checkpointVersion", batch.checkpointVersion())));
      return batch;
    }
    IngestionBatch existing = repository.findLatestByRunKey(jobId, request.runKey())
        .orElseThrow(() -> new IllegalStateException("Existing batch runKey was not readable"));
    if (!existing.cursorTo().equals(cursorTo)) {
      throw new ApiException(HttpStatus.CONFLICT, "BATCH_RUN_KEY_MISMATCH",
          "runKey already exists with a different upper bound");
    }
    sourceRepository.audit(principal, "INGESTION_BATCH_REPLAY", "ingestion-batch/" + existing.id(),
        json(Map.of("jobId", jobId, "runKey", request.runKey())));
    return existing;
  }

  @Transactional
  public IngestionBatch complete(long batchId, CompleteBatchRequest request, String principal) {
    IngestionBatch batch = repository.find(batchId).orElseThrow(() -> notFound(batchId));
    long jobId = batch.jobId();
    if (!"RUNNING".equals(batch.state())) {
      throw new ApiException(HttpStatus.CONFLICT, "BATCH_NOT_RUNNING", "Only a running batch can complete");
    }
    if (request == null || request.expectedCheckpointVersion() < 0 || request.rowCount() < 0
        || request.nextCheckpoint() == null || !request.nextCheckpoint().isObject()
        || request.nextCheckpoint().isEmpty()) {
      throw badRequest("INVALID_BATCH_RESULT", "Result requires a non-negative count and object checkpoint");
    }
    if (request.expectedCheckpointVersion() != batch.checkpointVersion()) {
      throw new ApiException(HttpStatus.CONFLICT, "BATCH_CHECKPOINT_VERSION_MISMATCH",
          "Expected checkpoint version does not match the batch input");
    }
    if (request.checksum() == null || !CHECKSUM.matcher(request.checksum()).matches()) {
      throw badRequest("INVALID_BATCH_CHECKSUM", "checksum must be a SHA-256 hexadecimal value");
    }
    validateSize(request.nextCheckpoint(), "CHECKPOINT_TOO_LARGE");
    String checksum = request.checksum().toLowerCase(java.util.Locale.ROOT);
    RawBatchEvidence evidence = repository.rawEvidence(batchId)
        .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "RAW_BATCH_NOT_SEALED",
            "RAW batch must be durably sealed before checkpoint commit"));
    if (evidence.rowCount() != request.rowCount() || !evidence.checksum().equals(checksum)
        || !evidence.writerPrincipal().equals(principal)) {
      throw new ApiException(HttpStatus.CONFLICT, "RAW_BATCH_EVIDENCE_MISMATCH",
          "Batch result does not match the sealed RAW manifest");
    }
    BatchCompletionResult result = repository.complete(batchId, jobId,
        request.expectedCheckpointVersion(), json(request.nextCheckpoint()), request.rowCount(),
        checksum, principal);
    if (result == BatchCompletionResult.LEASE_REJECTED) {
      throw leaseNotActive();
    }
    if (result == BatchCompletionResult.STALE) {
      IngestionBatch stale = repository.find(batchId)
          .orElseThrow(() -> new IllegalStateException("Stale batch disappeared"));
      sourceRepository.audit(principal, "INGESTION_BATCH_STALE", "ingestion-batch/" + batchId,
          json(Map.of("jobId", jobId, "expectedCheckpointVersion", request.expectedCheckpointVersion())));
      return stale;
    }
    IngestionBatch completed = repository.find(batchId)
        .orElseThrow(() -> new IllegalStateException("Completed batch disappeared"));
    sourceRepository.audit(principal, "INGESTION_BATCH_COMPLETE", "ingestion-batch/" + batchId,
        json(Map.of("jobId", jobId, "rowCount", request.rowCount(),
            "checkpointVersion", completed.checkpointVersion())));
    return completed;
  }

  @Transactional
  public IngestionBatch fail(long batchId, FailBatchRequest request, String principal) {
    if (request == null || request.errorCode() == null
        || !ERROR_CODE.matcher(request.errorCode()).matches()) {
      throw badRequest("INVALID_ERROR_CODE", "errorCode must be an uppercase stable identifier");
    }
    String diagnosticRef = request.diagnosticRef();
    if (diagnosticRef != null && !DIAGNOSTIC_REF.matcher(diagnosticRef).matches()) {
      throw badRequest("INVALID_DIAGNOSTIC_REF", "diagnosticRef must be a bounded opaque reference");
    }
    IngestionBatch current = repository.find(batchId).orElseThrow(() -> notFound(batchId));
    if (!"RUNNING".equals(current.state())) {
      throw new ApiException(HttpStatus.CONFLICT, "BATCH_NOT_RUNNING", "Only a running batch can fail");
    }
    if (!repository.fail(batchId, request.errorCode(), diagnosticRef, principal)) {
      throw leaseNotActive();
    }
    IngestionBatch failed = repository.find(batchId).orElseThrow(() -> notFound(batchId));
    sourceRepository.audit(principal, "INGESTION_BATCH_FAIL", "ingestion-batch/" + batchId,
        json(Map.of("jobId", failed.jobId(), "errorCode", request.errorCode())));
    return failed;
  }

  @Transactional
  public IngestionBatch retry(long batchId, String principal) {
    IngestionBatch batch = repository.find(batchId).orElseThrow(() -> notFound(batchId));
    if (!Set.of("FAILED", "CANCELLED").contains(batch.state())) {
      throw new ApiException(HttpStatus.CONFLICT, "BATCH_NOT_RETRYABLE",
          "Only a failed or cancelled batch can be retried");
    }
    IngestionBatch latest = repository.findLatestByRunKey(batch.jobId(), batch.runKey())
        .orElseThrow(() -> new IllegalStateException("Latest batch attempt was not readable"));
    if (latest.attempt() > batch.attempt()) return latest;
    IngestionBatch retried = repository.retry(batchId, principal, leaseSeconds).orElse(null);
    if (retried == null) {
      retried = repository.findLatestByRunKey(batch.jobId(), batch.runKey())
          .filter(candidate -> candidate.attempt() > batch.attempt())
          .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "BATCH_RETRY_CONFLICT",
              "A retry was created concurrently or the batch is no longer retryable"));
    }
    sourceRepository.audit(principal, "INGESTION_BATCH_RETRY", "ingestion-batch/" + batchId,
        json(Map.of("jobId", batch.jobId(), "runKey", batch.runKey(),
            "attempt", retried.attempt(), "retryBatchId", retried.id())));
    return retried;
  }

  @Transactional
  public IngestionBatch cancel(long batchId, String principal) {
    IngestionBatch batch = repository.find(batchId).orElseThrow(() -> notFound(batchId));
    if (!"RUNNING".equals(batch.state())) {
      throw new ApiException(HttpStatus.CONFLICT, "BATCH_NOT_RUNNING", "Only a running batch can cancel");
    }
    if (!repository.cancel(batchId, principal)) {
      throw leaseNotActive();
    }
    IngestionBatch cancelled = repository.find(batchId).orElseThrow(() -> notFound(batchId));
    sourceRepository.audit(principal, "INGESTION_BATCH_CANCEL", "ingestion-batch/" + batchId,
        json(Map.of("jobId", cancelled.jobId())));
    return cancelled;
  }

  @Transactional
  public IngestionBatch heartbeat(long batchId, String principal) {
    IngestionBatch renewed = repository.heartbeat(batchId, principal, leaseSeconds).orElse(null);
    if (renewed == null) {
      if (repository.find(batchId).isEmpty()) throw notFound(batchId);
      throw leaseNotActive();
    }
    sourceRepository.audit(principal, "INGESTION_BATCH_HEARTBEAT", "ingestion-batch/" + batchId,
        json(Map.of("leaseExpiresAt", renewed.leaseExpiresAt().toString())));
    return renewed;
  }

  @Transactional
  public BatchReconcileResult reconcileExpired(int limit, String principal) {
    if (limit < 1 || limit > 1000) {
      throw badRequest("INVALID_RECONCILE_LIMIT", "limit must be between 1 and 1000");
    }
    List<Long> batchIds = repository.reconcileExpired(limit);
    sourceRepository.audit(principal, "INGESTION_BATCH_RECONCILE", "ingestion-batches",
        json(Map.of("reconciledCount", batchIds.size(), "batchIds", batchIds)));
    return new BatchReconcileResult(batchIds.size(), List.copyOf(batchIds));
  }

  @Transactional
  public CheckpointView checkpoint(long jobId, String principal) {
    if (jobId < 1) throw badRequest("INVALID_INGESTION_JOB_ID", "Ingestion job id must be positive");
    try {
      CheckpointView checkpoint = repository.currentCheckpoint(jobId);
      sourceRepository.audit(principal, "INGESTION_CHECKPOINT_READ", "ingestion-job/" + jobId,
          json(Map.of("version", checkpoint.version())));
      return checkpoint;
    } catch (org.springframework.dao.EmptyResultDataAccessException exception) {
      throw new ApiException(HttpStatus.NOT_FOUND, "INGESTION_JOB_NOT_FOUND", "Ingestion job not found");
    }
  }

  private void validateSize(JsonNode node, String code) {
    if (!node.isObject() || json(node).getBytes(StandardCharsets.UTF_8).length > MAX_JSON_BYTES) {
      throw badRequest(code, "Cursor or checkpoint must be an object up to 16384 bytes");
    }
  }

  private String json(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw badRequest("INVALID_JSON", "Value cannot be serialized");
    }
  }

  private ApiException badRequest(String code, String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, code, message);
  }

  private ApiException notFound(long id) {
    return new ApiException(HttpStatus.NOT_FOUND, "BATCH_NOT_FOUND", "Batch not found: " + id);
  }

  private ApiException leaseNotActive() {
    return new ApiException(HttpStatus.CONFLICT, "BATCH_LEASE_NOT_ACTIVE",
        "An active lease owned by the calling worker is required");
  }
}
