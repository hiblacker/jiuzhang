package com.bydw.batch;

import com.bydw.api.ApiException;
import com.bydw.ingestion.IngestionJob;
import com.bydw.ingestion.IngestionJobRepository;
import com.bydw.source.SourceRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Pattern;
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

  public BatchService(BatchRepository repository, IngestionJobRepository jobRepository,
      SourceRepository sourceRepository, ObjectMapper objectMapper) {
    this.repository = repository;
    this.jobRepository = jobRepository;
    this.sourceRepository = sourceRepository;
    this.objectMapper = objectMapper;
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
    IngestionBatch batch = repository.start(jobId, request.runKey(), json(cursorTo)).orElse(null);
    if (batch != null) {
      sourceRepository.audit(principal, "INGESTION_BATCH_START", "ingestion-batch/" + batch.id(),
          json(Map.of("jobId", jobId, "runKey", request.runKey(),
              "checkpointVersion", batch.checkpointVersion())));
      return batch;
    }
    IngestionBatch existing = repository.findByRunKey(jobId, request.runKey())
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
    boolean committed = repository.complete(batchId, jobId, request.expectedCheckpointVersion(),
        json(request.nextCheckpoint()), request.rowCount(), checksum);
    if (!committed) {
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
    if (!repository.fail(batchId, request.errorCode(), diagnosticRef)) {
      throw new ApiException(HttpStatus.CONFLICT, "BATCH_NOT_RUNNING", "Only a running batch can fail");
    }
    IngestionBatch failed = repository.find(batchId).orElseThrow(() -> notFound(batchId));
    sourceRepository.audit(principal, "INGESTION_BATCH_FAIL", "ingestion-batch/" + batchId,
        json(Map.of("jobId", failed.jobId(), "errorCode", request.errorCode())));
    return failed;
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
}
