package cn.jiuzhang.worker;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cn.jiuzhang.platform.execution.application.RunStore;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import cn.jiuzhang.platform.task.infrastructure.JdbcTaskStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

class ScheduleDispatcherTest {
  private final JdbcTemplate db = mock(JdbcTemplate.class);
  private final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
  private final MetadataJson json = new MetadataJson(new ObjectMapper());
  private final JdbcTaskStore tasks = new JdbcTaskStore(db,new TransactionTemplate(transactions),json);
  private final RunStore runs = mock(RunStore.class);
  private final Instant due = Instant.parse("2026-10-30T00:00:00Z");
  private final AtomicReference<Instant> next = new AtomicReference<>(due);
  private Map<String,Object> schedule(int minutes) {
    return Map.of("mode","interval","cron","* * * * *","intervalMinutes",minutes,
        "timezone","Asia/Shanghai","retries",0,"timeoutSeconds",30,"concurrency",1,"dependencies",List.of());
  }
  @BeforeEach void databaseBoundary() {
    when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    var row = new HashMap<String,Object>();
    row.put("dataset_id",42L);row.put("published_version",2);row.put("owner_id",1L);row.put("enabled",true);row.put("revision",1L);
    row.put("name","atomic-test");row.put("description","");row.put("owner_label","test");row.put("tags","[]");
    row.put("schedule_json",json.write(schedule(1)));row.put("next_run_at",Timestamp.from(due));row.put("updated_at",Timestamp.from(due));
    when(db.queryForList(anyString())).thenReturn(List.of());
    when(db.queryForList(startsWith("SELECT s.dataset_id FROM"),eq(20))).thenReturn(List.of(Map.of("dataset_id",42L)));
    when(db.queryForList(contains("FOR UPDATE"),eq(42L))).thenReturn(List.of(row));
    when(db.queryForList(startsWith("SELECT d.id AS"),eq(42L))).thenReturn(List.of(row));
    var slot = new HashMap<String,Object>();
    slot.put("state","pending");slot.put("dataset_version",1);slot.put("requested_by",1L);slot.put("revision",1L);
    slot.put("expires_at",Timestamp.from(due.plusSeconds(60)));slot.put("schedule_snapshot",json.write(schedule(1)));
    when(db.queryForList(startsWith("SELECT * FROM dataset_schedule_slot"),eq(42L),eq(Timestamp.from(due)))).thenReturn(List.of(slot));
    when(db.queryForObject("SELECT clock_timestamp()",Timestamp.class)).thenReturn(Timestamp.from(due.plusSeconds(1)));
    doAnswer(call->{next.set(((Timestamp)call.getArgument(1)).toInstant());return 1;}).when(db)
        .update(startsWith("UPDATE dataset_schedule SET next_run_at="),any(),eq(42L),eq(1L),any());
  }

  @Test void enqueueFailureRollsBackWithoutAdvancingTheSlot() {
    when(runs.createScheduled(anyString(),anyInt(),anyString(),anyString(),anyString(),anyString(),anyMap(),any()))
        .thenThrow(new Failure(503,"INJECTED_ENQUEUE_FAILURE"));
    new ScheduleDispatcher(tasks,runs).dispatch();
    verify(runs).createScheduled(anyString(),eq(1),anyString(),anyString(),anyString(),anyString(),anyMap(),eq(due));
    assertThat(next.get()).as("failed enqueue must not consume the persisted slot").isEqualTo(due);
    verify(transactions).rollback(any());
    verify(transactions,never()).commit(any());
  }

  @Test void changingPlanClosesClaimedSlotWithAQueryableReason() {
    when(db.queryForObject(eq("SELECT ?::jsonb = ?::jsonb"),eq(Boolean.class),any(),any())).thenReturn(false);
    when(db.update(startsWith("UPDATE dataset_schedule_slot SET state='skipped'"),eq("SCHEDULE_CHANGED"),any(),eq(42L))).thenReturn(1);
    tasks.save("42","1",Map.of("schedule",schedule(2)));
    verify(db).update(startsWith("UPDATE dataset_schedule_slot SET state='skipped'"),eq("SCHEDULE_CHANGED"),any(),eq(42L));
    verify(transactions).commit(any());
  }

  @Test void anActiveRunRetainsTheCurrentSlotAndItsFrozenVersion() {
    when(runs.createScheduled(anyString(),anyInt(),anyString(),anyString(),anyString(),anyString(),anyMap(),any()))
        .thenThrow(new Failure(409,"DATASET_RUN_ACTIVE"));
    new ScheduleDispatcher(tasks,runs).dispatch();
    verify(runs).createScheduled(eq("42"),eq(1),eq("1"),anyString(),anyString(),eq("42"),eq(schedule(1)),eq(due));
    verify(db).update(contains("reason='DATASET_RUN_ACTIVE'"),eq(42L),eq(Timestamp.from(due)));
    verify(transactions).commit(any());
    assertThat(next.get()).isEqualTo(due);
  }
}
