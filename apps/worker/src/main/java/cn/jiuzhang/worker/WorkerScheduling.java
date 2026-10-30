package cn.jiuzhang.worker;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** Isolate admission from long engine calls without increasing execution concurrency. */
@Configuration
public class WorkerScheduling {
  @Bean(name = "taskScheduler")
  ThreadPoolTaskScheduler executionScheduler() { return scheduler("worker-loop-"); }
  @Bean(name = "datasetScheduleScheduler")
  ThreadPoolTaskScheduler datasetScheduleScheduler() { return scheduler("schedule-dispatch-"); }
  private ThreadPoolTaskScheduler scheduler(String prefix) {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(1);
    scheduler.setThreadNamePrefix(prefix);
    scheduler.setRemoveOnCancelPolicy(true);
    return scheduler;
  }
}
