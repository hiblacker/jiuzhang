package cn.jiuzhang.platform.task.domain;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Pure schedule validation and next-fire calculation shared by API and Worker. */
public final class ScheduleCalculator {
  private ScheduleCalculator() {}

  public static void validate(Map<String, Object> schedule) {
    String mode = text(schedule, "mode");
    if (!Set.of("manual", "cron", "interval").contains(mode)) throw invalid();
    try {
      ZoneId.of(text(schedule, "timezone"));
    } catch (RuntimeException e) {
      throw invalid();
    }
    int retries = integer(schedule, "retries");
    int timeout = integer(schedule, "timeoutSeconds");
    int concurrency = integer(schedule, "concurrency");
    if (retries < 0 || retries > 10 || timeout < 1 || timeout > 86400 || concurrency < 1 || concurrency > 10)
      throw invalid();
    if (mode.equals("interval")) {
      int minutes = integer(schedule, "intervalMinutes");
      if (minutes < 1 || minutes > 525600) throw invalid();
    }
    if (mode.equals("cron")) parseCron(text(schedule, "cron"));
    if (!(schedule.get("dependencies") instanceof List<?> deps)
        || deps.stream().anyMatch(x -> !(x instanceof String)))
      throw invalid();
  }

  public static Instant next(Map<String, Object> schedule, Instant after) {
    validate(schedule);
    String mode = text(schedule, "mode");
    if (mode.equals("manual")) return null;
    if (mode.equals("interval"))
      return after.plusSeconds(integer(schedule, "intervalMinutes") * 60L).truncatedTo(ChronoUnit.MICROS);
    ZoneId zone = ZoneId.of(text(schedule, "timezone"));
    Cron cron = parseCron(text(schedule, "cron"));
    Instant cursor = Instant.ofEpochSecond((after.getEpochSecond() / 60L + 1L) * 60L);
    long max = cursor.plusSeconds(8L * 366L * 86400L).getEpochSecond();
    for (Instant candidate = cursor; candidate.getEpochSecond() <= max; candidate = candidate.plusSeconds(60)) {
      ZonedDateTime local = candidate.atZone(zone);
      if (cron.matches(local)) return candidate;
    }
    return null;
  }

  private static Cron parseCron(String expression) {
    if (expression == null || expression.isBlank()) throw invalid();
    String[] fields = expression.trim().split("\\s+");
    if (fields.length != 5) throw invalid();
    return new Cron(
        expand(fields[0], 0, 59),
        expand(fields[1], 0, 23),
        expand(fields[2], 1, 31),
        expand(fields[3], 1, 12),
        expand(fields[4], 0, 7),
        fields[2].startsWith("*"),
        fields[4].startsWith("*"));
  }

  private static Set<Integer> expand(String expression, int min, int max) {
    Set<Integer> values = new HashSet<>();
    for (String part : expression.split(",", -1)) {
      String[] stepped = part.split("/", -1);
      if (stepped.length > 2 || stepped[0].isBlank()) throw invalid();
      int step = stepped.length == 2 ? number(stepped[1]) : 1;
      if (step < 1 || step > max - min + 1) throw invalid();
      String range = stepped[0];
      String[] bounds = range.split("-", -1);
      if (bounds.length > 2) throw invalid();
      int start = bounds[0].equals("*") ? min : number(bounds[0]);
      int end = bounds.length == 2 ? number(bounds[1]) : (bounds[0].equals("*") || stepped.length == 2 ? max : start);
      if (start < min || end > max || start > end) throw invalid();
      for (int value = start; value <= end; value += step) values.add(value);
    }
    if (values.isEmpty()) throw invalid();
    if (max == 7 && values.contains(7)) values.add(0);
    return values;
  }

  private record Cron(
      Set<Integer> minute,
      Set<Integer> hour,
      Set<Integer> day,
      Set<Integer> month,
      Set<Integer> weekday,
      boolean dayWildcard,
      boolean weekdayWildcard) {
    boolean matches(ZonedDateTime time) {
      if (!minute.contains(time.getMinute())
          || !hour.contains(time.getHour())
          || !month.contains(time.getMonthValue())) return false;
      boolean dayMatch = day.contains(time.getDayOfMonth());
      int javaWeekday = time.getDayOfWeek().getValue() % 7;
      boolean weekMatch = weekday.contains(javaWeekday);
      return dayWildcard || weekdayWildcard ? dayMatch && weekMatch : dayMatch || weekMatch;
    }
  }

  private static String text(Map<String, Object> map, String key) {
    Object value = map.get(key);
    if (!(value instanceof String s) || s.isBlank()) throw invalid();
    return s;
  }

  private static int integer(Map<String, Object> map, String key) {
    Object value = map.get(key);
    if (!(value instanceof Number n)
        || !Double.isFinite(n.doubleValue())
        || n.doubleValue() != Math.rint(n.doubleValue())
        || n.doubleValue() < Integer.MIN_VALUE
        || n.doubleValue() > Integer.MAX_VALUE) throw invalid();
    return n.intValue();
  }

  private static int number(String value) {
    try {
      if (!value.matches("[0-9]+")) throw invalid();
      return Integer.parseInt(value);
    } catch (NumberFormatException e) {
      throw invalid();
    }
  }

  private static IllegalArgumentException invalid() {
    return new IllegalArgumentException("invalid schedule");
  }
}
