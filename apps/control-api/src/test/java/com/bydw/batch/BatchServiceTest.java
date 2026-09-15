package com.bydw.batch;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.bydw.api.ApiException;
import com.bydw.ingestion.IngestionJob;
import com.bydw.ingestion.IngestionJobRepository;
import com.bydw.source.SourceRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class BatchServiceTest {
  @Mock BatchRepository repository;
  @Mock IngestionJobRepository jobRepository;
  @Mock SourceRepository sourceRepository;
  private ObjectMapper objectMapper;
  private BatchService service;

  @BeforeEach
  void setUp() {
    objectMapper = new ObjectMapper();
    service = new BatchService(repository, jobRepository, sourceRepository, objectMapper, 300);
  }

  @Test
  void startsFromServerCheckpointAndAudits() throws Exception {
    when(jobRepository.findById(2)).thenReturn(Optional.of(job("ACTIVE")));
    JsonNode cursorTo = objectMapper.readTree("{\"updatedAt\":\"2026-09-14T01:00:00Z\"}");
    IngestionBatch batch = batch(5, "RUNNING", 3);
    when(repository.start(2, "daily-001", cursorTo.toString(), "local-worker", 300))
        .thenReturn(Optional.of(batch));

    IngestionBatch result = service.start(2, new StartBatchRequest("daily-001", cursorTo), "local-worker");

    assertThat(result).isEqualTo(batch);
    verify(sourceRepository).audit(eq("local-worker"), eq("INGESTION_BATCH_START"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void replayReturnsExistingBatch() throws Exception {
    when(jobRepository.findById(2)).thenReturn(Optional.of(job("ACTIVE")));
    JsonNode cursorTo = objectMapper.readTree("{\"updatedAt\":\"2026-09-14T01:00:00Z\"}");
    IngestionBatch existing = new IngestionBatch(5, 2, "daily-001", 1,
        objectMapper.createObjectNode(), cursorTo, "RUNNING", 0, null, null, null, 3,
        OffsetDateTime.parse("2026-09-14T00:00:00Z"), null, null, "local-worker",
        OffsetDateTime.parse("2026-09-14T00:05:00Z"),
        OffsetDateTime.parse("2026-09-14T00:00:00Z"));
    when(repository.start(2, "daily-001", cursorTo.toString(), "local-worker", 300))
        .thenReturn(Optional.empty());
    when(repository.findLatestByRunKey(2, "daily-001")).thenReturn(Optional.of(existing));

    assertThat(service.start(2, new StartBatchRequest("daily-001", cursorTo), "local-worker"))
        .isEqualTo(existing);
    verify(sourceRepository).audit(eq("local-worker"), eq("INGESTION_BATCH_REPLAY"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void replayRejectsDifferentUpperBound() throws Exception {
    when(jobRepository.findById(2)).thenReturn(Optional.of(job("ACTIVE")));
    JsonNode requested = objectMapper.readTree("{\"id\":2}");
    IngestionBatch existing = new IngestionBatch(5, 2, "daily-001", 1,
        objectMapper.createObjectNode(), objectMapper.readTree("{\"id\":1}"), "RUNNING",
        0, null, null, null, 3, OffsetDateTime.parse("2026-09-14T00:00:00Z"), null, null,
        "local-worker", OffsetDateTime.parse("2026-09-14T00:05:00Z"),
        OffsetDateTime.parse("2026-09-14T00:00:00Z"));

    when(repository.start(2, "daily-001", requested.toString(), "local-worker", 300))
        .thenReturn(Optional.empty());
    when(repository.findLatestByRunKey(2, "daily-001")).thenReturn(Optional.of(existing));

    assertThatThrownBy(() -> service.start(2,
        new StartBatchRequest("daily-001", requested), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_RUN_KEY_MISMATCH"));
  }

  @Test
  void refusesDraftJobAndEmptyUpperBound() throws Exception {
    when(jobRepository.findById(2)).thenReturn(Optional.of(job("DRAFT")));
    assertThatThrownBy(() -> service.start(2,
        new StartBatchRequest("daily-001", objectMapper.createObjectNode()), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INGESTION_JOB_DISABLED"));

    when(jobRepository.findById(3)).thenReturn(Optional.of(job("ACTIVE")));
    assertThatThrownBy(() -> service.start(3,
        new StartBatchRequest("daily-002", objectMapper.createObjectNode()), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INVALID_CURSOR_TO"));
  }

  @Test
  void commitsOnlyCapturedCheckpointVersion() throws Exception {
    IngestionBatch running = batch(5, "RUNNING", 3);
    when(repository.find(5)).thenReturn(Optional.of(running), Optional.of(batch(5, "SUCCEEDED", 4)));
    JsonNode next = objectMapper.readTree("{\"updatedAt\":\"2026-09-14T01:00:00Z\",\"id\":99}");
    when(repository.rawEvidence(5)).thenReturn(Optional.of(evidence(12, "a".repeat(64))));
    when(repository.complete(5, 2, 3, next.toString(), 12, "a".repeat(64), "local-worker"))
        .thenReturn(BatchCompletionResult.COMPLETED);

    IngestionBatch completed = service.complete(5,
        new CompleteBatchRequest(3, next, 12, "A".repeat(64)), "local-worker");

    assertThat(completed.state()).isEqualTo("SUCCEEDED");
    verify(sourceRepository).audit(eq("local-worker"), eq("INGESTION_BATCH_COMPLETE"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void rejectsMismatchedAndStaleCheckpointVersions() throws Exception {
    IngestionBatch running = batch(5, "RUNNING", 3);
    JsonNode next = objectMapper.readTree("{\"id\":99}");
    when(repository.find(5)).thenReturn(Optional.of(running));
    assertThatThrownBy(() -> service.complete(5,
        new CompleteBatchRequest(2, next, 1, null), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_CHECKPOINT_VERSION_MISMATCH"));

    when(repository.complete(5, 2, 3, next.toString(), 1, "b".repeat(64), "local-worker"))
        .thenReturn(BatchCompletionResult.STALE);
    when(repository.rawEvidence(5)).thenReturn(Optional.of(evidence(1, "b".repeat(64))));
    when(repository.find(5)).thenReturn(Optional.of(running), Optional.of(batch(5, "STALE", 3)));
    assertThat(service.complete(5,
        new CompleteBatchRequest(3, next, 1, "b".repeat(64)), "local-worker").state())
        .isEqualTo("STALE");
    verify(sourceRepository).audit(eq("local-worker"), eq("INGESTION_BATCH_STALE"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void requiresMatchingSealedRawEvidence() throws Exception {
    IngestionBatch running = batch(5, "RUNNING", 3);
    JsonNode next = objectMapper.readTree("{\"id\":99}");
    when(repository.find(5)).thenReturn(Optional.of(running));
    when(repository.rawEvidence(5)).thenReturn(
        Optional.empty(), Optional.of(evidence(2, "c".repeat(64))));

    assertThatThrownBy(() -> service.complete(5,
        new CompleteBatchRequest(3, next, 2, "c".repeat(64)), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("RAW_BATCH_NOT_SEALED"));
    assertThatThrownBy(() -> service.complete(5,
        new CompleteBatchRequest(3, next, 3, "c".repeat(64)), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("RAW_BATCH_EVIDENCE_MISMATCH"));
  }

  @Test
  void requiresEvidenceFromCallingWorker() throws Exception {
    when(repository.find(5)).thenReturn(Optional.of(batch(5, "RUNNING", 3)));
    when(repository.rawEvidence(5)).thenReturn(Optional.of(new RawBatchEvidence(
        1, "d".repeat(64), "different-worker",
        OffsetDateTime.parse("2026-09-14T00:30:00Z"))));
    JsonNode next = objectMapper.readTree("{\"id\":99}");

    assertThatThrownBy(() -> service.complete(5,
        new CompleteBatchRequest(3, next, 1, "d".repeat(64)), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("RAW_BATCH_EVIDENCE_MISMATCH"));
  }

  @Test
  void requiresAResultChecksum() throws Exception {
    when(repository.find(5)).thenReturn(Optional.of(batch(5, "RUNNING", 3)));
    JsonNode next = objectMapper.readTree("{\"id\":99}");

    assertThatThrownBy(() -> service.complete(5,
        new CompleteBatchRequest(3, next, 0, null), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INVALID_BATCH_CHECKSUM"));
  }

  @Test
  void failureAcceptsOnlyOpaqueDiagnosticReference() {
    when(repository.find(5)).thenReturn(Optional.of(batch(5, "RUNNING", 3)),
        Optional.of(batch(5, "FAILED", 3)));
    when(repository.fail(5, "SOURCE_TIMEOUT", "run/daily-001.log", "local-worker"))
        .thenReturn(true);
    assertThat(service.fail(5,
        new FailBatchRequest("SOURCE_TIMEOUT", "run/daily-001.log"), "local-worker").state())
        .isEqualTo("FAILED");

    assertThatThrownBy(() -> service.fail(6,
        new FailBatchRequest("SOURCE_TIMEOUT", "raw error contains spaces"), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INVALID_DIAGNOSTIC_REF"));
  }

  @Test
  void retryCreatesNextAttemptAndAudits() {
    IngestionBatch failed = batchWithAttempt(5, "FAILED", 1, 3);
    IngestionBatch retried = batchWithAttempt(6, "RUNNING", 2, 3);
    when(repository.find(5)).thenReturn(Optional.of(failed));
    when(repository.findLatestByRunKey(2, "daily-001")).thenReturn(Optional.of(failed));
    when(repository.retry(5, "local-worker", 300)).thenReturn(Optional.of(retried));

    assertThat(service.retry(5, "local-worker")).isEqualTo(retried);
    verify(sourceRepository).audit(eq("local-worker"), eq("INGESTION_BATCH_RETRY"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void concurrentOrRepeatedRetryReturnsTheLatestAttempt() {
    IngestionBatch failed = batchWithAttempt(5, "FAILED", 1, 3);
    IngestionBatch latest = batchWithAttempt(6, "RUNNING", 2, 3);
    when(repository.find(5)).thenReturn(Optional.of(failed));
    when(repository.findLatestByRunKey(2, "daily-001"))
        .thenReturn(Optional.of(failed), Optional.of(latest));
    when(repository.retry(5, "local-worker", 300)).thenReturn(Optional.empty());

    assertThat(service.retry(5, "local-worker")).isEqualTo(latest);
  }

  @Test
  void retryRejectsRunningAndCancelIsIdempotentlyBounded() {
    IngestionBatch running = batchWithAttempt(5, "RUNNING", 1, 3);
    when(repository.find(5)).thenReturn(Optional.of(running));
    assertThatThrownBy(() -> service.retry(5, "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_NOT_RETRYABLE"));

    when(repository.cancel(5, "local-worker")).thenReturn(true);
    when(repository.find(5)).thenReturn(Optional.of(running), Optional.of(batchWithAttempt(
        5, "CANCELLED", 1, 3)));
    assertThat(service.cancel(5, "local-worker").state()).isEqualTo("CANCELLED");
    verify(sourceRepository).audit(eq("local-worker"), eq("INGESTION_BATCH_CANCEL"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void cancelRejectsFinishedBatch() {
    when(repository.find(5)).thenReturn(Optional.of(batchWithAttempt(5, "SUCCEEDED", 1, 3)));
    assertThatThrownBy(() -> service.cancel(5, "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_NOT_RUNNING"));
  }

  @Test
  void rejectsCompletionWhenLeaseIsNotActive() throws Exception {
    IngestionBatch running = batch(5, "RUNNING", 3);
    JsonNode next = objectMapper.readTree("{\"id\":99}");
    when(repository.find(5)).thenReturn(Optional.of(running));
    when(repository.rawEvidence(5)).thenReturn(Optional.of(evidence(1, "e".repeat(64))));
    when(repository.complete(5, 2, 3, next.toString(), 1, "e".repeat(64), "local-worker"))
        .thenReturn(BatchCompletionResult.LEASE_REJECTED);

    assertThatThrownBy(() -> service.complete(5,
        new CompleteBatchRequest(3, next, 1, "e".repeat(64)), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_LEASE_NOT_ACTIVE"));
  }

  @Test
  void rejectsFailureAndCancellationWhenLeaseIsNotActive() {
    IngestionBatch running = batch(5, "RUNNING", 3);
    when(repository.find(5)).thenReturn(Optional.of(running));
    when(repository.fail(5, "SOURCE_TIMEOUT", null, "local-worker")).thenReturn(false);
    assertThatThrownBy(() -> service.fail(5,
        new FailBatchRequest("SOURCE_TIMEOUT", null), "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_LEASE_NOT_ACTIVE"));

    when(repository.find(6)).thenReturn(Optional.of(batch(6, "RUNNING", 3)));
    when(repository.cancel(6, "local-worker")).thenReturn(false);
    assertThatThrownBy(() -> service.cancel(6, "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_LEASE_NOT_ACTIVE"));
  }

  @Test
  void heartbeatRenewsOwnedLeaseAndAudits() {
    IngestionBatch renewed = batch(5, "RUNNING", 3);
    when(repository.heartbeat(5, "local-worker", 300)).thenReturn(Optional.of(renewed));

    assertThat(service.heartbeat(5, "local-worker")).isEqualTo(renewed);
    verify(sourceRepository).audit(eq("local-worker"), eq("INGESTION_BATCH_HEARTBEAT"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void heartbeatRejectsMissingOrInactiveLease() {
    when(repository.heartbeat(5, "local-worker", 300)).thenReturn(Optional.empty());
    when(repository.find(5)).thenReturn(Optional.of(batch(5, "RUNNING", 3)));
    assertThatThrownBy(() -> service.heartbeat(5, "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_LEASE_NOT_ACTIVE"));

    when(repository.heartbeat(6, "local-worker", 300)).thenReturn(Optional.empty());
    when(repository.find(6)).thenReturn(Optional.empty());
    assertThatThrownBy(() -> service.heartbeat(6, "local-worker"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_NOT_FOUND"));
  }

  @Test
  void reconcilesExpiredBatchesWithBoundedLimitAndAudits() {
    when(repository.reconcileExpired(20)).thenReturn(List.of(5L, 6L));
    assertThat(service.reconcileExpired(20, "local-admin"))
        .isEqualTo(new BatchReconcileResult(2, List.of(5L, 6L)));
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_BATCH_RECONCILE"),
        eq("ingestion-batches"), anyString());

    assertThatThrownBy(() -> service.reconcileExpired(0, "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INVALID_RECONCILE_LIMIT"));
    assertThatThrownBy(() -> service.reconcileExpired(1001, "local-admin"))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void rejectsLeaseDurationOutsideOperationalBounds() {
    assertThatThrownBy(() -> new BatchService(
        repository, jobRepository, sourceRepository, objectMapper, 29))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BatchService(
        repository, jobRepository, sourceRepository, objectMapper, 3601))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void returnsCheckpointWithVersionAndAudits() throws Exception {
    CheckpointView view = new CheckpointView(objectMapper.readTree("{\"id\":7}"), 4);
    when(repository.currentCheckpoint(2)).thenReturn(view);
    assertThat(service.checkpoint(2, "local-admin")).isEqualTo(view);
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_CHECKPOINT_READ"),
        eq("ingestion-job/2"), anyString());
  }

  private IngestionJob job(String state) {
    return new IngestionJob(2, 1, "STORY", "UPDATED_AT_KEYSET",
        objectMapper.createObjectNode(), objectMapper.createObjectNode(), state, 0,
        OffsetDateTime.parse("2026-09-14T00:00:00Z"), OffsetDateTime.parse("2026-09-14T00:00:00Z"));
  }

  private IngestionBatch batch(long id, String state, long checkpointVersion) {
    return batchWithAttempt(id, state, 1, checkpointVersion);
  }

  private IngestionBatch batchWithAttempt(long id, String state, int attempt, long checkpointVersion) {
    return new IngestionBatch(id, 2, "daily-001", attempt, objectMapper.createObjectNode(),
        objectMapper.createObjectNode(), state, 0, null, null, null, checkpointVersion,
        OffsetDateTime.parse("2026-09-14T00:00:00Z"), null, null, "local-worker",
        OffsetDateTime.parse("2099-09-14T00:05:00Z"),
        OffsetDateTime.parse("2026-09-14T00:00:00Z"));
  }

  private RawBatchEvidence evidence(long rowCount, String checksum) {
    return new RawBatchEvidence(rowCount, checksum, "local-worker",
        OffsetDateTime.parse("2026-09-14T00:30:00Z"));
  }
}
