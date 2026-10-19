package cn.jiuzhang.platform.warehouse.infrastructure;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import cn.jiuzhang.platform.warehouse.application.QueryStore;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class JdbcQueryStore implements QueryStore {
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final MetadataJson json;

  public JdbcQueryStore(JdbcTemplate db, TransactionTemplate tx, MetadataJson json) {
    this.db = db;
    this.tx = tx;
    this.json = json;
  }

  public <T> T transaction(Supplier<T> work) {
    return tx.execute(s -> work.get());
  }

  private String table(String resource) {
    return switch (resource) {
      case "queries" -> "warehouse_query";
      case "exports" -> "warehouse_export";
      default -> throw new IllegalArgumentException();
    };
  }

  public String nextId(String resource) {
    return db.queryForObject(
            "SELECT nextval(pg_get_serial_sequence(?, 'id'))", Long.class, table(resource))
        .toString();
  }

  public Map<String, Object> get(String resource, String id, String user) {
    var rows =
        db.queryForList("SELECT user_id,body FROM " + table(resource) + " WHERE id=?", n(id));
    if (rows.isEmpty()) throw new Failure(404, "NOT_FOUND");
    if (!rows.getFirst().get("user_id").toString().equals(user))
      throw new Failure(403, "FORBIDDEN");
    return json.object(rows.getFirst().get("body"));
  }

  public List<Map<String, Object>> list(String resource, String user) {
    return db
        .queryForList(
            "SELECT body FROM " + table(resource) + " WHERE user_id=? ORDER BY id DESC LIMIT 1000",
            n(user))
        .stream()
        .map(row -> json.object(row.get("body")))
        .toList();
  }

  public void save(
      String resource,
      String id,
      String user,
      String dataset,
      String run,
      String query,
      Map<String, Object> body) {
    if (resource.equals("queries"))
      db.update(
          "INSERT INTO warehouse_query(id,user_id,dataset_id,run_id,body) OVERRIDING SYSTEM VALUE"
              + " VALUES (?,?,?,?,?::jsonb)",
          n(id),
          n(user),
          n(dataset),
          n(run),
          json.write(body));
    else
      db.update(
          "INSERT INTO warehouse_export(id,user_id,query_id,body) OVERRIDING SYSTEM VALUE VALUES"
              + " (?,?,?,?::jsonb)",
          n(id),
          n(user),
          n(query),
          json.write(body));
  }

  public void lock(String user, String resource, String key) {
    db.queryForList(
        "SELECT pg_advisory_xact_lock(hashtextextended(?,0))", user + ":" + resource + ":" + key);
  }

  public int cleanupExpiredExports() {
    int cleaned = 0;
    for (int batch = 0; batch < 10; batch++) {
      int count =
          db.update(
              "WITH expired AS (SELECT id FROM warehouse_export WHERE body->>'content'<>'' AND"
                  + " (body->>'expiresAt')::timestamptz<=now() ORDER BY id FOR UPDATE SKIP LOCKED"
                  + " LIMIT 100) UPDATE warehouse_export e SET"
                  + " body=jsonb_set(e.body,'{content}',to_jsonb(''::text)) FROM expired WHERE"
                  + " e.id=expired.id");
      cleaned += count;
      if (count < 100) break;
    }
    return cleaned;
  }

  public Map<String, Object> receipt(String user, String resource, String key, String hash) {
    var rows =
        db.queryForList(
            "SELECT request_hash,resource_id FROM warehouse_receipt WHERE user_id=? AND"
                + " resource_type=? AND idempotency_key=?",
            n(user),
            resource,
            key);
    if (rows.isEmpty()) return null;
    if (!rows.getFirst().get("request_hash").equals(hash))
      throw new Failure(409, "IDEMPOTENCY_CONFLICT");
    return get(resource, rows.getFirst().get("resource_id").toString(), user);
  }

  public void receipt(String user, String resource, String key, String hash, String id) {
    db.update(
        "INSERT INTO"
            + " warehouse_receipt(user_id,resource_type,idempotency_key,request_hash,resource_id)"
            + " VALUES (?,?,?,?,?)",
        n(user),
        resource,
        key,
        hash,
        n(id));
  }

  private long n(String id) {
    return IdentityService.numericId(id);
  }
}
