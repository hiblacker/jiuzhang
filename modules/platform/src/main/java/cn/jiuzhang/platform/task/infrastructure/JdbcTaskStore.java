package cn.jiuzhang.platform.task.infrastructure;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import cn.jiuzhang.platform.task.application.TaskStore;
import cn.jiuzhang.platform.task.domain.ScheduleCalculator;
import com.fasterxml.jackson.core.type.TypeReference;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class JdbcTaskStore implements TaskStore {
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final MetadataJson json;

  public JdbcTaskStore(JdbcTemplate db, TransactionTemplate tx, MetadataJson json) {
    this.db = db;
    this.tx = tx;
    this.json = json;
  }

  @Override
  public List<Map<String, Object>> list() {
    ensureRows();
    return db.queryForList(
            baseSql()
                + " WHERE "
                + warehouseDatasetClause()
                + " AND d.published_version>0 ORDER BY d.id DESC")
        .stream()
        .map(this::task)
        .toList();
  }

  @Override
  public Map<String, Object> get(String id) {
    return read(id, false);
  }

  private Map<String, Object> read(String id, boolean lock) {
    ensureRows();
    var rows =
        db.queryForList(
            baseSql()
                + " WHERE "
                + warehouseDatasetClause()
                + " AND d.published_version>0 AND d.id=?"
                + (lock ? " FOR UPDATE OF s" : ""),
            n(id));
    if (rows.isEmpty()) throw new Failure(404, "TASK_NOT_FOUND");
    return task(rows.getFirst());
  }

  @Override
  public Map<String, Object> save(String id, String ownerId, Map<String, Object> input) {
    return tx.execute(
        status -> {
          var current = read(id, true);
          Object scheduleValue =
              input.containsKey("schedule") ? input.get("schedule") : current.get("schedule");
          if (!(scheduleValue instanceof Map<?, ?>))
            throw new Failure(422, "SCHEDULE_INVALID");
          var schedule = cast(scheduleValue);
          try {
            ScheduleCalculator.validate(schedule);
          } catch (IllegalArgumentException e) {
            throw new Failure(422, "SCHEDULE_INVALID");
          }
          if (((Number) schedule.get("timeoutSeconds")).intValue() > 600)
            throw new Failure(422, "TIMEOUT_LIMIT");
          Object dependencies = schedule.get("dependencies");
          if (((Number) schedule.get("retries")).intValue() != 0
              || ((Number) schedule.get("concurrency")).intValue() != 1
              || !(dependencies instanceof List<?> list)
              || !list.isEmpty())
            throw new Failure(422, "SCHEDULE_FEATURE_UNSUPPORTED");
          String name = string(input, "name", current.get("name"));
          String description = string(input, "description", current.get("description"));
          String owner = string(input, "owner", current.get("owner"));
          List<String> tags =
              strings(input.containsKey("tags") ? input.get("tags") : current.get("tags"));
          boolean enabled = Boolean.TRUE.equals(current.get("enabled"));
          Instant next = schedule.equals(current.get("schedule"))
              ? parseInstant(current.get("nextRunAt"))
              : nextRun(schedule, enabled, Instant.now());
          db.update(
              "UPDATE dataset_schedule SET owner_id=?,name=?,description=?,owner_label=?,tags=?::jsonb,schedule=?::jsonb,next_run_at=?,updated_at=now() WHERE dataset_id=?",
              n(ownerId),
              name,
              description,
              owner,
              json.write(tags),
              json.write(schedule),
              next == null ? null : java.sql.Timestamp.from(next), n(id));
          return get(id);
        });
  }

  @Override
  public Map<String, Object> setEnabled(String id, boolean enabled) {
    return tx.execute(
        status -> {
          var current = read(id, true);
          Instant next = !enabled ? null
              : Boolean.TRUE.equals(current.get("enabled"))
                  ? parseInstant(current.get("nextRunAt"))
                  : nextRun(cast(current.get("schedule")), true, Instant.now());
          db.update(
              "UPDATE dataset_schedule SET enabled=?,next_run_at=?,updated_at=now() WHERE dataset_id=?",
              enabled,
              next == null ? null : java.sql.Timestamp.from(next),
              n(id));
          return get(id);
        });
  }

  @Override
  public List<Map<String, Object>> claimDue(Instant now, int limit) {
    return tx.execute(
        status -> {
          ensureRows();
          var rows =
              db.queryForList(
                  baseSql()
                      + " WHERE "
                      + warehouseDatasetClause()
                      + " AND d.published_version>0 AND s.enabled AND s.next_run_at IS NOT NULL AND s.next_run_at<=?"
                      + " AND (s.schedule->>'mode') IN ('cron','interval')"
                      + " ORDER BY s.next_run_at,d.id FOR UPDATE OF s SKIP LOCKED LIMIT ?",
                  java.sql.Timestamp.from(now),
                  limit);
          var claimed = new ArrayList<Map<String, Object>>();
          for (var row : rows) {
            var schedule = cast(row.get("schedule_json"));
            Instant scheduledAt = ((java.sql.Timestamp) row.get("next_run_at")).toInstant();
            Instant next = ScheduleCalculator.next(schedule, now);
            db.update("UPDATE dataset_schedule SET next_run_at=?,updated_at=now() WHERE dataset_id=?", next == null ? null : java.sql.Timestamp.from(next), n(row.get("dataset_id").toString()));
            var claimedTask = task(row);
            claimedTask.put("_scheduledAt", scheduledAt.toString());
            claimedTask.put("_claimedNextRunAt", next);
            claimed.add(claimedTask);
          }
          return claimed;
        });
  }

  @Override
  public void reschedule(String id, Instant expectedNext, Map<String, Object> expectedSchedule, Instant next) {
    db.update(
        "UPDATE dataset_schedule SET next_run_at=?,updated_at=now() WHERE dataset_id=? AND enabled AND next_run_at IS NOT DISTINCT FROM ? AND schedule=?::jsonb",
        next == null ? null : java.sql.Timestamp.from(next),
        n(id),
        expectedNext == null ? null : java.sql.Timestamp.from(expectedNext),
        json.write(expectedSchedule));
  }

  private void ensureRows() {
    db.update(
        "INSERT INTO dataset_schedule(dataset_id,owner_id,name,description,owner_label,tags,schedule)"
            + " SELECT d.id,(SELECT min(id) FROM account),d.name,d.description,d.owner_label,d.tags,"
            + " COALESCE(v.body->'definition'->'schedule',d.definition->'schedule')"
            + " FROM dataset d JOIN dataset_version v ON v.dataset_id=d.id AND v.version=d.published_version"
            + " WHERE "
            + warehouseDatasetClause()
            + " AND d.published_version>0 AND NOT EXISTS (SELECT 1 FROM dataset_schedule s WHERE s.dataset_id=d.id)"
            + " ON CONFLICT (dataset_id) DO NOTHING");
    Instant now = Instant.now();
    var rows =
        db.queryForList(
            "SELECT s.dataset_id,s.schedule FROM dataset_schedule s JOIN dataset d ON d.id=s.dataset_id"
                + " WHERE "
                + warehouseDatasetClause()
                + " AND s.enabled AND s.next_run_at IS NULL AND (s.schedule->>'mode') IN ('cron','interval')");
    for (var row : rows) {
      Instant next = nextRun(cast(row.get("schedule")), true, now);
      if (next != null)
        db.update(
            "UPDATE dataset_schedule SET next_run_at=?,updated_at=now() WHERE dataset_id=? AND enabled AND next_run_at IS NULL AND schedule=?::jsonb",
            java.sql.Timestamp.from(next),
            n(row.get("dataset_id").toString()),
            json.write(cast(row.get("schedule"))));
    }
  }

  private String baseSql() {
    return "SELECT d.id AS dataset_id,d.name AS dataset_name,d.description AS dataset_description,d.owner_label AS dataset_owner,d.tags AS dataset_tags,d.published_version,s.owner_id,s.enabled,s.name,s.description,s.owner_label,s.tags,s.schedule AS schedule_json,s.next_run_at,s.last_success_run_id,s.last_success_at,s.updated_at FROM dataset d JOIN dataset_schedule s ON s.dataset_id=d.id";
  }

  private String warehouseDatasetClause() {
    return "COALESCE(d.definition->>'deliveryMode','warehouse')<>'direct'";
  }

  private Instant nextRun(Map<String, Object> schedule, boolean enabled, Instant now) {
    if (!enabled || "manual".equals(schedule.get("mode"))) return null;
    return ScheduleCalculator.next(schedule, now);
  }

  private Map<String, Object> task(Map<String, Object> row) {
    var m = new LinkedHashMap<String, Object>();
    m.put("id", row.get("dataset_id").toString());
    m.put("name", row.get("name"));
    m.put("description", row.get("description"));
    m.put("owner", row.get("owner_label"));
    m.put("tags", json.read(row.get("tags").toString(), new TypeReference<List<String>>() {}));
    m.put("updatedAt", instant(row.get("updated_at")));
    m.put("datasetId", row.get("dataset_id").toString());
    m.put("enabled", row.get("enabled"));
    m.put("schedule", cast(row.get("schedule_json")));
    m.put("lastSuccessRunId", row.get("last_success_run_id") == null ? "" : row.get("last_success_run_id").toString());
    m.put("lastSuccessAt", instant(row.get("last_success_at")));
    m.put("nextRunAt", instant(row.get("next_run_at")));
    m.put("datasetVersion", row.get("published_version"));
    m.put("ownerId", row.get("owner_id") == null ? "" : row.get("owner_id").toString());
    return m;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> cast(Object value) {
    if (value instanceof Map<?, ?> map) return (Map<String, Object>) map;
    return json.object(value);
  }

  private List<String> strings(Object value) {
    if (!(value instanceof List<?> list)) throw new Failure(422, "VALIDATION_ERROR");
    return list.stream().map(x -> {
      if (!(x instanceof String s)) throw new Failure(422, "VALIDATION_ERROR");
      return s;
    }).toList();
  }

  private String string(Map<String, Object> input, String key, Object fallback) {
    Object value = input.containsKey(key) ? input.get(key) : fallback;
    if (!(value instanceof String s) || s.length() > 2000) throw new Failure(422, "VALIDATION_ERROR");
    return s;
  }

  private String instant(Object value) {
    return value == null ? null : ((java.sql.Timestamp) value).toInstant().toString();
  }

  private Instant parseInstant(Object value) {
    return value == null ? null : Instant.parse(value.toString());
  }

  private long n(String id) {
    return IdentityService.numericId(id);
  }
}
