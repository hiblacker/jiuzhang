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
    service = new BatchService(repository, jobRepository, sourceRepository, objectMapper);
  }

  @Test
  void startsFromServerCheckpointAndAudits() throws Exception {
    when(jobRepository.findById(2)).thenReturn(Optional.of(job("ACTIVE")));
    JsonNode cursorTo = objectMapper.readTree("{\"updatedAt\":\"2026-09-14T01:00:00Z\"}");
    IngestionBatch batch = batch(5, "RUNNING", 3);
    when(repository.start(2, "daily-001", cursorTo.toString())).thenReturn(Optional.of(batch));

    IngestionBatch result = service.start(2, new StartBatchRequest("daily-001", cursorTo), "local-admin");

    assertThat(result).isEqualTo(batch);
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_BATCH_START"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void replayReturnsExistingBatch() throws Exception {
    when(jobRepository.findById(2)).thenReturn(Optional.of(job("ACTIVE")));
    JsonNode cursorTo = objectMapper.readTree("{\"updatedAt\":\"2026-09-14T01:00:00Z\"}");
    IngestionBatch existing = new IngestionBatch(5, 2, "daily-001", 1,
        objectMapper.createObjectNode(), cursorTo, "RUNNING", 0, null, null, null, 3,
        OffsetDateTime.parse("2026-09-14T00:00:00Z"), null, null);
    when(repository.start(2, "daily-001", cursorTo.toString())).thenReturn(Optional.empty());
    when(repository.findByRunKey(2, "daily-001")).thenReturn(Optional.of(existing));

    assertThat(service.start(2, new StartBatchRequest("daily-001", cursorTo), "local-admin"))
        .isEqualTo(existing);
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_BATCH_REPLAY"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void replayRejectsDifferentUpperBound() throws Exception {
    when(jobRepository.findById(2)).thenReturn(Optional.of(job("ACTIVE")));
    JsonNode requested = objectMapper.readTree("{\"id\":2}");
    IngestionBatch existing = new IngestionBatch(5, 2, "daily-001", 1,
        objectMapper.createObjectNode(), objectMapper.readTree("{\"id\":1}"), "RUNNING",
        0, null, null, null, 3, OffsetDateTime.parse("2026-09-14T00:00:00Z"), null, null);
    when(repository.start(2, "daily-001", requested.toString())).thenReturn(Optional.empty());
    when(repository.findByRunKey(2, "daily-001")).thenReturn(Optional.of(existing));

    assertThatThrownBy(() -> service.start(2,
        new StartBatchRequest("daily-001", requested), "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_RUN_KEY_MISMATCH"));
  }

  @Test
  void refusesDraftJobAndEmptyUpperBound() throws Exception {
    when(jobRepository.findById(2)).thenReturn(Optional.of(job("DRAFT")));
    assertThatThrownBy(() -> service.start(2,
        new StartBatchRequest("daily-001", objectMapper.createObjectNode()), "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INGESTION_JOB_DISABLED"));

    when(jobRepository.findById(3)).thenReturn(Optional.of(job("ACTIVE")));
    assertThatThrownBy(() -> service.start(3,
        new StartBatchRequest("daily-002", objectMapper.createObjectNode()), "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INVALID_CURSOR_TO"));
  }

  @Test
  void commitsOnlyCapturedCheckpointVersion() throws Exception {
    IngestionBatch running = batch(5, "RUNNING", 3);
    when(repository.find(5)).thenReturn(Optional.of(running), Optional.of(batch(5, "SUCCEEDED", 4)));
    JsonNode next = objectMapper.readTree("{\"updatedAt\":\"2026-09-14T01:00:00Z\",\"id\":99}");
    when(repository.complete(5, 2, 3, next.toString(), 12, "a".repeat(64))).thenReturn(true);

    IngestionBatch completed = service.complete(5,
        new CompleteBatchRequest(3, next, 12, "a".repeat(64)), "local-admin");

    assertThat(completed.state()).isEqualTo("SUCCEEDED");
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_BATCH_COMPLETE"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void rejectsMismatchedAndStaleCheckpointVersions() throws Exception {
    IngestionBatch running = batch(5, "RUNNING", 3);
    JsonNode next = objectMapper.readTree("{\"id\":99}");
    when(repository.find(5)).thenReturn(Optional.of(running));
    assertThatThrownBy(() -> service.complete(5,
        new CompleteBatchRequest(2, next, 1, null), "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("BATCH_CHECKPOINT_VERSION_MISMATCH"));

    when(repository.complete(5, 2, 3, next.toString(), 1, null)).thenReturn(false);
    when(repository.find(5)).thenReturn(Optional.of(running), Optional.of(batch(5, "STALE", 3)));
    assertThat(service.complete(5,
        new CompleteBatchRequest(3, next, 1, null), "local-admin").state()).isEqualTo("STALE");
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_BATCH_STALE"),
        eq("ingestion-batch/5"), anyString());
  }

  @Test
  void failureAcceptsOnlyOpaqueDiagnosticReference() {
    when(repository.fail(5, "SOURCE_TIMEOUT", "run/daily-001.log")).thenReturn(true);
    when(repository.find(5)).thenReturn(Optional.of(batch(5, "FAILED", 3)));
    assertThat(service.fail(5,
        new FailBatchRequest("SOURCE_TIMEOUT", "run/daily-001.log"), "local-admin").state())
        .isEqualTo("FAILED");

    assertThatThrownBy(() -> service.fail(6,
        new FailBatchRequest("SOURCE_TIMEOUT", "raw error contains spaces"), "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INVALID_DIAGNOSTIC_REF"));
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
    return new IngestionBatch(id, 2, "daily-001", 1, objectMapper.createObjectNode(),
        objectMapper.createObjectNode(), state, 0, null, null, null, checkpointVersion,
        OffsetDateTime.parse("2026-09-14T00:00:00Z"), null, null);
  }
}
