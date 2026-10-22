package cn.jiuzhang.platform.task.application;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import cn.jiuzhang.platform.shared.application.Failure;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class TaskService {
  private final TaskStore store;
  private final IdentityService identity;

  public TaskService(TaskStore store, IdentityService identity) {
    this.store = store;
    this.identity = identity;
  }

  public List<Map<String, Object>> list(User user) {
    IdentityService.require(user, "read");
    return store.list().stream().map(this::view).toList();
  }

  public Map<String, Object> get(User user, String id) {
    IdentityService.require(user, "read");
    return view(store.get(id));
  }

  public Map<String, Object> save(User user, String id, Map<String, Object> input, String requestId) {
    IdentityService.require(user, "write");
    if (input.isEmpty()) throw new Failure(422, "VALIDATION_ERROR");
    var saved = store.save(id, user.id(), input);
    identity.audit(user.id(), "patch", "task", id, requestId);
    return view(saved);
  }

  public Map<String, Object> setEnabled(User user, String id, boolean enabled, String requestId) {
    IdentityService.require(user, "write");
    var saved = store.setEnabled(id, enabled);
    identity.audit(user.id(), enabled ? "resume" : "pause", "task", id, requestId);
    return view(saved);
  }

  private Map<String, Object> view(Map<String, Object> task) {
    var result = new java.util.LinkedHashMap<String, Object>();
    for (String key : List.of("id", "name", "description", "owner", "tags", "updatedAt", "datasetId", "enabled", "schedule", "lastSuccessRunId", "lastSuccessAt", "nextRunAt"))
      result.put(key, task.get(key));
    return result;
  }
}
