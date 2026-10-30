package cn.jiuzhang.worker;

import cn.jiuzhang.platform.execution.application.RunStore;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.task.application.TaskStore;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ScheduleDispatcher {
  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(ScheduleDispatcher.class);
  private final TaskStore tasks;
  private final RunStore runs;

  public ScheduleDispatcher(TaskStore tasks, RunStore runs) { this.tasks = tasks; this.runs = runs; }

  @Scheduled(fixedDelayString = "${JIUZHANG_SCHEDULER_INTERVAL_MS:1000}", scheduler = "datasetScheduleScheduler")
  public void dispatch() {
    java.util.List<String> due;
    try { due = tasks.due(20); }
    catch (RuntimeException failure) { LOG.warn("Schedule poll failed ({})",failure.getClass().getSimpleName()); return; }
    for (String dataset : due) {
      try {
        tasks.dispatch(dataset, slot -> runs.createScheduled(
            slot.datasetId(), slot.datasetVersion(), slot.requestedBy(), slot.key(),
            IdentityService.hash(slot.key()+":"+slot.datasetVersion()+":"+slot.revision()),
            slot.datasetId(), slot.schedule(), slot.scheduledAt()).get("id").toString());
      } catch (RuntimeException failure) {
        // The whole claim transaction rolled back. The persisted slot remains due.
        LOG.warn("Schedule admission rolled back for dataset {} ({})", dataset, failure.getClass().getSimpleName());
      }
    }
  }
}
