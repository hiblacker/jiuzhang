package cn.jiuzhang.platform.dataset.application;

import cn.jiuzhang.platform.dataset.domain.DatasetPlan;
import cn.jiuzhang.platform.dataset.domain.DatasetPlan.*;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.application.JsonWriter;
import cn.jiuzhang.platform.source.application.SourceService;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class DatasetService {
  private final DatasetStore store;
  private final SourceService sources;
  private final IdentityService identity;
  private final JsonWriter json;

  public DatasetService(
      DatasetStore store, SourceService sources, IdentityService identity, JsonWriter json) {
    this.store = store;
    this.sources = sources;
    this.identity = identity;
    this.json = json;
  }

  public List<Map<String, Object>> list(User user) {
    IdentityService.require(user, "read");
    return store.list();
  }

  public Map<String, Object> get(User user, String id) {
    IdentityService.require(user, "read");
    return store.get(id, false);
  }

  public Map<String, Object> save(
      User user, String id, Map<String, Object> input, String requestId) {
    IdentityService.require(user, "write");
    var body = input(input, id == null ? null : store.get(id, false));
    var d = map(body, "definition");
    plan(d, snapshots(d, "quality"), snapshots(d, "masking"), false);
    var columns = sourceColumns(user, d);
    validateSource(d, columns);
    return store.transaction(
        () -> {
          if (id != null) {
            var old = store.get(id, true);
            var oldDefinition = map(old, "definition");
            var previous = map(oldDefinition, "output");
            boolean published = ((Number) old.get("publishedVersion")).intValue() > 0;
            if (published && !deliveryMode(oldDefinition).equals(deliveryMode(d)))
              throw new Failure(409, "DATASET_DELIVERY_MODE_IMMUTABLE");
            if (published
                && deliveryMode(oldDefinition).equals("warehouse")
                && deliveryMode(d).equals("warehouse")
                && !previous.get("table").equals(map(d, "output").get("table")))
              throw new Failure(409, "TARGET_NAME_IMMUTABLE");
          }
          var saved = store.save(id, body);
          identity.audit(
              user.id(),
              id == null ? "post" : "patch",
              "dataset",
              saved.get("id").toString(),
              requestId);
          return saved;
        });
  }

  public void delete(User u, String id, String requestId) {
    IdentityService.require(u, "write");
    store.transaction(
        () -> {
          var d = store.get(id, true);
          if (((Number) d.get("publishedVersion")).intValue() > 0)
            throw new Failure(409, "PUBLISHED_DATASET_REFERENCED");
          store.delete(id);
          identity.audit(u.id(), "delete", "dataset", id, requestId);
          return null;
        });
  }

  public List<Map<String, Object>> versions(User u, String id) {
    IdentityService.require(u, "read");
    return store.versions(id);
  }

  public Map<String, Object> version(User u, String id, int number) {
    IdentityService.require(u, "read");
    return store.version(id, number);
  }

  public Map<String, Object> restore(User u, String id, int number, String requestId) {
    var version = version(u, id, number);
    var old = get(u, id);
    var body = new LinkedHashMap<String, Object>();
    for (String key : List.of("name", "description", "owner", "tags")) body.put(key, old.get(key));
    body.put("definition", version.get("definition"));
    return save(u, id, body, requestId);
  }

  public Map<String, Object> validate(User u, String id) {
    try {
      var d = map(get(u, id), "definition");
      plan(d, snapshots(d, "quality"), snapshots(d, "masking"), false);
      validateSource(d, sourceColumns(u, d));
      return Map.of("valid", true, "issues", List.of());
    } catch (Failure e) {
      return Map.of("valid", false, "issues", List.of(e.code));
    }
  }

  public Map<String, Object> publish(User u, String id, String key, String requestId) {
    IdentityService.require(u, "write");
    if (key == null || !key.matches("[a-zA-Z0-9_.:-]{1,100}"))
      throw new Failure(422, "IDEMPOTENCY_KEY_REQUIRED");
    var before = get(u, id);
    var d = map(before, "definition");
    String hash = IdentityService.hash(json.write(before));
    // A successful retry is tied to its draft body, not updatedAt/status changed by publication
    // itself.
    String draftHash =
        IdentityService.hash(json.write(Map.of("name", before.get("name"), "definition", d)));
    var previous = store.publication(u.id(), id, key);
    if (previous != null) {
      if (!previous.get("hash").equals(draftHash)) throw new Failure(409, "IDEMPOTENCY_CONFLICT");
      return map(previous, "body");
    }
    var quality = snapshots(d, "quality");
    var masking = snapshots(d, "masking");
    plan(d, quality, masking, true);
    var columns = sourceColumns(u, d);
    validateSource(d, columns);
    var source = sources.get(u, text(d, "sourceId"));
    var object = text(d, "mode").equals("visual")
        ? sources.object(u, text(d, "sourceId"), text(d, "objectId"))
        : null;
    return store.transaction(
        () -> {
          var current = store.get(id, true);
          var repeated = store.publication(u.id(), id, key);
          if (repeated != null) {
            if (!repeated.get("hash").equals(draftHash))
              throw new Failure(409, "IDEMPOTENCY_CONFLICT");
            return map(repeated, "body");
          }
          if (!hash.equals(IdentityService.hash(json.write(current))))
            throw new Failure(409, "DRAFT_CHANGED");
          int v = ((Number) current.get("publishedVersion")).intValue() + 1;
          String now = Instant.now().toString();
          var body = new LinkedHashMap<String, Object>();
          body.put("id", id + String.format("%06d", v));
          body.put("datasetId", id);
          body.put("version", v);
          body.put("createdAt", now);
          body.put("name", current.get("name"));
          body.put("definition", d);
          body.put("qualitySnapshot", quality);
          body.put("maskingSnapshot", masking);
          body.put("upstreamVersion", 0);
          body.put("sourceSnapshotOrigin", "published");
          body.put("sourceSnapshotCapturedAt", now);
          body.put("sourceSnapshots", object == null ? List.of() : List.of(Map.of(
              "sourceName", source.name(),
              "object", Map.of("id", object.id(), "sourceId", object.sourceId(), "name", object.name(),
                  "rowCount", "0", "rowCountKnown", false,
                  "fields", object.columns().stream().map(SourceService::field).toList()))));
          store.publish(id, v, body, object == null ? "" : object.name(), columns);
          store.publication(u.id(), id, key, draftHash, body);
          identity.audit(u.id(), "publish", "dataset", id, requestId);
          return body;
        });
  }

  public Map<String, Object> preview(User u, Map<String, Object> input) {
    IdentityService.require(u, "readSensitive");
    var body = input(input, null);
    var d = map(body, "definition");
    if (text(d, "mode").equals("sql")) {
      var result = sources.previewSql(u, text(d, "sourceId"), text(d, "sql"));
      if (objects(d, "fields").isEmpty())
        return Map.of("fields", result.columns().stream().map(SourceService::field).toList(),
            "rows", result.rows(), "notes", List.of("SQL_PREVIEW_LIMIT_100", "SET_FIELD_MAPPINGS_THEN_PREVIEW_AGAIN"));
      var plan = plan(d, snapshots(d, "quality"), snapshots(d, "masking"), false);
      validateSource(d, result.columns());
      return previewRows(d, plan, result.rows());
    }
    var plan = plan(d, snapshots(d, "quality"), snapshots(d, "masking"), false);
    var result = sources.preview(u, text(d, "sourceId"), text(d, "objectId"));
    return previewRows(d, plan, objects(result, "rows"));
  }

  private Map<String, Object> previewRows(
      Map<String, Object> d, DatasetPlan plan, List<Map<String, Object>> sourceRows) {
    var rows = new ArrayList<Map<String, Object>>();
    for (var row : sourceRows) {
      try {
        var converted = plan.transform(row);
        if (converted != null) rows.add(plan.output(converted));
      } catch (Problem e) {
        throw new Failure(422, e.code);
      }
    }
    return Map.of(
        "fields",
        objects(d, "fields").stream().filter(x -> bool(x, "output")).toList(),
        "rows",
        rows,
        "notes", List.of(text(d, "mode").equals("sql") ? "SQL_PREVIEW_LIMIT_100" : "SOURCE_SAMPLE_LIMIT_100",
            "QUALITY_ENFORCED_ON_FULL_RUN"));
  }

  public Map<String, Object> preview(User u, String id) {
    var d = get(u, id);
    return preview(u, input(Map.of(), d));
  }

  public Map<String, Object> query(User user, String id, int limit, String requestId) {
    IdentityService.require(user, "readSensitive");
    if (limit < 1 || limit > 1000) throw new Failure(422, "QUERY_LIMIT");
    var dataset = get(user, id);
    if (((Number) dataset.get("publishedVersion")).intValue() < 1)
      throw new Failure(409, "DATASET_NOT_PUBLISHED");
    var version = store.version(id, ((Number) dataset.get("publishedVersion")).intValue());
    var definition = map(version, "definition");
    if (!deliveryMode(definition).equals("direct")) throw new Failure(409, "DATASET_NOT_DIRECT");
    var plan = executable(version);
    List<Map<String,Object>> sourceRows;
    List<SourceConnector.Column> actualColumns;
    if (text(definition, "mode").equals("sql")) {
      var result = sources.querySql(user, text(definition, "sourceId"), text(definition, "sql"), limit);
      actualColumns = result.columns();
      verifySchema(store.columns(id, ((Number) version.get("version")).intValue()), actualColumns);
      sourceRows = result.rows();
    } else {
      actualColumns = store.columns(id, ((Number) version.get("version")).intValue());
      sourceRows = sources.queryTable(text(definition, "sourceId"),
          store.table(id, ((Number) version.get("version")).intValue()), actualColumns,
          new ArrayList<>(plan.usedSourceFields()), limit, () -> false);
    }
    var rows = new ArrayList<Map<String,Object>>();
    long warnings = 0;
    for (var row : sourceRows) {
      try {
        var converted = plan.transform(row);
        if (converted != null) {
          for (var rule : plan.quality()) {
            if (rule.enabled() && !plan.passes(rule, converted)) {
              if (rule.severity().equals("BLOCK")) throw new Failure(422, "QUALITY_BLOCKED");
              warnings++;
            }
          }
          rows.add(plan.output(converted));
        }
      } catch (Problem e) {
        throw new Failure(422, e.code);
      }
    }
    if (json.write(rows).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 10 * 1024 * 1024)
      throw new Failure(422, "QUERY_RESULT_LIMIT");
    identity.audit(user.id(), "query", "dataset", id, requestId);
    return Map.of("fields", objects(definition, "fields").stream().filter(x -> bool(x, "output")).toList(),
        "rows", rows, "notes", List.of("DIRECT_SOURCE_QUERY", "ROW_LIMIT_" + limit,
            warnings == 0 ? "QUALITY_PASS" : "QUALITY_WARNINGS_" + warnings));
  }

  public DatasetPlan executable(Map<String, Object> version) {
    return plan(
        map(version, "definition"),
        objects(version, "qualitySnapshot"),
        objects(version, "maskingSnapshot"));
  }

  public List<Map<String, Object>> rules(User u, String category) {
    IdentityService.require(u, "read");
    category(category);
    return store.rules(category);
  }

  public Map<String, Object> rule(User u, String category, String id) {
    IdentityService.require(u, "read");
    category(category);
    return store.rule(category, id);
  }

  public Map<String, Object> saveRule(
      User u, String category, String id, Map<String, Object> input, String requestId) {
    IdentityService.require(u, "write");
    category(category);
    var body = new LinkedHashMap<String, Object>();
    if (id != null) {
      body.putAll(store.rule(category, id));
      body.keySet().removeAll(Set.of("id", "version", "updatedAt"));
    }
    body.putAll(input);
    var allowed =
        new HashSet<>(
            List.of("name", "description", "owner", "tags", "kind", "parameter", "enabled"));
    if (category.equals("quality")) allowed.addAll(List.of("field", "severity"));
    if (!allowed.containsAll(input.keySet()) || !body.keySet().containsAll(allowed))
      throw new Failure(422, "VALIDATION_ERROR");
    base(body);
    bool(body, "enabled");
    text(body, "parameter");
    if (category.equals("quality")) {
      if (!Set.of("required", "range").contains(text(body, "kind")))
        throw new Failure(422, "QUALITY_KIND_UNSUPPORTED");
      if (!text(body, "field").matches("[a-zA-Z_][a-zA-Z0-9_]{0,63}")
          || !Set.of("WARN", "BLOCK").contains(text(body, "severity")))
        throw new Failure(422, "QUALITY_RULE_INVALID");
      if (text(body, "kind").equals("range"))
        try {
          DatasetPlan.range(text(body, "parameter"));
        } catch (Problem e) {
          throw new Failure(422, e.code);
        }
    } else {
      if (!text(body, "kind").equals("mask")) throw new Failure(422, "MASK_KIND_UNSUPPORTED");
      mask(body);
    }
    return store.transaction(
        () -> {
          var saved = store.saveRule(category, id, body);
          identity.audit(
              u.id(),
              id == null ? "post" : "patch",
              category,
              saved.get("id").toString(),
              requestId);
          return saved;
        });
  }

  public void deleteRule(User u, String c, String id, String requestId) {
    IdentityService.require(u, "write");
    store.transaction(
        () -> {
          rule(u, c, id);
          store.deleteRule(c, id);
          identity.audit(u.id(), "delete", c, id, requestId);
          return null;
        });
  }

  private List<Map<String, Object>> snapshots(Map<String, Object> d, String category) {
    var ids =
        new LinkedHashSet<>(
            strings(d, category.equals("quality") ? "qualityRuleIds" : "maskPolicyIds"));
    if (category.equals("masking"))
      for (var f : objects(d, "fields"))
        if (!text(f, "maskPolicyId").isEmpty()) ids.add(text(f, "maskPolicyId"));
    return ids.stream().map(id -> store.rule(category, id)).toList();
  }

  public DatasetPlan plan(
      Map<String, Object> d, List<Map<String, Object>> quality, List<Map<String, Object>> masking) {
    return plan(d, quality, masking, true);
  }

  public DatasetPlan plan(
      Map<String, Object> d,
      List<Map<String, Object>> quality,
      List<Map<String, Object>> masking,
      boolean requireWarehouseOutput) {
    try {
      if (!text(d, "upstreamDatasetId").isEmpty()) throw new Failure(422, "DATASET_MODE_UNSUPPORTED");
      String mode = text(d, "mode");
      if (!Set.of("visual", "sql").contains(mode)) throw new Failure(422, "DATASET_MODE_UNSUPPORTED");
      Set<String> allowed = Set.of(
              "sourceId",
              "objectId",
              "upstreamDatasetId",
              "mode",
              "deliveryMode",
              "sql",
              "fields",
              "nodes",
              "edges",
              "cleaning",
              "qualityRuleIds",
              "maskPolicyIds",
              "schedule",
              "output");
      if (!allowed.containsAll(d.keySet())
          || !d.keySet().containsAll(allowed.stream().filter(k -> !k.equals("deliveryMode")).toList()))
        throw new Failure(422, "VALIDATION_ERROR");
      String delivery = deliveryMode(d);
      if (!Set.of("direct", "warehouse").contains(delivery)) throw new Failure(422, "VALIDATION_ERROR");
      if (mode.equals("sql") && (text(d, "sql").isBlank() || text(d, "sql").length() > 8192))
        throw new Failure(422, "UNSUPPORTED_SQL");
      var s = map(d, "schedule");
      if (!text(s, "mode").equals("manual")
          || integer(s, "retries") != 0
          || integer(s, "concurrency") != 1
          || !strings(s, "dependencies").isEmpty()) throw new Failure(422, "SCHEDULE_UNSUPPORTED");
      int timeout = integer(s, "timeoutSeconds");
      if (timeout < 1 || timeout > 600) throw new Failure(422, "TIMEOUT_LIMIT");
      var o = map(d, "output");
      if (requireWarehouseOutput && delivery.equals("warehouse")) {
        if (!text(o, "writeMode").equals("replace")
            || !text(o, "table").matches("[a-zA-Z_][a-zA-Z0-9_]{0,55}")
            || text(o, "table").startsWith("jz_")) throw new Failure(422, "OUTPUT_UNSUPPORTED");
        if (!Set.of("ODS", "DWD", "DWS", "ADS").contains(text(o, "layer")))
          throw new Failure(422, "VALIDATION_ERROR");
      }
      if (strings(d, "cleaning").stream().anyMatch(x -> !x.equals("trim")))
        throw new Failure(422, "CLEANING_UNSUPPORTED");
      var nodes = objects(d, "nodes");
      var edges = objects(d, "edges");
      if (mode.equals("visual")) {
        if (nodes.isEmpty()
            || nodes.size() > 20
            || nodes.stream().filter(n -> text(n, "type").equals("input")).count() != 1
            || nodes.stream().anyMatch(n -> !Set.of("input", "filter", "fields").contains(text(n, "type"))))
          throw new Failure(422, "GRAPH_UNSUPPORTED");
        if (nodes.stream().anyMatch(n -> text(n, "type").equals("fields") && !text(n, "config").isBlank()))
          throw new Failure(422, "GRAPH_UNSUPPORTED");
        var ids = new HashSet<String>();
        for (var n : nodes) if (!ids.add(text(n, "id"))) throw new Failure(422, "GRAPH_INVALID");
        if (edges.size() != nodes.size() - 1) throw new Failure(422, "GRAPH_INVALID");
        String current = nodes.stream().filter(n -> text(n, "type").equals("input")).findFirst().orElseThrow().get("id").toString();
        var visited = new HashSet<String>();
        while (visited.add(current)) {
          String parent = current;
          var children = edges.stream().filter(e -> text(e, "source").equals(parent)).toList();
          if (children.size() > 1) throw new Failure(422, "GRAPH_INVALID");
          if (children.isEmpty()) break;
          current = text(children.getFirst(), "target");
          if (!ids.contains(current)) throw new Failure(422, "GRAPH_INVALID");
        }
        if (visited.size() != nodes.size()
            || edges.stream().anyMatch(e -> !ids.contains(text(e, "source")) || !ids.contains(text(e, "target"))))
          throw new Failure(422, "GRAPH_INVALID");
      }
      var filters = new ArrayList<Filter>();
      for (var n : mode.equals("visual") ? nodes : List.<Map<String, Object>>of())
        if (text(n, "type").equals("filter")) {
          String config = text(n, "config");
          int at = config.indexOf('=');
          if (at < 1 || !config.substring(0, at).strip().matches("[a-zA-Z_][a-zA-Z0-9_]{0,63}"))
            throw new Failure(422, "FILTER_INVALID");
          filters.add(
              new Filter(config.substring(0, at).strip(), config.substring(at + 1).strip()));
        }
      if (objects(d, "fields").stream()
          .anyMatch(
              f -> bool(f, "sensitive") && bool(f, "output") && text(f, "maskPolicyId").isEmpty()))
        throw new Failure(422, "SENSITIVE_FIELD_MASK_REQUIRED");
      var fields =
          objects(d, "fields").stream()
              .map(
                  f ->
                      new Field(
                          text(f, "name"),
                          text(f, "target"),
                          text(f, "type"),
                          bool(f, "nullable"),
                          bool(f, "output"),
                          text(f, "maskPolicyId")))
              .toList();
      var rules =
          quality.stream()
              .map(
                  q ->
                      new QualityRule(
                          text(q, "id"),
                          integer(q, "version"),
                          text(q, "kind"),
                          text(q, "field"),
                          text(q, "parameter"),
                          text(q, "severity"),
                          bool(q, "enabled")))
              .toList();
      return new DatasetPlan(
          fields,
          filters,
          strings(d, "cleaning").contains("trim"),
          rules,
          masking.stream().map(this::mask).toList());
    } catch (Problem e) {
      throw new Failure(422, e.code);
    }
  }

  private Mask mask(Map<String, Object> m) {
    String p = text(m, "parameter");
    if (!p.matches("[0-9]{1,2},[0-9]{1,2}")) throw new Failure(422, "MASK_PARAMETER_INVALID");
    String[] parts = p.split(",");
    return new Mask(
        m.containsKey("id") ? text(m, "id") : "0",
        m.containsKey("version") ? integer(m, "version") : 1,
        Integer.parseInt(parts[0]),
        Integer.parseInt(parts[1]),
        bool(m, "enabled"));
  }

  private void validateSource(Map<String, Object> d, List<SourceConnector.Column> columns) {
    var plan = plan(d, snapshots(d, "quality"), snapshots(d, "masking"), false);
    var names =
        columns.stream().map(c -> c.name()).collect(java.util.stream.Collectors.toSet());
    if (!names.containsAll(plan.usedSourceFields())) throw new Failure(422, "SOURCE_FIELD_MISSING");
  }

  private List<SourceConnector.Column> sourceColumns(User user, Map<String, Object> definition) {
    if (text(definition, "mode").equals("sql"))
      return sources.previewSql(user, text(definition, "sourceId"), text(definition, "sql")).columns();
    return sources.object(user, text(definition, "sourceId"), text(definition, "objectId")).columns();
  }

  private String deliveryMode(Map<String, Object> definition) {
    if (!definition.containsKey("deliveryMode")) return "warehouse";
    String mode = text(definition, "deliveryMode");
    return mode.isEmpty() ? "warehouse" : mode;
  }

  private void verifySchema(List<SourceConnector.Column> expected, List<SourceConnector.Column> actual) {
    if (expected.size() != actual.size()) throw new Failure(409, "SCHEMA_CHANGED");
    for (int i = 0; i < expected.size(); i++) {
      var left = expected.get(i);
      var right = actual.get(i);
      if (!left.name().equals(right.name()) || !left.type().equalsIgnoreCase(right.type())
          || left.precision() != right.precision() || left.scale() != right.scale()
          || left.length() != right.length() || left.nullable() != right.nullable())
        throw new Failure(409, "SCHEMA_CHANGED");
    }
  }

  private Map<String, Object> input(Map<String, Object> input, Map<String, Object> old) {
    if (!Set.of("name", "description", "owner", "tags", "definition", "folderId")
        .containsAll(input.keySet())) throw new Failure(422, "VALIDATION_ERROR");
    var body = new LinkedHashMap<String, Object>();
    if (old != null)
      for (String key : List.of("name", "description", "owner", "tags", "definition", "folderId"))
        body.put(key, old.get(key));
    body.putAll(input);
    base(body);
    if (body.get("folderId") != null) throw new Failure(422, "FOLDERS_UNSUPPORTED");
    map(body, "definition");
    return body;
  }

  private void base(Map<String, Object> b) {
    if (text(b, "name").isBlank()
        || text(b, "name").length() > 120
        || text(b, "description").length() > 2000
        || text(b, "owner").isBlank()
        || text(b, "owner").length() > 120
        || strings(b, "tags").size() > 20) throw new Failure(422, "VALIDATION_ERROR");
  }

  private void category(String c) {
    if (!Set.of("quality", "masking").contains(c)) throw new Failure(404, "NOT_FOUND");
  }

  public static String text(Map<String, Object> m, String key) {
    if (!(m.get(key) instanceof String s)) throw new Failure(422, "VALIDATION_ERROR");
    return s;
  }

  public static boolean bool(Map<String, Object> m, String key) {
    if (!(m.get(key) instanceof Boolean b)) throw new Failure(422, "VALIDATION_ERROR");
    return b;
  }

  public static int integer(Map<String, Object> m, String key) {
    if (!(m.get(key) instanceof Number n) || n.doubleValue() != n.intValue())
      throw new Failure(422, "VALIDATION_ERROR");
    return n.intValue();
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> map(Map<String, Object> m, String key) {
    if (!(m.get(key) instanceof Map<?, ?>)) throw new Failure(422, "VALIDATION_ERROR");
    return (Map<String, Object>) m.get(key);
  }

  @SuppressWarnings("unchecked")
  public static List<Map<String, Object>> objects(Map<String, Object> m, String key) {
    if (!(m.get(key) instanceof List<?> l)
        || l.size() > 1000
        || l.stream().anyMatch(x -> !(x instanceof Map<?, ?>)))
      throw new Failure(422, "VALIDATION_ERROR");
    return (List<Map<String, Object>>) m.get(key);
  }

  @SuppressWarnings("unchecked")
  public static List<String> strings(Map<String, Object> m, String key) {
    if (!(m.get(key) instanceof List<?> l)
        || l.size() > 1000
        || l.stream().anyMatch(x -> !(x instanceof String)))
      throw new Failure(422, "VALIDATION_ERROR");
    return (List<String>) m.get(key);
  }
}
