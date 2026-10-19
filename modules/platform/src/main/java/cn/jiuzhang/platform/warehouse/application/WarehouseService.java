package cn.jiuzhang.platform.warehouse.application;

import static cn.jiuzhang.platform.dataset.application.DatasetService.*;

import cn.jiuzhang.platform.dataset.application.DatasetStore;
import cn.jiuzhang.platform.execution.application.RunStore;
import cn.jiuzhang.platform.execution.application.WarehousePort;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.application.JsonWriter;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class WarehouseService {
  private final RunStore runs;
  private final DatasetStore datasets;
  private final WarehousePort warehouse;
  private final QueryParser parser;
  private final QueryStore queries;
  private final IdentityService identity;
  private final JsonWriter json;

  public WarehouseService(
      RunStore runs,
      DatasetStore datasets,
      WarehousePort warehouse,
      QueryParser parser,
      QueryStore queries,
      IdentityService identity,
      JsonWriter json) {
    this.runs = runs;
    this.datasets = datasets;
    this.warehouse = warehouse;
    this.parser = parser;
    this.queries = queries;
    this.identity = identity;
    this.json = json;
  }

  public List<Map<String, Object>> tables(User u) {
    IdentityService.require(u, "read");
    return runs.targets().stream().map(s -> tableData(s, false)).toList();
  }

  public Map<String, Object> table(User u, String id) {
    IdentityService.require(u, "read");
    return runs.transaction(
        () -> {
          runs.lockDataset(id);
          var s = runs.current(id);
          if (s == null) throw new Failure(404, "NOT_FOUND");
          return tableData(s, true);
        });
  }

  private Map<String, Object> tableData(Map<String, Object> s, boolean sample) {
    String id = text(s, "datasetId");
    var run = runs.get(text(s, "runId"), false);
    var version = datasets.version(id, integer(run, "datasetVersion"));
    var d = map(version, "definition");
    var output = map(d, "output");
    var current = datasets.get(id, false);
    var fields = objects(s, "fields");
    var result = new LinkedHashMap<String, Object>();
    result.put("id", id);
    result.put("datasetId", id);
    result.put("name", s.get("name"));
    for (String k : List.of("description", "owner", "tags")) result.put(k, current.get(k));
    result.put("updatedAt", s.get("publishedAt"));
    result.put("createdAt", s.get("publishedAt"));
    result.put("layer", output.get("layer"));
    result.put("subjectDomain", output.getOrDefault("subjectDomain", ""));
    result.put("datasetVersion", version.get("version"));
    result.put("sourceId", d.get("sourceId"));
    result.put("rowCount", s.get("rowCount"));
    result.put("fields", fields);
    result.put(
        "sample",
        sample
            ? warehouse.rows(
                text(s, "physical"), fields.stream().map(f -> text(f, "target")).toList(), 100, 0)
            : List.of());
    result.put("partitions", List.of());
    result.put("version", version.get("version"));
    return result;
  }

  public Map<String, Object> query(User u, String sql, String key, String request) {
    IdentityService.require(u, "read");
    validateKey(key);
    var parsed = parser.parse(sql);
    String hash = IdentityService.hash(sql);
    var receipt = queries.receipt(u.id(), "queries", key, hash);
    if (receipt != null) return receipt;
    var target =
        runs.targets().stream()
            .filter(x -> text(x, "name").equalsIgnoreCase(parsed.table()))
            .findFirst()
            .orElseThrow(() -> new Failure(404, "NOT_FOUND"));
    String dataset = text(target, "datasetId");
    return queries.transaction(
        () -> {
          queries.lock(u.id(), "queries", key);
          var repeated = queries.receipt(u.id(), "queries", key, hash);
          if (repeated != null) return repeated;
          runs.lockDataset(dataset);
          var snap = runs.current(dataset);
          var available = objects(snap, "fields").stream().map(f -> text(f, "target")).toList();
          List<String> columns = parsed.columns().isEmpty() ? available : parsed.columns();
          if (columns.isEmpty()
              || new HashSet<>(columns).size() != columns.size()
              || !available.containsAll(columns)) throw new Failure(422, "QUERY_FIELD_INVALID");
          var rows =
              warehouse.rows(text(snap, "physical"), columns, parsed.limit(), parsed.offset());
          if (json.write(rows).getBytes(java.nio.charset.StandardCharsets.UTF_8).length
              > WarehousePort.MAX_RESULT_BYTES) throw new Failure(422, "QUERY_RESULT_LIMIT");
          String id = queries.nextId("queries");
          var body = new LinkedHashMap<String, Object>();
          body.put("id", id);
          body.put("sql", sql);
          body.put("status", "succeeded");
          body.put("tableId", dataset);
          body.put("rows", rows);
          body.put("columns", columns);
          body.put("createdAt", Instant.now().toString());
          body.put("userId", u.id());
          queries.save("queries", id, u.id(), dataset, text(snap, "runId"), null, body);
          queries.receipt(u.id(), "queries", key, hash, id);
          identity.audit(u.id(), "query", "warehouse", dataset, request);
          return body;
        });
  }

  public List<Map<String, Object>> queries(User u) {
    IdentityService.require(u, "read");
    return queries.list("queries", u.id());
  }

  public Map<String, Object> query(User u, String id) {
    IdentityService.require(u, "read");
    return queries.get("queries", id, u.id());
  }

  public Map<String, Object> export(User u, String id, String format, String key, String request) {
    IdentityService.require(u, "read");
    validateKey(key);
    if (!format.equals("csv")) throw new Failure(422, "EXPORT_FORMAT_UNSUPPORTED");
    String hash = IdentityService.hash(id + ":" + format);
    return queries.transaction(
        () -> {
          queries.lock(u.id(), "exports", key);
          var old = queries.receipt(u.id(), "exports", key, hash);
          if (old != null) return exportView(old);
          var q = query(u, id);
          var columns = strings(q, "columns");
          var content = new StringBuilder();
          content.append(csv(columns)).append("\r\n");
          for (var row : objects(q, "rows"))
            content
                .append(
                    csv(
                        columns.stream()
                            .map(c -> row.get(c) == null ? "" : row.get(c).toString())
                            .toList()))
                .append("\r\n");
          String export = queries.nextId("exports");
          var body = new LinkedHashMap<String, Object>();
          body.put("id", export);
          body.put("queryId", id);
          body.put("format", "csv");
          body.put("status", "ready");
          body.put("fileName", "query-" + id + ".csv");
          body.put("content", content.toString());
          body.put("createdAt", Instant.now().toString());
          body.put("expiresAt", Instant.now().plus(Duration.ofHours(24)).toString());
          body.put("progress", 100);
          body.put("userId", u.id());
          body.put("columns", columns);
          queries.save("exports", export, u.id(), null, null, id, body);
          queries.receipt(u.id(), "exports", key, hash, export);
          identity.audit(u.id(), "export", "query", id, request);
          return body;
        });
  }

  public List<Map<String, Object>> exports(User u) {
    IdentityService.require(u, "read");
    return queries.list("exports", u.id()).stream().map(this::exportView).toList();
  }

  public Map<String, Object> export(User u, String id) {
    IdentityService.require(u, "read");
    return exportView(queries.get("exports", id, u.id()));
  }

  private Map<String, Object> exportView(Map<String, Object> body) {
    if (Instant.parse(text(body, "expiresAt")).isAfter(Instant.now())) return body;
    var result = new LinkedHashMap<>(body);
    result.put("status", "expired");
    result.put("content", "");
    return result;
  }

  private String csv(List<String> cells) {
    return cells.stream()
        .map(
            cell -> {
              String value = cell;
              if (!value.isEmpty()
                  && (Set.of('=', '+', '-', '@', '\t', '\r', '\n').contains(value.charAt(0))
                      || !value.equals(value.stripLeading()))) value = "'" + value;
              return "\"" + value.replace("\"", "\"\"") + "\"";
            })
        .collect(java.util.stream.Collectors.joining(","));
  }

  public Map<String, Object> metrics(User u, String table) {
    var tables =
        tables(u).stream()
            .filter(t -> table == null || table.isEmpty() || table.equals(t.get("id")))
            .toList();
    long rows = tables.stream().mapToLong(t -> Long.parseLong(text(t, "rowCount"))).sum();
    var allRuns = runs.list();
    var layers =
        List.of("ODS", "DWD", "DWS", "ADS").stream()
            .map(
                layer ->
                    Map.of(
                        "layer",
                        layer,
                        "tableCount",
                        tables.stream().filter(t -> layer.equals(t.get("layer"))).count(),
                        "rowCount",
                        Long.toString(
                            tables.stream()
                                .filter(t -> layer.equals(t.get("layer")))
                                .mapToLong(t -> Long.parseLong(text(t, "rowCount")))
                                .sum())))
            .toList();
    var m = new LinkedHashMap<String, Object>();
    m.put("layers", layers);
    m.put("tableCount", tables.size());
    m.put("rowCount", Long.toString(rows));
    m.put("sampleBytes", 0);
    m.put(
        "activeRuns",
        allRuns.stream()
            .filter(
                r ->
                    Set.of("queued", "running", "validating", "publishing")
                        .contains(r.get("status")))
            .count());
    var qs = queries(u);
    m.put("queryCount", qs.size());
    m.put("writeCount", allRuns.stream().filter(r -> r.get("status").equals("succeeded")).count());
    m.put("readRows", Long.toString(qs.stream().mapToLong(q -> objects(q, "rows").size()).sum()));
    m.put(
        "writtenRows",
        Long.toString(
            allRuns.stream()
                .filter(r -> r.get("status").equals("succeeded"))
                .mapToLong(r -> Long.parseLong(text(r, "rowCount")))
                .sum()));
    m.put("trend", List.of());
    return m;
  }

  private void validateKey(String key) {
    if (key == null || !key.matches("[a-zA-Z0-9_.:-]{1,100}"))
      throw new Failure(422, "IDEMPOTENCY_KEY_REQUIRED");
  }
}
