package cn.jiuzhang.platform.task.domain;

import java.time.Instant;
import java.util.Map;

/** The first committed claim freezes identity and configuration until enqueue or skip. */
public record ScheduleSlot(String datasetId, int datasetVersion, String requestedBy, long revision,
                           Instant scheduledAt, Instant expiresAt, Map<String,Object> schedule) {
  public ScheduleSlot { schedule = Map.copyOf(schedule); }
  public String key() { return "schedule:" + datasetId + ":" + scheduledAt; }
}
