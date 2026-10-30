package cn.jiuzhang.platform.task.application;

import cn.jiuzhang.platform.task.domain.ScheduleSlot;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

public interface TaskStore {
  List<Map<String, Object>> list();

  Map<String, Object> get(String id);

  Map<String, Object> save(String id, String ownerId, Map<String, Object> input);

  Map<String, Object> setEnabled(String id, boolean enabled);

  List<String> due(int limit);

  /** Executes enqueue inside the same PostgreSQL transaction as the claim and cursor update. */
  void dispatch(String id, Function<ScheduleSlot,String> enqueue);
}
