package com.bydw.warehouse;

import static com.bydw.warehouse.ModelService.bad;
import static com.bydw.warehouse.ModelService.quote;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Compiles structured preparation steps, never SQL supplied by a client. */
public final class PreparationPlan {
  private PreparationPlan() {}

  public enum ValueKind { DETAIL, ADDITIVE, NON_ADDITIVE }

  public record Field(String name, String type, ValueKind valueKind) {
    public Field(String name, String type) { this(name, type, ValueKind.DETAIL); }
    public Field {
      quote(name);
      checkType(type);
      if (valueKind == null) bad("PREPARATION_INVALID_VALUE_KIND");
    }
  }

  /** Resolved by the server after authorizing and pinning an input release or asset. */
  public record Input(String schema, String table, List<Field> fields) {
    public Input {
      quote(schema);
      quote(table);
      fields = List.copyOf(fields);
      checkFields(fields);
    }
  }

  public record Compiled(String sql, List<Object> parameters, List<Field> fields,
                         List<String> inputBindings, List<String> stepOrder) {
    public Compiled {
      parameters = Collections.unmodifiableList(new ArrayList<>(parameters));
      fields = List.copyOf(fields);
      inputBindings = List.copyOf(inputBindings);
      stepOrder = List.copyOf(stepOrder);
    }
  }

  private record Relation(String name, List<Field> fields) {}
  private record Expression(String sql, String type, ValueKind valueKind) {
    Expression(String sql, String type) { this(sql, type, ValueKind.DETAIL); }
  }

  public static Compiled compile(JsonNode plan, Map<String, Input> inputs) {
    return new Compiler(plan, inputs).compile();
  }

  private static void checkType(String type) {
    if (type == null || !Set.of("text", "bigint", "integer", "numeric", "boolean", "date",
        "timestamp", "timestamptz").contains(type)) bad("PREPARATION_INVALID_TYPE");
  }

  private static void checkFields(List<Field> fields) {
    if (fields.isEmpty() || fields.size() > 200) bad("PREPARATION_INVALID_FIELDS");
    var names = new HashSet<String>();
    for (Field field : fields) if (!names.add(field.name())) bad("PREPARATION_DUPLICATE_FIELD");
  }

  private static boolean numeric(String type) {
    return Set.of("integer", "bigint", "numeric").contains(type);
  }

  private static String text(JsonNode node, String key) {
    if (!node.path(key).isTextual() || node.path(key).asText().isBlank()) bad("PREPARATION_REQUIRED_" + key.toUpperCase(java.util.Locale.ROOT));
    return node.path(key).asText();
  }

  private static String id(JsonNode node, String key) {
    String value = text(node, key);
    quote(value);
    return value;
  }

  private static void shape(JsonNode node, String... keys) {
    if (node == null || !node.isObject()) bad("PREPARATION_OBJECT_REQUIRED");
    Set<String> allowed = Set.of(keys);
    node.fieldNames().forEachRemaining(key -> {
      if (!allowed.contains(key)) bad("PREPARATION_UNKNOWN_PROPERTY");
    });
  }

  private static JsonNode array(JsonNode node, String key, int min, int max) {
    JsonNode value = node.path(key);
    if (!value.isArray() || value.size() < min || value.size() > max) bad("PREPARATION_INVALID_" + key.toUpperCase(java.util.Locale.ROOT));
    return value;
  }

  private static Field field(Relation relation, String name) {
    return relation.fields().stream().filter(f -> f.name().equals(name)).findFirst()
        .orElseThrow(() -> new com.bydw.api.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
            "PREPARATION_UNKNOWN_FIELD", "PREPARATION_UNKNOWN_FIELD"));
  }

  private static List<String> names(JsonNode node, String key, int min, Relation relation) {
    var names = new ArrayList<String>();
    for (JsonNode value : array(node, key, min, 200)) {
      if (!value.isTextual() || names.contains(value.asText())) bad("PREPARATION_INVALID_FIELD_LIST");
      field(relation, value.asText());
      names.add(value.asText());
    }
    return names;
  }

  private static String columns(List<Field> fields) {
    return String.join(", ", fields.stream().map(f -> quote(f.name())).toList());
  }

  private static final class Compiler {
    private final JsonNode plan;
    private final Map<String, Input> inputs;
    private final Map<String, JsonNode> nodes = new LinkedHashMap<>();
    private final Map<String, Relation> done = new HashMap<>();
    private final Set<String> visiting = new HashSet<>();
    private final List<String> bindings = new ArrayList<>();
    private final List<String> order = new ArrayList<>();
    private final List<String> ctes = new ArrayList<>();
    private final List<Object> parameters = new ArrayList<>();

    Compiler(JsonNode plan, Map<String, Input> inputs) {
      this.plan = plan;
      this.inputs = Map.copyOf(inputs);
    }

    Compiled compile() {
      shape(plan, "version", "grain", "uniqueKey", "steps", "output");
      if (!plan.path("version").isIntegralNumber() || !plan.path("version").canConvertToInt() || plan.path("version").asInt() != 1
          || plan.toString().length() > 131072) bad("PREPARATION_INVALID_PLAN");
      if (text(plan, "grain").length() > 500) bad("PREPARATION_INVALID_GRAIN");
      for (JsonNode step : array(plan, "steps", 1, 64)) {
        if (nodes.putIfAbsent(id(step, "id"), step) != null) bad("PREPARATION_DUPLICATE_STEP");
      }
      Relation output = visit(id(plan, "output"));
      if (done.size() != nodes.size()) bad("PREPARATION_UNUSED_STEP");
      names(plan, "uniqueKey", 1, output);
      return new Compiled("WITH " + String.join(",\n", ctes) + "\nSELECT " + columns(output.fields())
          + " FROM " + quote(output.name()), parameters, output.fields(), bindings, order);
    }

    Relation visit(String name) {
      if (done.containsKey(name)) return done.get(name);
      if (!visiting.add(name)) bad("PREPARATION_CYCLE");
      JsonNode step = nodes.get(name);
      if (step == null) bad("PREPARATION_STEP_NOT_FOUND");
      String type = text(step, "type");
      Relation compiled = switch (type) {
        case "INPUT" -> input(step);
        case "SELECT" -> select(step);
        case "FILTER" -> filter(step);
        case "DEDUPLICATE" -> deduplicate(step);
        case "JOIN" -> join(step);
        case "UNION" -> union(step);
        case "AGGREGATE" -> aggregate(step);
        default -> { bad("PREPARATION_UNKNOWN_STEP"); yield null; }
      };
      done.put(name, compiled);
      visiting.remove(name);
      order.add(name);
      return compiled;
    }

    Relation emit(String sql, List<Field> fields) {
      checkFields(fields);
      String name = "prep_step_" + ctes.size();
      ctes.add(quote(name) + " AS (" + sql + ")");
      return new Relation(name, List.copyOf(fields));
    }

    Relation input(JsonNode step) {
      shape(step, "id", "type", "binding");
      String binding = id(step, "binding");
      Input input = inputs.get(binding);
      if (input == null) bad("PREPARATION_INPUT_NOT_RESOLVED");
      if (!bindings.contains(binding)) bindings.add(binding);
      return emit("SELECT " + columns(input.fields()) + " FROM " + quote(input.schema()) + "." + quote(input.table()), input.fields());
    }

    Relation select(JsonNode step) {
      shape(step, "id", "type", "input", "fields");
      Relation source = visit(id(step, "input"));
      var fields = new ArrayList<Field>();
      var selected = new ArrayList<String>();
      for (JsonNode item : array(step, "fields", 1, 200)) {
        shape(item, "name", "expression");
        Expression expression = expression(item.path("expression"), source, 0);
        String name = id(item, "name");
        fields.add(new Field(name, expression.type(), expression.valueKind()));
        selected.add(expression.sql() + " AS " + quote(name));
      }
      return emit("SELECT " + String.join(", ", selected) + " FROM " + quote(source.name()), fields);
    }

    Expression expression(JsonNode expr, Relation source, int depth) {
      if (depth > 12) bad("PREPARATION_EXPRESSION_TOO_DEEP");
      if (expr.has("field")) {
        shape(expr, "field");
        Field field = field(source, text(expr, "field"));
        return new Expression(quote(field.name()), field.type(), field.valueKind());
      }
      if (expr.has("literal")) {
        shape(expr, "literal", "type");
        String type = text(expr, "type");
        checkType(type);
        JsonNode value = expr.path("literal");
        if (!value.isValueNode() || (!value.isNull() && !value.isTextual() && !value.isNumber() && !value.isBoolean())
            || value.asText().length() > 4096) bad("PREPARATION_INVALID_LITERAL");
        Object parameter = null;
        if (!value.isNull()) {
          try {
            parameter = switch (type) {
              case "integer" -> new BigDecimal(value.asText()).intValueExact();
              case "bigint" -> new BigDecimal(value.asText()).longValueExact();
              case "numeric" -> {
                BigDecimal decimal = new BigDecimal(value.asText());
                if (decimal.precision() > 1000 || Math.abs((long) decimal.scale()) > 1000) bad("PREPARATION_INVALID_LITERAL");
                yield decimal;
              }
              case "boolean" -> {
                if (!value.isBoolean()) bad("PREPARATION_INVALID_LITERAL");
                yield value.booleanValue();
              }
              default -> {
                if (!value.isTextual()) bad("PREPARATION_INVALID_LITERAL");
                yield value.asText();
              }
            };
          } catch (ArithmeticException | NumberFormatException error) { bad("PREPARATION_INVALID_LITERAL"); }
        }
        parameters.add(parameter);
        if (parameters.size() > 2000) bad("PREPARATION_TOO_MANY_PARAMETERS");
        return new Expression("CAST(? AS " + type + ")", type);
      }
      String op = text(expr, "op");
      shape(expr, "op", "args", "to");
      if (!op.equals("CAST") && expr.has("to")) bad("PREPARATION_UNKNOWN_PROPERTY");
      int count = switch (op) {
        case "CAST", "TRIM", "LOWER", "UPPER" -> 1;
        case "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "COALESCE", "CONCAT" -> 2;
        default -> { bad("PREPARATION_UNKNOWN_EXPRESSION"); yield 0; }
      };
      JsonNode args = array(expr, "args", count, count);
      Expression first = expression(args.get(0), source, depth + 1);
      if (op.equals("CAST")) {
        String target = text(expr, "to");
        checkType(target);
        return new Expression("CAST(" + first.sql() + " AS " + target + ")", target, first.valueKind());
      }
      if (count == 1) {
        if (!first.type().equals("text")) bad("PREPARATION_EXPRESSION_TYPE_MISMATCH");
        return new Expression(op + "(" + first.sql() + ")", "text", first.valueKind());
      }
      Expression second = expression(args.get(1), source, depth + 1);
      if (op.equals("COALESCE")) {
        if (!first.type().equals(second.type())) bad("PREPARATION_EXPRESSION_TYPE_MISMATCH");
        ValueKind kind = first.valueKind() == ValueKind.NON_ADDITIVE || second.valueKind() == ValueKind.NON_ADDITIVE
            ? ValueKind.NON_ADDITIVE : first.valueKind();
        return new Expression("COALESCE(" + first.sql() + ", " + second.sql() + ")", first.type(), kind);
      }
      if (op.equals("CONCAT")) {
        if (!first.type().equals("text") || !second.type().equals("text")) bad("PREPARATION_EXPRESSION_TYPE_MISMATCH");
        ValueKind kind = first.valueKind() == ValueKind.DETAIL && second.valueKind() == ValueKind.DETAIL
            ? ValueKind.DETAIL : ValueKind.NON_ADDITIVE;
        return new Expression("(" + first.sql() + " || " + second.sql() + ")", "text", kind);
      }
      if (!numeric(first.type()) || !numeric(second.type())) bad("PREPARATION_EXPRESSION_TYPE_MISMATCH");
      String operator = switch (op) { case "ADD" -> "+"; case "SUBTRACT" -> "-"; case "MULTIPLY" -> "*"; default -> "/"; };
      String right = op.equals("DIVIDE") ? "NULLIF(CAST(" + second.sql() + " AS numeric), 0)" : "CAST(" + second.sql() + " AS numeric)";
      ValueKind kind = op.equals("DIVIDE") || first.valueKind() != ValueKind.DETAIL || second.valueKind() != ValueKind.DETAIL
          ? ValueKind.NON_ADDITIVE : ValueKind.DETAIL;
      return new Expression("(CAST(" + first.sql() + " AS numeric) " + operator + " " + right + ")", "numeric", kind);
    }

    Relation filter(JsonNode step) {
      shape(step, "id", "type", "input", "mode", "conditions");
      Relation source = visit(id(step, "input"));
      String mode = text(step, "mode");
      if (!Set.of("ALL", "ANY").contains(mode)) bad("PREPARATION_INVALID_FILTER_MODE");
      var predicates = new ArrayList<String>();
      for (JsonNode condition : array(step, "conditions", 1, 100)) {
        shape(condition, "field", "operator", "value");
        Field field = field(source, text(condition, "field"));
        String op = text(condition, "operator");
        if (op.equals("IS_NULL") || op.equals("IS_NOT_NULL")) {
          if (condition.has("value")) bad("PREPARATION_INVALID_FILTER_VALUE");
          predicates.add(quote(field.name()) + (op.equals("IS_NULL") ? " IS NULL" : " IS NOT NULL"));
        } else {
          String operator = switch (op) {
            case "EQ" -> "="; case "NE" -> "<>"; case "GT" -> ">"; case "GTE" -> ">="; case "LT" -> "<"; case "LTE" -> "<=";
            default -> { bad("PREPARATION_INVALID_FILTER_OPERATOR"); yield ""; }
          };
          JsonNode value = condition.path("value");
          if (!value.has("literal") || value.path("literal").isNull()) bad("PREPARATION_INVALID_FILTER_VALUE");
          Expression comparison = expression(value, source, 0);
          if (!comparison.type().equals(field.type())) bad("PREPARATION_EXPRESSION_TYPE_MISMATCH");
          predicates.add(quote(field.name()) + " " + operator + " " + comparison.sql());
        }
      }
      return emit("SELECT " + columns(source.fields()) + " FROM " + quote(source.name()) + " WHERE "
          + String.join(mode.equals("ALL") ? " AND " : " OR ", predicates), source.fields());
    }

    Relation deduplicate(JsonNode step) {
      shape(step, "id", "type", "input", "keys", "order");
      Relation source = visit(id(step, "input"));
      List<String> keys = names(step, "keys", 1, source);
      var ordering = new ArrayList<String>(keys.stream().map(ModelService::quote).toList());
      var covered = new HashSet<>(keys);
      for (JsonNode item : array(step, "order", 0, 200)) {
        shape(item, "field", "direction", "nulls");
        String name = text(item, "field");
        field(source, name);
        if (!covered.add(name)) bad("PREPARATION_DUPLICATE_ORDER_FIELD");
        String direction = text(item, "direction"), nulls = text(item, "nulls");
        if (!Set.of("ASC", "DESC").contains(direction) || !Set.of("FIRST", "LAST").contains(nulls)) bad("PREPARATION_INVALID_ORDER");
        ordering.add(quote(name) + " " + direction + " NULLS " + nulls);
      }
      // Every distinguishing value needs an explicit tie breaker; identical rows may tie.
      if (covered.size() != source.fields().size()) bad("PREPARATION_DEDUPLICATION_ORDER_INCOMPLETE");
      return emit("SELECT DISTINCT ON (" + String.join(", ", keys.stream().map(ModelService::quote).toList()) + ") "
          + columns(source.fields()) + " FROM " + quote(source.name()) + " ORDER BY " + String.join(", ", ordering), source.fields());
    }

    Relation join(JsonNode step) {
      shape(step, "id", "type", "left", "right", "mode", "on", "fields");
      Relation left = visit(id(step, "left")), right = visit(id(step, "right"));
      String mode = text(step, "mode");
      if (!Set.of("INNER", "LEFT").contains(mode)) bad("PREPARATION_INVALID_JOIN_MODE");
      var predicates = new ArrayList<String>();
      for (JsonNode key : array(step, "on", 1, 32)) {
        shape(key, "left", "right");
        Field l = field(left, text(key, "left")), r = field(right, text(key, "right"));
        if (!l.type().equals(r.type())) bad("PREPARATION_JOIN_TYPE_MISMATCH");
        predicates.add("l." + quote(l.name()) + " = r." + quote(r.name()));
      }
      var fields = new ArrayList<Field>();
      var selected = new ArrayList<String>();
      for (JsonNode item : array(step, "fields", 1, 200)) {
        shape(item, "side", "field", "name");
        String side = text(item, "side");
        if (!Set.of("left", "right").contains(side)) bad("PREPARATION_INVALID_JOIN_SIDE");
        Field field = field(side.equals("left") ? left : right, text(item, "field"));
        String name = id(item, "name");
        fields.add(new Field(name, field.type(), field.valueKind()));
        selected.add((side.equals("left") ? "l." : "r.") + quote(field.name()) + " AS " + quote(name));
      }
      return emit("SELECT " + String.join(", ", selected) + " FROM " + quote(left.name()) + " l " + mode
          + " JOIN " + quote(right.name()) + " r ON " + String.join(" AND ", predicates), fields);
    }

    Relation union(JsonNode step) {
      shape(step, "id", "type", "inputs", "mode");
      String mode = text(step, "mode");
      if (!Set.of("ALL", "DISTINCT").contains(mode)) bad("PREPARATION_INVALID_UNION_MODE");
      List<Field> fields = null;
      var queries = new ArrayList<String>();
      for (JsonNode ref : array(step, "inputs", 2, 32)) {
        if (!ref.isTextual()) bad("PREPARATION_INVALID_UNION_INPUT");
        Relation relation = visit(ref.asText());
        if (fields != null && !fields.equals(relation.fields())) bad("PREPARATION_UNION_SCHEMA_MISMATCH");
        fields = relation.fields();
        queries.add("SELECT " + columns(fields) + " FROM " + quote(relation.name()));
      }
      return emit(String.join(mode.equals("ALL") ? " UNION ALL " : " UNION ", queries), fields);
    }

    Relation aggregate(JsonNode step) {
      shape(step, "id", "type", "input", "groupBy", "measures");
      Relation source = visit(id(step, "input"));
      List<String> groups = names(step, "groupBy", 0, source);
      var fields = new ArrayList<Field>(groups.stream().map(name -> field(source, name)).toList());
      var selected = new ArrayList<String>(groups.stream().map(ModelService::quote).toList());
      for (JsonNode measure : array(step, "measures", 1, 100)) {
        shape(measure, "name", "op", "field", "sumName", "countName");
        String op = text(measure, "op"), name = id(measure, "name");
        if (!op.equals("AVG") && (measure.has("sumName") || measure.has("countName"))) bad("PREPARATION_UNKNOWN_PROPERTY");
        if (op.equals("COUNT_ROWS")) {
          if (measure.has("field")) bad("PREPARATION_UNKNOWN_PROPERTY");
          fields.add(new Field(name, "bigint", ValueKind.ADDITIVE));
          selected.add("COUNT(*) AS " + quote(name));
          continue;
        }
        Field field = field(source, text(measure, "field"));
        String column = quote(field.name());
        String sql, type;
        switch (op) {
          case "COUNT", "COUNT_DISTINCT" -> {
            sql = "COUNT(" + (op.equals("COUNT_DISTINCT") ? "DISTINCT " : "") + column + ")";
            type = "bigint";
          }
          case "SUM", "AVG" -> {
            if (!numeric(field.type())) bad("PREPARATION_AGGREGATE_TYPE_MISMATCH");
            if (field.valueKind() == ValueKind.NON_ADDITIVE) bad("PREPARATION_NON_ADDITIVE_ROLLUP");
            sql = op + "(CAST(" + column + " AS numeric))";
            type = "numeric";
            if (op.equals("AVG")) {
              String sum = id(measure, "sumName"), count = id(measure, "countName");
              fields.add(new Field(sum, "numeric", ValueKind.ADDITIVE));
              fields.add(new Field(count, "bigint", ValueKind.ADDITIVE));
              selected.add("SUM(CAST(" + column + " AS numeric)) AS " + quote(sum));
              selected.add("COUNT(" + column + ") AS " + quote(count));
            }
          }
          case "MIN", "MAX" -> {
            if (field.type().equals("boolean")) bad("PREPARATION_AGGREGATE_TYPE_MISMATCH");
            sql = op + "(" + column + ")";
            type = field.type();
          }
          default -> { bad("PREPARATION_UNKNOWN_AGGREGATE"); return null; }
        }
        ValueKind kind = Set.of("SUM", "COUNT").contains(op) ? ValueKind.ADDITIVE : ValueKind.NON_ADDITIVE;
        fields.add(new Field(name, type, kind));
        selected.add(sql + " AS " + quote(name));
      }
      return emit("SELECT " + String.join(", ", selected) + " FROM " + quote(source.name())
          + (groups.isEmpty() ? "" : " GROUP BY " + String.join(", ", groups.stream().map(ModelService::quote).toList())), fields);
    }
  }
}
