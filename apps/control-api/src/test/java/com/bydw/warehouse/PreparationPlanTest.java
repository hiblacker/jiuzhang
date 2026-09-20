package com.bydw.warehouse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PreparationPlanTest {
  static final ObjectMapper JSON = new ObjectMapper();
  static final List<PreparationPlan.Field> FIELDS = List.of(
      new PreparationPlan.Field("id", "bigint"), new PreparationPlan.Field("team", "text"),
      new PreparationPlan.Field("amount", "numeric"));
  static final Map<String, PreparationPlan.Input> INPUTS = Map.of(
      "orders", new PreparationPlan.Input("pg_temp", "orders", FIELDS),
      "archive", new PreparationPlan.Input("pg_temp", "archive", FIELDS));

  static ObjectNode plan(String output, String keys, String steps) throws Exception {
    return (ObjectNode) JSON.readTree("{\"version\":1,\"grain\":\"One row per declared key\",\"output\":\""
        + output + "\",\"uniqueKey\":" + keys + ",\"steps\":[" + steps + "]}");
  }

  static final String INPUT = "{\"id\":\"source\",\"type\":\"INPUT\",\"binding\":\"orders\"}";
  static PreparationPlan.Compiled compile(JsonNode plan) { return PreparationPlan.compile(plan, INPUTS); }

  private static void rejects(JsonNode plan, String code) {
    assertThatThrownBy(() -> compile(plan)).isInstanceOfSatisfying(ApiException.class,
        error -> assertThat(error.code()).isEqualTo(code));
  }

  @Test void projectsRenamesCastsCleansAndComputesWithBoundLiterals() throws Exception {
    var result = compile(plan("clean", "[\"order_id\"]", INPUT + "," + """
        {"id":"clean","type":"SELECT","input":"source","fields":[
          {"name":"order_id","expression":{"field":"id"}},
          {"name":"team","expression":{"op":"TRIM","args":[{"field":"team"}]}},
          {"name":"amount","expression":{"op":"COALESCE","args":[{"field":"amount"},{"literal":"0","type":"numeric"}]}},
          {"name":"ratio","expression":{"op":"DIVIDE","args":[{"field":"amount"},{"literal":"0","type":"numeric"}]}},
          {"name":"label","expression":{"op":"CAST","to":"text","args":[{"field":"id"}]}}
        ]}
        """));
    assertThat(result.fields()).extracting(PreparationPlan.Field::name).containsExactly("order_id", "team", "amount", "ratio", "label");
    assertThat(result.sql()).contains("TRIM(\"team\")", "COALESCE(", "NULLIF(", "CAST(\"id\" AS text)");
    assertThat(result.parameters()).hasSize(2);
    assertThat(result.inputBindings()).containsExactly("orders");
  }

  @Test void parameterizesInjectionShapedValuesAndAllowsTypedNulls() throws Exception {
    var body = plan("pick", "[\"id\"]", INPUT + "," + """
        {"id":"pick","type":"SELECT","input":"source","fields":[
          {"name":"id","expression":{"field":"id"}},
          {"name":"note","expression":{"literal":"'; DROP TABLE orders; --","type":"text"}},
          {"name":"empty","expression":{"literal":null,"type":"text"}}
        ]}
        """);
    var result = compile(body);
    assertThat(result.sql()).doesNotContain("DROP TABLE");
    assertThat(result.parameters()).containsExactly("'; DROP TABLE orders; --", null);
    assertThatThrownBy(() -> result.parameters().add("changed")).isInstanceOf(UnsupportedOperationException.class);
  }

  @Test void acceptsOutOfOrderDagAndCompilesSharedNodesOnce() throws Exception {
    var result = compile(plan("both", "[\"id\"]", """
        {"id":"both","type":"UNION","inputs":["source","source"],"mode":"ALL"},
        """ + INPUT));
    assertThat(result.stepOrder()).containsExactly("source", "both");
    assertThat(result.inputBindings()).containsExactly("orders");
    assertThat(result.sql()).contains("UNION ALL");
  }

  @Test void rejectsCyclesMissingReferencesAndDisconnectedSteps() throws Exception {
    rejects(plan("a", "[\"id\"]", """
        {"id":"a","type":"SELECT","input":"b","fields":[]},
        {"id":"b","type":"SELECT","input":"a","fields":[]}
        """), "PREPARATION_CYCLE");
    rejects(plan("missing", "[\"id\"]", INPUT), "PREPARATION_STEP_NOT_FOUND");
    rejects(plan("source", "[\"id\"]", INPUT + "," + INPUT.replace("source", "unused")), "PREPARATION_UNUSED_STEP");
    rejects(plan("source", "[\"id\"]", INPUT + "," + INPUT), "PREPARATION_DUPLICATE_STEP");
    rejects(plan("source", "[\"id\"]", INPUT.replace("orders", "unresolved")), "PREPARATION_INPUT_NOT_RESOLVED");
  }

  @Test void rejectsSqlExpressionsUnknownKeysAndHostileIdentifiers() throws Exception {
    var body = plan("source", "[\"id\"]", INPUT);
    rejects(body.deepCopy().put("sql", "SELECT 1"), "PREPARATION_UNKNOWN_PROPERTY");
    rejects(body.deepCopy().put("output", "x; SELECT 1"), "INVALID_IDENTIFIER");
    rejects(plan("pick", "[\"id\"]", INPUT + "," + """
        {"id":"pick","type":"SELECT","input":"source","fields":[
          {"name":"id","expression":{"op":"pg_sleep","args":[{"literal":1,"type":"integer"}]}}
        ]}
        """), "PREPARATION_UNKNOWN_EXPRESSION");
    assertThatThrownBy(() -> new PreparationPlan.Input("public; --", "orders", FIELDS)).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> new PreparationPlan.Field("id", "numeric); SELECT 1 --")).isInstanceOf(ApiException.class);
  }

  @Test void rejectsInvalidTypesUnknownFieldsAndImplicitTruncation() throws Exception {
    String template = """
        {"id":"pick","type":"SELECT","input":"source","fields":[{"name":"id","expression":%s}]}
        """;
    for (String value : List.of("{\"literal\":1.5,\"type\":\"bigint\"}", "{\"literal\":\"9223372036854775808\",\"type\":\"bigint\"}",
        "{\"literal\":\"true\",\"type\":\"boolean\"}", "{\"literal\":\"1e10000000\",\"type\":\"numeric\"}")) {
      rejects(plan("pick", "[\"id\"]", INPUT + "," + template.formatted(value)), "PREPARATION_INVALID_LITERAL");
    }
    rejects(plan("pick", "[\"id\"]", INPUT + "," + template.formatted("{\"field\":\"absent\"}")), "PREPARATION_UNKNOWN_FIELD");
    rejects(plan("pick", "[\"id\"]", INPUT + "," + template.formatted("{\"op\":\"TRIM\",\"args\":[{\"field\":\"id\"}]}")), "PREPARATION_EXPRESSION_TYPE_MISMATCH");
  }

  @Test void requiresOutputGrainUniqueKeysAndUniqueFieldNames() throws Exception {
    rejects(plan("source", "[]", INPUT), "PREPARATION_INVALID_UNIQUEKEY");
    rejects(plan("source", "[\"absent\"]", INPUT), "PREPARATION_UNKNOWN_FIELD");
    rejects(plan("source", "[\"id\",\"id\"]", INPUT), "PREPARATION_INVALID_FIELD_LIST");
    rejects(plan("source", "[\"id\"]", INPUT).put("grain", " "), "PREPARATION_REQUIRED_GRAIN");
    rejects(plan("pick", "[\"id\"]", INPUT + "," + """
        {"id":"pick","type":"SELECT","input":"source","fields":[
          {"name":"id","expression":{"field":"id"}},
          {"name":"id","expression":{"field":"amount"}}
        ]}
        """), "PREPARATION_DUPLICATE_FIELD");
  }

  @Test void filtersUseExplicitNullPredicatesAndHalfOpenComparisons() throws Exception {
    var body = plan("filtered", "[\"id\"]", INPUT + "," + """
        {"id":"filtered","type":"FILTER","input":"source","mode":"ALL","conditions":[
          {"field":"id","operator":"GTE","value":{"literal":10,"type":"bigint"}},
          {"field":"id","operator":"LT","value":{"literal":20,"type":"bigint"}},
          {"field":"team","operator":"IS_NOT_NULL"}
        ]}
        """);
    var result = compile(body);
    assertThat(result.sql()).contains("\"id\" >= CAST(? AS bigint) AND \"id\" < CAST(? AS bigint) AND \"team\" IS NOT NULL");
    assertThat(result.parameters()).containsExactly(10L, 20L);
    ((ObjectNode) body.at("/steps/1/conditions/0/value")).putNull("literal");
    rejects(body, "PREPARATION_INVALID_FILTER_VALUE");
  }

  @Test void deduplicationRequiresExplicitCompleteTieBreakOrder() throws Exception {
    var body = plan("dedup", "[\"id\"]", INPUT + "," + """
        {"id":"dedup","type":"DEDUPLICATE","input":"source","keys":["id"],"order":[
          {"field":"amount","direction":"DESC","nulls":"LAST"},
          {"field":"team","direction":"ASC","nulls":"FIRST"}
        ]}
        """);
    assertThat(compile(body).sql()).contains("DISTINCT ON (\"id\")", "ORDER BY \"id\", \"amount\" DESC NULLS LAST, \"team\" ASC NULLS FIRST");
    ((com.fasterxml.jackson.databind.node.ArrayNode) body.at("/steps/1/order")).remove(1);
    rejects(body, "PREPARATION_DEDUPLICATION_ORDER_INCOMPLETE");
  }

  @Test void joinsRequireTypedKeysAndExplicitUnambiguousProjection() throws Exception {
    var body = plan("joined", "[\"id\"]", INPUT + "," + INPUT.replace("source", "other").replace("orders", "archive") + "," + """
        {"id":"joined","type":"JOIN","left":"source","right":"other","mode":"LEFT",
         "on":[{"left":"id","right":"id"}],"fields":[
          {"side":"left","field":"id","name":"id"},
          {"side":"right","field":"team","name":"previous_team"}
        ]}
        """);
    assertThat(compile(body).sql()).contains("LEFT JOIN", "l.\"id\" = r.\"id\"", "r.\"team\" AS \"previous_team\"");
    ((ObjectNode) body.at("/steps/2/on/0")).put("right", "team");
    rejects(body, "PREPARATION_JOIN_TYPE_MISMATCH");
  }

  @Test void unionsRejectMismatchedOrderAndTypes() throws Exception {
    var body = plan("both", "[\"id\"]", INPUT + "," + INPUT.replace("source", "other").replace("orders", "archive") + "," + """
        {"id":"both","type":"UNION","inputs":["source","other"],"mode":"DISTINCT"}
        """);
    assertThat(compile(body).sql()).contains(" UNION ").doesNotContain("UNION ALL");
    var mismatched = Map.of("orders", INPUTS.get("orders"), "archive",
        new PreparationPlan.Input("pg_temp", "archive", List.of(new PreparationPlan.Field("id", "text"))));
    assertThatThrownBy(() -> PreparationPlan.compile(body, mismatched)).isInstanceOfSatisfying(ApiException.class,
        e -> assertThat(e.code()).isEqualTo("PREPARATION_UNION_SCHEMA_MISMATCH"));
  }

  @Test void aggregatesPreserveAverageNumeratorAndNonNullSampleCount() throws Exception {
    var body = plan("summary", "[\"team\"]", INPUT + "," + """
        {"id":"summary","type":"AGGREGATE","input":"source","groupBy":["team"],"measures":[
          {"name":"average","op":"AVG","field":"amount","sumName":"amount_sum","countName":"amount_samples"},
          {"name":"orders","op":"COUNT_DISTINCT","field":"id"},
          {"name":"rows","op":"COUNT_ROWS"}
        ]}
        """);
    var result = compile(body);
    assertThat(result.fields()).extracting(PreparationPlan.Field::name).containsExactly("team", "amount_sum", "amount_samples", "average", "orders", "rows");
    assertThat(result.sql()).contains("COUNT(\"amount\") AS \"amount_samples\"", "SUM(CAST(\"amount\" AS numeric))", "GROUP BY \"team\"");
    ((ObjectNode) body.at("/steps/1/measures/0")).remove("sumName");
    rejects(body, "PREPARATION_REQUIRED_SUMNAME");
  }

  @Test void rejectsOversizedGraphsAndDeepExpressions() throws Exception {
    var body = plan("source", "[\"id\"]", INPUT);
    var steps = body.withArray("steps");
    for (int i = 0; i < 64; i++) steps.addObject().put("id", "s" + i).put("type", "INPUT").put("binding", "orders");
    rejects(body, "PREPARATION_INVALID_STEPS");
    String expression = "{\"field\":\"team\"}";
    for (int i = 0; i < 14; i++) expression = "{\"op\":\"TRIM\",\"args\":[" + expression + "]}";
    rejects(plan("pick", "[\"id\"]", INPUT + ",{\"id\":\"pick\",\"type\":\"SELECT\",\"input\":\"source\",\"fields\":[{\"name\":\"id\",\"expression\":" + expression + "}]}"), "PREPARATION_EXPRESSION_TOO_DEEP");
  }

  @Test void rejectsNonAdditiveRollupsEvenAfterRenameCastOrNullHandling() throws Exception {
    String steps = INPUT + "," + """
        {"id":"summary","type":"AGGREGATE","input":"source","groupBy":["team"],"measures":[
          {"name":"average","op":"AVG","field":"amount","sumName":"total","countName":"samples"},
          {"name":"distinct_orders","op":"COUNT_DISTINCT","field":"id"}
        ]},
        {"id":"renamed","type":"SELECT","input":"summary","fields":[
          {"name":"team","expression":{"field":"team"}},
          {"name":"value","expression":%s}
        ]},
        {"id":"rollup","type":"AGGREGATE","input":"renamed","groupBy":["team"],"measures":[
          {"name":"value","op":"SUM","field":"value"}
        ]}
        """;
    for (String expr : List.of("{\"field\":\"average\"}", "{\"field\":\"distinct_orders\"}",
        "{\"op\":\"CAST\",\"to\":\"numeric\",\"args\":[{\"field\":\"average\"}]}",
        "{\"op\":\"COALESCE\",\"args\":[{\"field\":\"average\"},{\"literal\":0,\"type\":\"numeric\"}]}")) {
      rejects(plan("rollup", "[\"team\"]", steps.formatted(expr)), "PREPARATION_NON_ADDITIVE_ROLLUP");
    }
    var valid = compile(plan("rollup", "[\"team\"]", steps.formatted("{\"field\":\"total\"}")));
    assertThat(valid.fields().get(1).valueKind()).isEqualTo(PreparationPlan.ValueKind.ADDITIVE);
  }

  @Test void propagatesTrustedUpstreamNonAdditiveMetadata() throws Exception {
    var inputs = Map.of("orders", new PreparationPlan.Input("pg_temp", "released_monthly",
        List.of(new PreparationPlan.Field("id", "bigint"),
            new PreparationPlan.Field("amount", "numeric", PreparationPlan.ValueKind.NON_ADDITIVE))));
    var body = plan("bad_rollup", "[\"id\"]", INPUT + "," + """
        {"id":"bad_rollup","type":"AGGREGATE","input":"source","groupBy":["id"],"measures":[
          {"name":"total","op":"SUM","field":"amount"}
        ]}
        """);
    assertThatThrownBy(() -> PreparationPlan.compile(body, inputs)).isInstanceOfSatisfying(ApiException.class,
        e -> assertThat(e.code()).isEqualTo("PREPARATION_NON_ADDITIVE_ROLLUP"));
    assertThatThrownBy(() -> PreparationPlan.compile(null, inputs)).isInstanceOf(ApiException.class);
  }
}
