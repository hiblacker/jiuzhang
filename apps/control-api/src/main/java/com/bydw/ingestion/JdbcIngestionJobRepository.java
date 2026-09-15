package com.bydw.ingestion;

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

@Repository
public class JdbcIngestionJobRepository implements IngestionJobRepository {
  private static final String COLUMNS = "id, source_id, object_name, strategy, cursor_spec::text,"
      + " delete_spec::text, state, version, created_at, updated_at";
  private final JdbcTemplate jdbc;
  private final ObjectMapper objectMapper;

  public JdbcIngestionJobRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
    this.jdbc = jdbc;
    this.objectMapper = objectMapper;
  }

  @Override
  public IngestionJob create(long sourceId, String objectName, String strategy,
      String cursorSpecJson, String deleteSpecJson) {
    String sql = "INSERT INTO control.ingestion_job"
        + "(source_id, object_name, strategy, cursor_spec, delete_spec)"
        + " VALUES (?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb)) RETURNING " + COLUMNS;
    return jdbc.queryForObject(sql, this::map,
        sourceId, objectName, strategy, cursorSpecJson, deleteSpecJson);
  }

  @Override
  public List<IngestionJob> list(int limit, int offset) {
    return jdbc.query("SELECT " + COLUMNS
        + " FROM control.ingestion_job ORDER BY id LIMIT ? OFFSET ?", this::map, limit, offset);
  }

  @Override
  public Optional<IngestionJob> findById(long id) {
    return jdbc.query("SELECT " + COLUMNS
        + " FROM control.ingestion_job WHERE id = ?", this::map, id).stream().findFirst();
  }

  @Override
  public Optional<IngestionJob> activate(long id) {
    return jdbc.query("UPDATE control.ingestion_job SET state = 'ACTIVE', updated_at = now()"
        + " WHERE id = ? AND state IN ('DRAFT','ACTIVE') RETURNING " + COLUMNS, this::map, id)
        .stream().findFirst();
  }

  private IngestionJob map(ResultSet result, int rowNumber) throws SQLException {
    try {
      return new IngestionJob(
          result.getLong(1), result.getLong(2), result.getString(3), result.getString(4),
          objectMapper.readTree(result.getString(5)), objectMapper.readTree(result.getString(6)),
          result.getString(7), result.getLong(8), result.getObject(9, OffsetDateTime.class),
          result.getObject(10, OffsetDateTime.class));
    } catch (JsonProcessingException exception) {
      throw new SQLException("Stored ingestion job contract is invalid JSON", exception);
    }
  }
}
