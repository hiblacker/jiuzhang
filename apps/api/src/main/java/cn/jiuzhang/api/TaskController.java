package cn.jiuzhang.api;

import cn.jiuzhang.platform.execution.application.RunService;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.task.application.TaskService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {
  private final TaskService tasks;
  private final RunService runs;

  public TaskController(TaskService tasks, RunService runs) {
    this.tasks = tasks;
    this.runs = runs;
  }

  @GetMapping
  Object list(HttpServletRequest request) {
    var rows = tasks.list(SessionFilter.session(request).user()).stream()
        .filter(x -> matches(request.getParameter("q"), x.get("name"), x.get("owner")))
        .filter(x -> matchesEnabled(request.getParameter("enabled"), x.get("enabled")))
        .filter(x -> blankOrEqual(request.getParameter("excludeId"), x.get("id")))
        .filter(x -> blankOrNotEqual(request.getParameter("excludeDatasetId"), x.get("datasetId")))
        .toList();
    return HttpSupport.page(rows, request);
  }

  @GetMapping("/{id}")
  Object get(@PathVariable String id, HttpServletRequest request) {
    return HttpSupport.ok(tasks.get(SessionFilter.session(request).user(), id), request);
  }

  @PatchMapping("/{id}")
  Object patch(@PathVariable String id, @RequestBody Map<String, Object> input, HttpServletRequest request) {
    HttpSupport.fields(input, "name", "description", "owner", "tags", "schedule");
    return HttpSupport.ok(tasks.save(SessionFilter.session(request).user(), id, input, HttpSupport.requestId(request)), request);
  }

  @PostMapping("/{id}/pause")
  Object pause(@PathVariable String id, HttpServletRequest request) {
    return HttpSupport.ok(tasks.setEnabled(SessionFilter.session(request).user(), id, false, HttpSupport.requestId(request)), request);
  }

  @PostMapping("/{id}/resume")
  Object resume(@PathVariable String id, HttpServletRequest request) {
    return HttpSupport.ok(tasks.setEnabled(SessionFilter.session(request).user(), id, true, HttpSupport.requestId(request)), request);
  }

  @PostMapping("/{id}/runs")
  @ResponseStatus(HttpStatus.CREATED)
  Object run(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body, HttpServletRequest request) {
    Map<String, Object> input = body == null ? Map.of() : body;
    HttpSupport.fields(input, "allowEmptySnapshot");
    boolean allow = input.getOrDefault("allowEmptySnapshot", false) instanceof Boolean value ? value : invalid();
    return HttpSupport.ok(runs.start(SessionFilter.session(request).user(), id, allow, request.getHeader("Idempotency-Key"), null, HttpSupport.requestId(request)), request);
  }

  @PostMapping("/{id}/backfills")
  Object backfill(@PathVariable String id, HttpServletRequest request) {
    throw new Failure(501, "BACKFILL_UNSUPPORTED");
  }

  private static boolean invalid() {
    throw new Failure(422, "VALIDATION_ERROR");
  }

  private static boolean matches(String query, Object... values) {
    if (query == null || query.isBlank()) return true;
    String q = query.toLowerCase();
    for (Object value : values) if (value != null && value.toString().toLowerCase().contains(q)) return true;
    return false;
  }

  private static boolean matchesEnabled(String query, Object value) {
    return query == null || query.isBlank() || query.equals(String.valueOf(value));
  }

  private static boolean blankOrEqual(String query, Object value) {
    return query == null || query.isBlank() || !query.equals(String.valueOf(value));
  }

  private static boolean blankOrNotEqual(String query, Object value) {
    return query == null || query.isBlank() || !query.equals(String.valueOf(value));
  }
}
