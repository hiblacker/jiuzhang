package com.bydw.ingestion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.bydw.api.ApiException;
import com.bydw.source.SourceConnection;
import com.bydw.source.SourceRepository;
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
class IngestionJobServiceTest {
  @Mock IngestionJobRepository repository;
  @Mock SourceRepository sourceRepository;
  private ObjectMapper objectMapper;
  private IngestionJobService service;

  @BeforeEach
  void setUp() {
    objectMapper = new ObjectMapper();
    service = new IngestionJobService(repository, sourceRepository, objectMapper);
  }

  @Test
  void createsUpdatedAtJobWithExplicitDeleteContract() throws Exception {
    allowSource();
    var cursor = objectMapper.readTree(
        "{\"updatedAtColumn\":\"UPDATE_TIME\",\"keyColumns\":[\"ID\"],\"overlapSeconds\":300}");
    var delete = objectMapper.readTree(
        "{\"mode\":\"LOGICAL_FLAG\",\"column\":\"DELETE_FLAG\",\"activeValue\":0,\"deletedValue\":1}");
    var stored = job(cursor, delete);
    when(repository.create(1, "STORY", "UPDATED_AT_KEYSET", cursor.toString(), delete.toString()))
        .thenReturn(stored);

    IngestionJob result = service.create(new CreateIngestionJobRequest(
        1, "STORY", "UPDATED_AT_KEYSET", cursor, delete), "local-admin");

    assertThat(result).isEqualTo(stored);
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_JOB_CREATE"),
        eq("ingestion-job/3"), anyString());
  }

  @Test
  void rejectsIncompleteUpdatedAtContract() throws Exception {
    allowSource();
    var delete = objectMapper.readTree("{\"mode\":\"NONE\"}");
    for (String cursorJson : List.of(
        "{\"keyColumns\":[\"ID\"],\"overlapSeconds\":300}",
        "{\"updatedAtColumn\":\"UPDATE_TIME\",\"keyColumns\":[],\"overlapSeconds\":300}",
        "{\"updatedAtColumn\":\"UPDATE_TIME\",\"keyColumns\":[\"ID\"],\"overlapSeconds\":86401}")) {
      var cursor = objectMapper.readTree(cursorJson);
      assertThatThrownBy(() -> service.create(new CreateIngestionJobRequest(
          1, "STORY", "UPDATED_AT_KEYSET", cursor, delete), "local-admin"))
          .isInstanceOf(ApiException.class);
    }
  }

  @Test
  void rejectsAmbiguousDeleteRulesAndUnknownFields() throws Exception {
    allowSource();
    var cursor = objectMapper.readTree("{\"keyColumns\":[\"ID\"]}");
    for (String deleteJson : List.of(
        "{\"mode\":\"LOGICAL_FLAG\",\"column\":\"DELETE_FLAG\",\"activeValue\":0,\"deletedValue\":0}",
        "{\"mode\":\"NONE\",\"column\":\"DELETE_FLAG\"}",
        "{\"mode\":\"GUESSED\"}",
        "{\"mode\":\"NONE\",\"unexpected\":true}")) {
      var delete = objectMapper.readTree(deleteJson);
      assertThatThrownBy(() -> service.create(new CreateIngestionJobRequest(
          1, "STORY", "FULL", cursor, delete), "local-admin"))
          .isInstanceOf(ApiException.class);
    }
  }

  @Test
  void rejectsMissingAndDisabledSources() throws Exception {
    var cursor = objectMapper.readTree("{\"keyColumns\":[\"ID\"]}");
    var delete = objectMapper.readTree("{\"mode\":\"NONE\"}");
    when(sourceRepository.findById(1)).thenReturn(Optional.empty());
    assertThatThrownBy(() -> service.create(new CreateIngestionJobRequest(
        1, "STORY", "FULL", cursor, delete), "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("SOURCE_NOT_FOUND"));

    when(sourceRepository.findById(2)).thenReturn(Optional.of(source(2, "DISABLED")));
    assertThatThrownBy(() -> service.create(new CreateIngestionJobRequest(
        2, "STORY", "FULL", cursor, delete), "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("SOURCE_DISABLED"));
  }

  @Test
  void activatesDraftJobsAndRejectsDisabledJobs() {
    var stored = job(objectMapper.createObjectNode(), objectMapper.createObjectNode());
    var active = new IngestionJob(stored.id(), stored.sourceId(), stored.objectName(),
        stored.strategy(), stored.cursorSpec(), stored.deleteSpec(), "ACTIVE", stored.version(),
        stored.createdAt(), stored.updatedAt());
    when(repository.activate(3)).thenReturn(Optional.of(active));
    assertThat(service.activate(3, "local-admin").state()).isEqualTo("ACTIVE");
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_JOB_ACTIVATE"),
        eq("ingestion-job/3"), anyString());

    when(repository.activate(4)).thenReturn(Optional.empty());
    when(repository.findById(4)).thenReturn(Optional.of(new IngestionJob(
        4, 1, "STORY", "FULL", stored.cursorSpec(), stored.deleteSpec(), "DISABLED", 0,
        stored.createdAt(), stored.updatedAt())));
    assertThatThrownBy(() -> service.activate(4, "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INGESTION_JOB_DISABLED"));
  }

  @Test
  void listsWithBoundedPagination() {
    when(repository.list(20, 0)).thenReturn(List.of());
    assertThat(service.list(20, 0, "local-admin").count()).isZero();
    verify(sourceRepository).audit(eq("local-admin"), eq("INGESTION_JOB_LIST"),
        eq("ingestion-jobs"), anyString());
    assertThatThrownBy(() -> service.list(101, 0, "local-admin"))
        .isInstanceOf(ApiException.class);
  }

  private void allowSource() {
    when(sourceRepository.findById(1)).thenReturn(Optional.of(source(1, "DRAFT")));
  }

  private SourceConnection source(long id, String state) {
    return new SourceConnection(id, "devops_mysql", "MYSQL", objectMapper.createObjectNode(), state,
        OffsetDateTime.parse("2026-09-14T00:00:00Z"), OffsetDateTime.parse("2026-09-14T00:00:00Z"));
  }

  private IngestionJob job(com.fasterxml.jackson.databind.JsonNode cursor,
      com.fasterxml.jackson.databind.JsonNode delete) {
    return new IngestionJob(3, 1, "STORY", "UPDATED_AT_KEYSET", cursor, delete, "DRAFT", 0,
        OffsetDateTime.parse("2026-09-14T00:00:00Z"), OffsetDateTime.parse("2026-09-14T00:00:00Z"));
  }
}
