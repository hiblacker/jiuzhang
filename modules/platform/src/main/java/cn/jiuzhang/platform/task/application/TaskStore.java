package cn.jiuzhang.platform.task.application;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public interface TaskStore {
  List<Map<String, Object>> list();

  Map<String, Object> get(String id);

  Map<String, Object> save(String id, String ownerId, Map<String, Object> input);

  Map<String, Object> setEnabled(String id, boolean enabled);

  List<Map<String, Object>> claimDue(Instant now, int limit);

  void reschedule(String id, Instant next);
}
