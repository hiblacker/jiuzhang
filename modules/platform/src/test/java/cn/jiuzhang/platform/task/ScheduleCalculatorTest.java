package cn.jiuzhang.platform.task;

import static org.assertj.core.api.Assertions.assertThat;

import cn.jiuzhang.platform.task.domain.ScheduleCalculator;
import java.time.Instant;
import java.util.Map;
import java.util.List;
import org.junit.jupiter.api.Test;

class ScheduleCalculatorTest {
  private static Map<String, Object> schedule(String mode, String cron, int interval) {
    return Map.of(
        "mode", mode,
        "cron", cron,
        "intervalMinutes", interval,
        "timezone", "Asia/Shanghai",
        "retries", 0,
        "timeoutSeconds", 600,
        "concurrency", 1,
        "dependencies", List.of());
  }

  @Test
  void calculatesIntervalFromThePersistedInstant() {
    assertThat(ScheduleCalculator.next(schedule("interval", "0 9 * * *", 15), Instant.parse("2026-10-22T00:00:00Z")))
        .isEqualTo(Instant.parse("2026-10-22T00:15:00Z"));
  }

  @Test
  void calculatesCronInTheConfiguredTimezone() {
    assertThat(ScheduleCalculator.next(schedule("cron", "0 9 * * *", 60), Instant.parse("2026-10-21T23:30:00Z")))
        .isEqualTo(Instant.parse("2026-10-22T01:00:00Z"));
  }

  @Test
  void numericCronStepsContinueThroughTheRemainderOfTheirField() {
    var stepped = schedule("cron", "5/10 9 * * *", 60);
    assertThat(ScheduleCalculator.next(stepped, Instant.parse("2026-10-22T00:59:00Z")))
        .isEqualTo(Instant.parse("2026-10-22T01:05:00Z"));
    assertThat(ScheduleCalculator.next(stepped, Instant.parse("2026-10-22T01:05:00Z")))
        .isEqualTo(Instant.parse("2026-10-22T01:15:00Z"));
  }
}
