package com.bydw.source;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcSourceRepository implements SourceRepository {
  private static final String COLUMNS = "id, code, source_type, config::text, state, created_at, updated_at";
  private final JdbcTemplate jdbc;
  private final ObjectMapper objectMapper;

  public JdbcSourceRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
    this.jdbc = jdbc;
    this.objectMapper = objectMapper;
  }

  @Override
  public SourceConnection create(
      String code, String sourceType, String configJson, String credentialRef) {
    String sql = "INSERT INTO control.source_connection"
        + "(code, source_type, config, credential_ref) VALUES (?, ?, CAST(? AS jsonb), ?) RETURNING "
        + COLUMNS;
    return jdbc.queryForObject(sql, this::map, code, sourceType, configJson, credentialRef);
  }

  @Override
  public List<SourceConnection> list(int limit, int offset) {
    String sql = "SELECT " + COLUMNS
        + " FROM control.source_connection ORDER BY id LIMIT ? OFFSET ?";
    return jdbc.query(sql, this::map, limit, offset);
  }

  @Override
  public Optional<SourceConnection> findById(long id) {
    String sql = "SELECT " + COLUMNS + " FROM control.source_connection WHERE id = ?";
    return jdbc.query(sql, this::map, id).stream().findFirst();
  }

  @Override
  public void audit(String principal, String action, String resource, String detailsJson) {
    jdbc.update("INSERT INTO control.audit_log"
        + "(principal, action, resource, result, details) VALUES (?, ?, ?, 'SUCCEEDED', CAST(? AS jsonb))",
        principal, action, resource, detailsJson);
  }

  private SourceConnection map(ResultSet result, int rowNumber) throws SQLException {
    try {
      JsonNode config = objectMapper.readTree(result.getString(4));
      return new SourceConnection(
          result.getLong(1), result.getString(2), result.getString(3), config,
          result.getString(5), result.getObject(6, java.time.OffsetDateTime.class),
          result.getObject(7, java.time.OffsetDateTime.class));
    } catch (JsonProcessingException exception) {
      throw new SQLException("Stored source config is invalid JSON", exception);
    }
  }
}
