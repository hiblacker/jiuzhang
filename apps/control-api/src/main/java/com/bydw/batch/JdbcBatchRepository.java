package com.bydw.batch;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class JdbcBatchRepository implements BatchRepository {
  private static final String COLUMNS = "id, job_id, run_key, attempt, cursor_from::text,"
      + " cursor_to::text, state, row_count, checksum, error_code, diagnostic_ref,"
      + " COALESCE(checkpoint_version, 0), started_at, finished_at, committed_at,"
      + " lease_owner, lease_expires_at, last_heartbeat_at";
  private final JdbcTemplate jdbc;
  private final ObjectMapper objectMapper;

  public JdbcBatchRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
    this.jdbc = jdbc;
    this.objectMapper = objectMapper;
  }

  @Override
  public Optional<IngestionBatch> start(
      long jobId, String runKey, String cursorToJson, String leaseOwner, int leaseSeconds) {
    String sql = "INSERT INTO control.ingestion_batch"
        + "(job_id, run_key, cursor_from, cursor_to, state, checkpoint_version,"
        + " lease_owner, lease_expires_at, last_heartbeat_at)"
        + " SELECT id, ?, checkpoint, CAST(? AS jsonb), 'RUNNING', checkpoint_version, ?,"
        + " statement_timestamp() + make_interval(secs => ?), statement_timestamp()"
        + " FROM control.ingestion_job WHERE id = ?"
        + " ON CONFLICT (job_id, run_key, attempt) DO NOTHING RETURNING " + COLUMNS;
    return jdbc.query(sql, this::map, runKey, cursorToJson, leaseOwner, leaseSeconds, jobId)
        .stream().findFirst();
  }

  @Override
  public Optional<IngestionBatch> find(long batchId) {
    return jdbc.query("SELECT " + COLUMNS
        + " FROM control.ingestion_batch WHERE id = ?", this::map, batchId).stream().findFirst();
  }

  @Override
  public Optional<IngestionBatch> findLatestByRunKey(long jobId, String runKey) {
    return jdbc.query("SELECT " + COLUMNS + " FROM control.ingestion_batch"
        + " WHERE job_id = ? AND run_key = ? ORDER BY attempt DESC, id DESC LIMIT 1",
        this::map, jobId, runKey).stream().findFirst();
  }

  @Override
  public Optional<RawBatchEvidence> rawEvidence(long batchId) {
    return jdbc.query("SELECT record_count, checksum, writer_principal, sealed_at"
        + " FROM raw.ingestion_batch_manifest WHERE batch_id = ?",
        (result, row) -> new RawBatchEvidence(
            result.getLong(1), result.getString(2), result.getString(3),
            result.getObject(4, OffsetDateTime.class)), batchId).stream().findFirst();
  }

  @Override
  public Optional<IngestionBatch> retry(long batchId, String leaseOwner, int leaseSeconds) {
    String sql = "INSERT INTO control.ingestion_batch"
        + "(job_id, run_key, attempt, cursor_from, cursor_to, state, checkpoint_version,"
        + " lease_owner, lease_expires_at, last_heartbeat_at)"
        + " SELECT job_id, run_key, attempt + 1, cursor_from, cursor_to, 'RUNNING',"
        + " checkpoint_version, ?, statement_timestamp() + make_interval(secs => ?),"
        + " statement_timestamp()"
        + " FROM control.ingestion_batch WHERE id = ? AND state IN ('FAILED','CANCELLED')"
        + " ON CONFLICT (job_id, run_key, attempt) DO NOTHING RETURNING " + COLUMNS;
    return jdbc.query(sql, this::map, leaseOwner, leaseSeconds, batchId).stream().findFirst();
  }

  @Override
  public Optional<IngestionBatch> heartbeat(long batchId, String leaseOwner, int leaseSeconds) {
    String sql = "UPDATE control.ingestion_batch"
        + " SET last_heartbeat_at = statement_timestamp(),"
        + " lease_expires_at = statement_timestamp() + make_interval(secs => ?)"
        + " WHERE id = ? AND state = 'RUNNING' AND lease_owner = ?"
        + " AND lease_expires_at > statement_timestamp() RETURNING " + COLUMNS;
    return jdbc.query(sql, this::map, leaseSeconds, batchId, leaseOwner).stream().findFirst();
  }

  @Override
  @Transactional
  public BatchCompletionResult complete(long batchId, long jobId, long expectedCheckpointVersion,
      String nextCheckpointJson, long rowCount, String checksum, String leaseOwner) {
    Boolean activeLease = jdbc.queryForObject("SELECT state = 'RUNNING' AND lease_owner = ?"
        + " AND lease_expires_at > statement_timestamp() FROM control.ingestion_batch"
        + " WHERE id = ? AND job_id = ? FOR UPDATE", Boolean.class, leaseOwner, batchId, jobId);
    if (!Boolean.TRUE.equals(activeLease)) return BatchCompletionResult.LEASE_REJECTED;

    int advanced = jdbc.update("UPDATE control.ingestion_job"
        + " SET checkpoint = CAST(? AS jsonb), checkpoint_version = checkpoint_version + 1, updated_at = now()"
        + " WHERE id = ? AND checkpoint_version = ?", nextCheckpointJson, jobId, expectedCheckpointVersion);
    if (advanced != 1) {
      int stale = jdbc.update("UPDATE control.ingestion_batch"
          + " SET state = 'STALE', error_code = 'STALE_CHECKPOINT', finished_at = now()"
          + " WHERE id = ? AND job_id = ? AND state = 'RUNNING'", batchId, jobId);
      if (stale != 1) throw new IllegalStateException("Batch state changed during stale rejection");
      return BatchCompletionResult.STALE;
    }
    int completed = jdbc.update("UPDATE control.ingestion_batch"
        + " SET state = 'SUCCEEDED', row_count = ?, checksum = ?,"
        + " checkpoint_version = ?, finished_at = now(), committed_at = now()"
        + " WHERE id = ? AND job_id = ? AND state = 'RUNNING'",
        rowCount, checksum, expectedCheckpointVersion + 1, batchId, jobId);
    if (completed != 1) throw new IllegalStateException("Batch state changed during checkpoint commit");
    return BatchCompletionResult.COMPLETED;
  }

  @Override
  public boolean fail(long batchId, String errorCode, String diagnosticRef, String leaseOwner) {
    return jdbc.update("UPDATE control.ingestion_batch"
        + " SET state = 'FAILED', error_code = ?, diagnostic_ref = ?, finished_at = now()"
        + " WHERE id = ? AND state = 'RUNNING' AND lease_owner = ?"
        + " AND lease_expires_at > statement_timestamp()",
        errorCode, diagnosticRef, batchId, leaseOwner) == 1;
  }

  @Override
  public boolean cancel(long batchId, String leaseOwner) {
    return jdbc.update("UPDATE control.ingestion_batch"
        + " SET state = 'CANCELLED', error_code = 'CANCELLED_BY_WORKER', finished_at = now()"
        + " WHERE id = ? AND state = 'RUNNING' AND lease_owner = ?"
        + " AND lease_expires_at > statement_timestamp()", batchId, leaseOwner) == 1;
  }

  @Override
  public List<Long> reconcileExpired(int limit) {
    String sql = "WITH expired AS (SELECT id FROM control.ingestion_batch"
        + " WHERE state = 'RUNNING' AND lease_expires_at <= statement_timestamp()"
        + " ORDER BY lease_expires_at, id FOR UPDATE SKIP LOCKED LIMIT ?)"
        + " UPDATE control.ingestion_batch batch SET state = 'FAILED',"
        + " error_code = 'LEASE_EXPIRED', finished_at = statement_timestamp()"
        + " FROM expired WHERE batch.id = expired.id RETURNING batch.id";
    return jdbc.query(sql, (result, row) -> result.getLong(1), limit);
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
          result.getObject(14, OffsetDateTime.class), result.getObject(15, OffsetDateTime.class),
          result.getString(16), result.getObject(17, OffsetDateTime.class),
          result.getObject(18, OffsetDateTime.class));
    } catch (JsonProcessingException exception) {
      throw new SQLException("Stored batch contract is invalid JSON", exception);
    }
  }

  private JsonNode readJson(String value) throws JsonProcessingException {
    return value == null ? objectMapper.createObjectNode() : objectMapper.readTree(value);
  }
}
