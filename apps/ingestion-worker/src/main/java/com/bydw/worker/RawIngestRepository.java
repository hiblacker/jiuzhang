package com.bydw.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class RawIngestRepository {
  private final JdbcTemplate jdbc;
  private final ObjectMapper objectMapper;

  RawIngestRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
    this.jdbc = jdbc;
    this.objectMapper = objectMapper;
  }

  String ingest(
      long batchId,
      JsonNode sourceRecordKey,
      JsonNode payload,
      String payloadChecksum,
      OffsetDateTime sourceUpdatedAt,
      OffsetDateTime eventTime) {
    return jdbc.queryForObject(
        "SELECT raw.ingest_record(?, CAST(? AS jsonb), CAST(? AS jsonb), ?, CAST(? AS timestamptz), CAST(? AS timestamptz))",
        String.class,
        batchId,
        json(sourceRecordKey),
        json(payload),
        payloadChecksum,
        sourceUpdatedAt,
        eventTime);
  }

  long seal(long batchId, String checksum, String writerPrincipal) {
    Long count = jdbc.queryForObject(
        "SELECT raw.seal_ingestion_batch(?, ?, ?)", Long.class, batchId, checksum, writerPrincipal);
    if (count == null) throw new IllegalStateException("seal_ingestion_batch returned no row count");
    return count;
  }

  private String json(JsonNode node) {
    try {
      return objectMapper.writeValueAsString(node);
    } catch (Exception exception) {
      throw new IllegalArgumentException("JSON value cannot be serialized", exception);
    }
  }
}
