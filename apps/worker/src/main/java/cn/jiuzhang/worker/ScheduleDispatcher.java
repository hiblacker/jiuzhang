package cn.jiuzhang.worker;

import cn.jiuzhang.platform.execution.application.RunStore;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.task.application.TaskStore;
import java.time.Instant;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ScheduleDispatcher {
  private final TaskStore tasks;
  private final RunStore runs;

  public ScheduleDispatcher(TaskStore tasks, RunStore runs) {
    this.tasks = tasks;
    this.runs = runs;
  }

  @Scheduled(fixedDelayString = "${JIUZHANG_SCHEDULER_INTERVAL_MS:1000}")
  public void dispatch() {
    for (var task : tasks.claimDue(Instant.now(), 20)) {
      String dataset = task.get("datasetId").toString();
      String scheduledAt = task.getOrDefault("_scheduledAt", Instant.now().toString()).toString();
      String key = "schedule:" + dataset + ":" + scheduledAt;
      try {
        runs.createScheduled(
            dataset,
            ((Number) task.get("datasetVersion")).intValue(),
            task.get("ownerId").toString(),
            key,
            dataset + ":" + scheduledAt,
            task.get("id").toString());
      } catch (Failure failure) {
        // A running dataset cannot accept a second snapshot. Retry the same slot soon;
        // idempotency keeps a crash between enqueue and this catch from duplicating work.
        tasks.reschedule(dataset, Instant.now().plusSeconds(30));
      } catch (RuntimeException failure) {
        tasks.reschedule(dataset, Instant.now().plusSeconds(60));
      }
    }
  }
}
