package com.bydw.warehouse;

import com.bydw.api.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ProductAccessService {
  private final JdbcTemplate jdbc;
  public ProductAccessService(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  public static String hash(String value) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception error) { throw new IllegalStateException("SHA256_UNAVAILABLE"); }
  }
  public String authenticate(String token) {
    if (token == null || token.length() < 24 || token.length() > 256) return null;
    var rows = jdbc.queryForList("SELECT id FROM warehouse.identity WHERE token_sha256 = ? AND enabled", hash(token));
    return rows.isEmpty() ? null : rows.getFirst().get("id").toString();
  }
  public boolean admin(String actor) { return "local-admin".equals(actor); }
  public void requireAdmin(String actor) { if (!admin(actor)) denied(); }
  public String require(long project, String actor, String minimum) {
    if (jdbc.queryForObject("SELECT count(*) FROM warehouse.project WHERE id = ?", Long.class, project) != 1) denied();
    if (admin(actor)) return "OWNER";
    var rows = jdbc.queryForList("SELECT role FROM warehouse.project_member m JOIN warehouse.identity i ON i.id = m.identity_id WHERE m.project_id = ? AND i.id = ? AND i.enabled", project, actor);
    if (rows.isEmpty()) denied();
    String role = rows.getFirst().get("role").toString();
    var ranks = Map.of("VIEWER", 1, "ENGINEER", 2, "OWNER", 3);
    if (ranks.getOrDefault(role, 0) < ranks.get(minimum)) denied();
    return role;
  }
  public List<Map<String, Object>> projects(String actor) {
    if (admin(actor)) return jdbc.queryForList("SELECT p.*, 'OWNER' AS role FROM warehouse.project p ORDER BY id LIMIT 200");
    return jdbc.queryForList("SELECT p.*, m.role FROM warehouse.project p JOIN warehouse.project_member m ON m.project_id = p.id JOIN warehouse.identity i ON i.id = m.identity_id WHERE i.id = ? AND i.enabled ORDER BY p.id LIMIT 200", actor);
  }
  private static void denied() { throw new ApiException(HttpStatus.FORBIDDEN, "PROJECT_ACCESS_DENIED", "Project access denied"); }
}
