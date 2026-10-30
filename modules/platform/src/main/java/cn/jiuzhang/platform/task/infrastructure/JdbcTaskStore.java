package cn.jiuzhang.platform.task.infrastructure;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import cn.jiuzhang.platform.task.application.TaskStore;
import cn.jiuzhang.platform.task.domain.ScheduleCalculator;
import cn.jiuzhang.platform.task.domain.ScheduleSlot;
import com.fasterxml.jackson.core.type.TypeReference;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class JdbcTaskStore implements TaskStore {
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final MetadataJson json;
  private final int activeBackoffSeconds;
  private final int slotRetentionDays;
  private static final int SLOT_CLEANUP_BATCH = 500;

  public JdbcTaskStore(JdbcTemplate db, TransactionTemplate tx, MetadataJson json,
      @Value("${JIUZHANG_SCHEDULE_ACTIVE_BACKOFF_SECONDS:5}") int activeBackoffSeconds,
      @Value("${JIUZHANG_SCHEDULE_SLOT_RETENTION_DAYS:30}") int slotRetentionDays) {
    if (activeBackoffSeconds < 1 || slotRetentionDays < 1)
      throw new IllegalArgumentException("Schedule backoff seconds and slot retention days must be positive");
    this.db = db;
    this.tx = tx;
    this.json = json;
    this.activeBackoffSeconds = activeBackoffSeconds;
    this.slotRetentionDays = slotRetentionDays;
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
          boolean changed = !Boolean.TRUE.equals(db.queryForObject("SELECT ?::jsonb = ?::jsonb",Boolean.class,json.write(schedule),json.write(current.get("schedule"))));
          Instant now = clock();
          Instant next = !changed
              ? parseInstant(current.get("nextRunAt"))
              : nextRun(schedule, enabled, now);
          if (changed) skipCurrent(current,"SCHEDULE_CHANGED",now,next);
          db.update(
              "UPDATE dataset_schedule SET owner_id=?,name=?,description=?,owner_label=?,tags=?::jsonb,schedule=?::jsonb,next_run_at=?,revision=revision+?,updated_at=now() WHERE dataset_id=?",
              n(ownerId),
              name,
              description,
              owner,
              json.write(tags),
              json.write(schedule),
              next == null ? null : java.sql.Timestamp.from(next), changed ? 1 : 0, n(id));
          return get(id);
        });
  }

  @Override
  public Map<String, Object> setEnabled(String id, boolean enabled) {
    return tx.execute(
        status -> {
          var current = read(id, true);
          boolean changed = enabled != Boolean.TRUE.equals(current.get("enabled"));
          Instant now = clock();
          Instant next = !enabled ? null
              : Boolean.TRUE.equals(current.get("enabled"))
                  ? parseInstant(current.get("nextRunAt"))
                  : nextRun(cast(current.get("schedule")), true, now);
          if(changed)skipCurrent(current,enabled?"RESUMED":"PAUSED",now,next);
          db.update(
              "UPDATE dataset_schedule SET enabled=?,next_run_at=?,revision=revision+?,updated_at=now() WHERE dataset_id=?",
              enabled,
              next == null ? null : java.sql.Timestamp.from(next),
              changed ? 1 : 0,
              n(id));
          return get(id);
        });
  }

  @Override
  public List<String> due(int limit) {
    if(limit<1||limit>20)throw new IllegalArgumentException("Dispatch batch must be between 1 and 20");
    ensureRows();
    return db.queryForList("SELECT s.dataset_id FROM dataset_schedule s JOIN dataset d ON d.id=s.dataset_id WHERE "
        + warehouseDatasetClause()+" AND d.published_version>0 AND s.enabled AND s.next_run_at<=clock_timestamp()"
        + " AND (s.schedule->>'mode') IN ('cron','interval')"
        + " AND NOT EXISTS (SELECT 1 FROM dataset_schedule_slot p WHERE p.dataset_id=s.dataset_id"
        + " AND p.scheduled_at=s.next_run_at AND p.state='pending' AND p.reason='DATASET_RUN_ACTIVE'"
        + " AND p.updated_at>clock_timestamp()-make_interval(secs => ?) AND p.expires_at>=clock_timestamp())"
        + " ORDER BY s.next_run_at,s.dataset_id LIMIT ?",activeBackoffSeconds,limit)
        .stream().map(row->row.get("dataset_id").toString()).toList();
  }

  @Override
  public void dispatch(String id, Function<ScheduleSlot,String> enqueue) {
    tx.executeWithoutResult(status->{
      db.execute("SET LOCAL statement_timeout='5s'");
      db.execute("SET LOCAL lock_timeout='1s'");
      // Manual admission also locks dataset first. Never lock an active run here: completion
      // locks its run before updating last_success on the schedule.
      if(db.queryForList("SELECT id FROM dataset WHERE id=? FOR UPDATE SKIP LOCKED",n(id)).isEmpty())return;
      var rows=db.queryForList(baseSql()+" WHERE d.id=? FOR UPDATE OF s SKIP LOCKED",n(id));
      if(rows.isEmpty())return;
      var current=task(rows.getFirst());
      Instant now=clock(),at=parseInstant(current.get("nextRunAt"));
      if(!Boolean.TRUE.equals(current.get("enabled"))||at==null||at.isAfter(now))return;
      var schedule=cast(current.get("schedule"));
      long revision=((Number)current.get("_revision")).longValue();
      var stale=db.queryForList("SELECT scheduled_at FROM dataset_schedule_slot WHERE dataset_id=? AND state='pending' AND (scheduled_at<>? OR revision<>?)",n(id),ts(at),revision);
      if(!stale.isEmpty())db.update("UPDATE dataset_schedule_slot SET state='skipped',reason='CONDITION_CHANGED',advanced_to=?,updated_at=now() WHERE dataset_id=? AND state='pending'",ts(at),n(id));
      var recorded=db.queryForList("SELECT * FROM dataset_schedule_slot WHERE dataset_id=? AND scheduled_at=?",n(id),ts(at));
      if(!recorded.isEmpty()&&!recorded.getFirst().get("state").equals("pending")) {
        updateCursor(current,at,ScheduleCalculator.firstFuture(schedule,at,now));return;
      }
      if(recorded.isEmpty()) {
        insertSlot(current,at,"pending","",null);
        recorded=db.queryForList("SELECT * FROM dataset_schedule_slot WHERE dataset_id=? AND scheduled_at=?",n(id),ts(at));
      }
      var record=recorded.getFirst();
      var slot=new ScheduleSlot(id,((Number)record.get("dataset_version")).intValue(),record.get("requested_by").toString(),
          ((Number)record.get("revision")).longValue(),at,((java.sql.Timestamp)record.get("expires_at")).toInstant(),cast(record.get("schedule_snapshot")));
      if(now.isAfter(slot.expiresAt())) {
        Instant next=ScheduleCalculator.firstFuture(slot.schedule(),at,now);
        skipSlot(id,at,"EXPIRED",next);updateCursor(current,at,next);return;
      }
      // Recheck under the plan lock: another Worker may hold a candidate selected before
      // the previous busy attempt committed. Expiry above always takes priority over backoff.
      if ("DATASET_RUN_ACTIVE".equals(record.get("reason"))
          && ((java.sql.Timestamp)record.get("updated_at")).toInstant()
              .plusSeconds(activeBackoffSeconds).isAfter(now)) return;
      String runId;
      try {runId=enqueue.apply(slot);}
      catch(Failure failure) {
        if(failure.code.equals("DATASET_RUN_ACTIVE")) {
          db.update("UPDATE dataset_schedule_slot SET reason='DATASET_RUN_ACTIVE',attempts=attempts+1,updated_at=clock_timestamp() WHERE dataset_id=? AND scheduled_at=?",n(id),ts(at));return;
        }
        if(!failure.code.equals("IDEMPOTENCY_CONFLICT"))throw failure;
        skipSlot(id,at,"IDEMPOTENCY_CONFLICT",slot.expiresAt());updateCursor(current,at,slot.expiresAt());return;
      }
      int changed=db.update("UPDATE dataset_schedule_slot SET state='enqueued',reason='',run_id=?,advanced_to=?,attempts=attempts+1,updated_at=now() WHERE dataset_id=? AND scheduled_at=? AND state='pending'",n(runId),ts(slot.expiresAt()),n(id),ts(at));
      if(changed!=1)throw new IllegalStateException("Schedule slot changed inside admission transaction");
      updateCursor(current,at,slot.expiresAt());
    });
  }

  @Override
  public int cleanupSlots() {
    return db.update("WITH expired AS (SELECT dataset_id,scheduled_at FROM dataset_schedule_slot"
        + " WHERE state IN ('enqueued','skipped') AND advanced_to<clock_timestamp()-make_interval(days => ?)"
        + " ORDER BY advanced_to,dataset_id,scheduled_at LIMIT ? FOR UPDATE SKIP LOCKED)"
        + " DELETE FROM dataset_schedule_slot s USING expired e"
        + " WHERE s.dataset_id=e.dataset_id AND s.scheduled_at=e.scheduled_at",slotRetentionDays,SLOT_CLEANUP_BATCH);
  }

  private void updateCursor(Map<String,Object> current,Instant at,Instant next) {
    int changed=db.update("UPDATE dataset_schedule SET next_run_at=?,updated_at=now() WHERE dataset_id=? AND revision=? AND next_run_at IS NOT DISTINCT FROM ?",
        ts(next),n(current.get("id").toString()),current.get("_revision"),ts(at));
    if(changed!=1)throw new IllegalStateException("Schedule cursor changed inside admission transaction");
  }

  private void insertSlot(Map<String,Object> current,Instant at,String state,String reason,Instant advanced) {
    var schedule=cast(current.get("schedule"));
    Instant expires=ScheduleCalculator.next(schedule,at);
    if(expires==null)throw new Failure(422,"SCHEDULE_INVALID");
    db.update("INSERT INTO dataset_schedule_slot(dataset_id,scheduled_at,revision,dataset_version,requested_by,schedule_snapshot,expires_at,state,reason,advanced_to) VALUES (?,?,?,?,?,?::jsonb,?,?,?,?) ON CONFLICT(dataset_id,scheduled_at) DO NOTHING",
        n(current.get("id").toString()),ts(at),current.get("_revision"),current.get("datasetVersion"),n(current.get("ownerId").toString()),json.write(schedule),ts(expires),state,reason,ts(advanced));
  }

  private void skipSlot(String id,Instant at,String reason,Instant next) {
    int changed=db.update("UPDATE dataset_schedule_slot SET state='skipped',reason=?,advanced_to=?,updated_at=now() WHERE dataset_id=? AND scheduled_at=? AND state='pending'",reason,ts(next),n(id),ts(at));
    if(changed!=1)throw new IllegalStateException("Pending schedule slot changed inside transaction");
  }

  private void skipCurrent(Map<String,Object> current,String reason,Instant now,Instant next) {
    int changed=db.update("UPDATE dataset_schedule_slot SET state='skipped',reason=?,advanced_to=?,updated_at=now() WHERE dataset_id=? AND state='pending'",reason,ts(next),n(current.get("id").toString()));
    Instant at=parseInstant(current.get("nextRunAt"));
    if(changed==0&&Boolean.TRUE.equals(current.get("enabled"))&&at!=null&&!at.isAfter(now))insertSlot(current,at,"skipped",reason,next);
  }

  private Instant clock(){return db.queryForObject("SELECT clock_timestamp()",java.sql.Timestamp.class).toInstant();}
  private java.sql.Timestamp ts(Instant value){return value==null?null:java.sql.Timestamp.from(value);}

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
    Instant now = clock();
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
    return "SELECT d.id AS dataset_id,d.name AS dataset_name,d.description AS dataset_description,d.owner_label AS dataset_owner,d.tags AS dataset_tags,d.published_version,s.owner_id,s.enabled,s.name,s.description,s.owner_label,s.tags,s.schedule AS schedule_json,s.next_run_at,s.last_success_run_id,s.last_success_at,s.updated_at,s.revision FROM dataset d JOIN dataset_schedule s ON s.dataset_id=d.id";
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
    m.put("_revision", row.get("revision"));
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
