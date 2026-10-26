package cn.jiuzhang.platform.execution.application;

import cn.jiuzhang.platform.dataset.application.DatasetStore;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import cn.jiuzhang.platform.shared.application.Failure;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class RunService {
  private final RunStore store;
  private final DatasetStore datasets;
  private final IdentityService identity;

  public RunService(RunStore store, DatasetStore datasets, IdentityService identity) {
    this.store = store;
    this.datasets = datasets;
    this.identity = identity;
  }

  public Map<String, Object> start(
      User user, String dataset, boolean allow, String key, String retry, String requestId) {
    return start(user, dataset, allow, key, retry, requestId, null);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> start(
      User user,
      String dataset,
      boolean allow,
      String key,
      String retry,
      String requestId,
      Map<String, Object> scheduleOverride) {
    IdentityService.require(user, "write");
    if (allow) IdentityService.require(user, "system");
    if (key == null || !key.matches("[a-zA-Z0-9_.:-]{1,100}"))
      throw new Failure(422, "IDEMPOTENCY_KEY_REQUIRED");

    return store.transaction(
        () -> {
          store.lockDataset(dataset);
          var current = datasets.get(dataset, false);
          int version = ((Number) current.get("publishedVersion")).intValue();
          Map<String, Object> retrySchedule = null;
          if (retry != null) {
            var previous = store.get(retry, false);
            if (!previous.get("datasetId").equals(dataset)
                || !List.of("failed", "blocked", "canceled").contains(previous.get("status")))
              throw new Failure(409, "RUN_NOT_RETRYABLE");
            version = ((Number) previous.get("datasetVersion")).intValue();
            retrySchedule = (Map<String, Object>) previous.get("scheduleSnapshot");
          }
          if (version < 1) throw new Failure(409, "DATASET_NOT_PUBLISHED");

          Object savedDefinition = datasets.version(dataset, version).get("definition");
          if (savedDefinition instanceof Map<?, ?> definition
              && "direct".equals(definition.get("deliveryMode")))
            throw new Failure(409, "DATASET_NOT_RUNNABLE");

          Map<String, Object> definition = (Map<String, Object>) savedDefinition;
          Map<String, Object> schedule =
              scheduleOverride != null
                  ? scheduleOverride
                  : retrySchedule != null
                      ? retrySchedule
                      : (Map<String, Object>) definition.get("schedule");
          String hash = IdentityService.hash("allow=" + allow + ";retry=" + retry);
          var existing = store.existing(user.id(), dataset, key);
          if (existing != null) {
            if (!existing.get("requestHash").equals(hash))
              throw new Failure(409, "IDEMPOTENCY_CONFLICT");
            return view(existing);
          }

          var run = store.create(dataset, version, user.id(), key, hash, allow, retry, schedule);
          identity.audit(user.id(), allow ? "run_allow_empty" : "run", "dataset", dataset, requestId);
          return view(run);
        });
  }

  @SuppressWarnings("unchecked")
  public Map<String, Object> retry(
      User user, String id, boolean allow, String key, String request) {
    var previous = store.get(id, false);
    return start(
        user,
        previous.get("datasetId").toString(),
        allow,
        key,
        id,
        request,
        (Map<String, Object>) previous.get("scheduleSnapshot"));
  }

  public List<Map<String, Object>> list(User user) {
    IdentityService.require(user, "read");
    return store.list().stream().map(this::view).toList();
  }

  public Map<String, Object> get(User user, String id) {
    IdentityService.require(user, "read");
    return view(store.get(id, false));
  }

  public Map<String, Object> cancel(User user, String id, String request) {
    IdentityService.require(user, "write");
    return store.transaction(
        () -> {
          var run = store.get(id, true);
          if (!List.of("queued", "running", "validating").contains(run.get("status")))
            throw new Failure(409, "RUN_NOT_CANCELABLE");
          store.cancel(id);
          identity.audit(user.id(), "cancel", "run", id, request);
          return view(store.get(id, false));
        });
  }

  private Map<String, Object> view(Map<String, Object> run) {
    var result = new LinkedHashMap<String, Object>();
    for (String key :
        List.of(
            "id",
            "datasetId",
            "datasetName",
            "datasetVersion",
            "retryOf",
            "status",
            "startedAt",
            "rowCount",
            "logs",
            "qualityResults",
            "errorCode")) result.put(key, run.get(key));
    for (String key : List.of("finishedAt", "executionStartedAt"))
      result.put(key, run.get(key));

    String status = run.get("status").toString();
    result.put("outcome", status.equals("blocked") ? "blocked" : status.equals("failed") ? "failed" : "succeeded");
    result.put("taskId", run.getOrDefault("taskId", ""));
    result.put(
        "trigger",
        run.getOrDefault(
            "trigger", run.get("retryOf").toString().isEmpty() ? "manual" : "retry"));
    result.put("businessDate", run.getOrDefault("businessDate", null));
    result.put(
        "durationMs",
        Duration.between(
                Instant.parse(run.get("startedAt").toString()),
                run.get("finishedAt") == null
                    ? Instant.now()
                    : Instant.parse(run.get("finishedAt").toString()))
            .toMillis());
    result.put("outputTableId", status.equals("succeeded") ? run.get("datasetId") : "");
    result.put("scheduleSnapshot", run.get("scheduleSnapshot"));
    result.put("waitReason", "");
    return result;
  }
}
