package com.bydw.batch;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class JdbcBatchRepository implements BatchRepository {
  private static final String COLUMNS = "id, job_id, run_key, attempt, cursor_from::text,"
      + " cursor_to::text, state, row_count, checksum, error_code, diagnostic_ref,"
      + " COALESCE(checkpoint_version, 0), started_at, finished_at, committed_at";
  private final JdbcTemplate jdbc;
  private final ObjectMapper objectMapper;

  public JdbcBatchRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
    this.jdbc = jdbc;
    this.objectMapper = objectMapper;
  }

  @Override
  public Optional<IngestionBatch> start(long jobId, String runKey, String cursorToJson) {
    String sql = "INSERT INTO control.ingestion_batch"
        + "(job_id, run_key, cursor_from, cursor_to, state, checkpoint_version)"
        + " SELECT id, ?, checkpoint, CAST(? AS jsonb), 'RUNNING', checkpoint_version"
        + " FROM control.ingestion_job WHERE id = ?"
        + " ON CONFLICT (job_id, run_key) DO NOTHING RETURNING " + COLUMNS;
    return jdbc.query(sql, this::map, runKey, cursorToJson, jobId).stream().findFirst();
  }

  @Override
  public Optional<IngestionBatch> find(long batchId) {
    return jdbc.query("SELECT " + COLUMNS
        + " FROM control.ingestion_batch WHERE id = ?", this::map, batchId).stream().findFirst();
  }

  @Override
  public Optional<IngestionBatch> findByRunKey(long jobId, String runKey) {
    return jdbc.query("SELECT " + COLUMNS
        + " FROM control.ingestion_batch WHERE job_id = ? AND run_key = ?", this::map,
        jobId, runKey).stream().findFirst();
  }

  @Override
  @Transactional
  public boolean complete(long batchId, long jobId, long expectedCheckpointVersion,
      String nextCheckpointJson, long rowCount, String checksum) {
    int advanced = jdbc.update("UPDATE control.ingestion_job"
        + " SET checkpoint = CAST(? AS jsonb), checkpoint_version = checkpoint_version + 1, updated_at = now()"
        + " WHERE id = ? AND checkpoint_version = ?", nextCheckpointJson, jobId, expectedCheckpointVersion);
    if (advanced != 1) {
      int stale = jdbc.update("UPDATE control.ingestion_batch"
          + " SET state = 'STALE', error_code = 'STALE_CHECKPOINT', finished_at = now()"
          + " WHERE id = ? AND job_id = ? AND state = 'RUNNING'", batchId, jobId);
      if (stale != 1) throw new IllegalStateException("Batch state changed during stale rejection");
      return false;
    }
    int completed = jdbc.update("UPDATE control.ingestion_batch"
        + " SET state = 'SUCCEEDED', row_count = ?, checksum = ?,"
        + " checkpoint_version = ?, finished_at = now(), committed_at = now()"
        + " WHERE id = ? AND job_id = ? AND state = 'RUNNING'",
        rowCount, checksum, expectedCheckpointVersion + 1, batchId, jobId);
    if (completed != 1) throw new IllegalStateException("Batch state changed during checkpoint commit");
    return true;
  }

  @Override
  public boolean fail(long batchId, String errorCode, String diagnosticRef) {
    return jdbc.update("UPDATE control.ingestion_batch"
        + " SET state = 'FAILED', error_code = ?, diagnostic_ref = ?, finished_at = now()"
        + " WHERE id = ? AND state = 'RUNNING'", errorCode, diagnosticRef, batchId) == 1;
  }

  @Override
  public CheckpointView currentCheckpoint(long jobId) {
    return jdbc.queryForObject("SELECT checkpoint::text, checkpoint_version"
        + " FROM control.ingestion_job WHERE id = ?", (result, row) -> {
          try {
            return new CheckpointView(objectMapper.readTree(result.getString(1)), result.getLong(2));
          } catch (JsonProcessingException exception) {
            throw new SQLException("Stored checkpoint is invalid JSON", exception);
          }
        }, jobId);
  }

  private IngestionBatch map(ResultSet result, int rowNumber) throws SQLException {
    try {
      return new IngestionBatch(
          result.getLong(1), result.getLong(2), result.getString(3), result.getInt(4),
          readJson(result.getString(5)), readJson(result.getString(6)),
          result.getString(7), result.getLong(8), result.getString(9), result.getString(10),
          result.getString(11), result.getLong(12), result.getObject(13, OffsetDateTime.class),
          result.getObject(14, OffsetDateTime.class), result.getObject(15, OffsetDateTime.class));
    } catch (JsonProcessingException exception) {
      throw new SQLException("Stored batch contract is invalid JSON", exception);
    }
  }

  private JsonNode readJson(String value) throws JsonProcessingException {
    return value == null ? objectMapper.createObjectNode() : objectMapper.readTree(value);
  }
}
