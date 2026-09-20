package com.bydw.warehouse;

import static com.bydw.warehouse.PreparationPlanTest.INPUT;
import static com.bydw.warehouse.PreparationPlanTest.compile;
import static com.bydw.warehouse.PreparationPlanTest.plan;
import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Synthetic, transaction-scoped tables on an explicitly selected isolated database. */
@EnabledIfEnvironmentVariable(named = "PREPARATION_TEST_JDBC_URL", matches = "jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/preparation_test")
class PreparationPlanDatabaseTest {
  private Connection db;

  @BeforeEach void open() throws Exception {
    db = DriverManager.getConnection(System.getenv("PREPARATION_TEST_JDBC_URL"), "postgres",
        System.getenv().getOrDefault("PREPARATION_TEST_PASSWORD", ""));
    db.setAutoCommit(false);
    try (var statement = db.createStatement()) {
      statement.execute("SET LOCAL statement_timeout = '5s'");
      statement.execute("SET LOCAL timezone = 'Asia/Shanghai'");
      statement.execute("CREATE TEMP TABLE orders(id bigint, team text, amount numeric)");
      statement.execute("CREATE TEMP TABLE archive(LIKE orders)");
      statement.execute("INSERT INTO orders VALUES (1,' a ',10),(1,' a ',10),(2,' a ',NULL),(3,'b',30),(4,'b',20)");
      statement.execute("INSERT INTO archive VALUES (1,'old',9),(5,'c',50)");
    }
  }

  @AfterEach void close() throws Exception {
    if (db != null) {
      try { db.rollback(); } finally { db.close(); }
    }
  }

  private List<Map<String, Object>> execute(PreparationPlan.Compiled compiled) throws Exception {
    try (var statement = db.prepareStatement(compiled.sql())) {
      for (int i = 0; i < compiled.parameters().size(); i++) statement.setObject(i + 1, compiled.parameters().get(i));
      try (var rows = statement.executeQuery()) {
        var result = new ArrayList<Map<String, Object>>();
        assertThat(rows.getMetaData().getColumnCount()).isEqualTo(compiled.fields().size());
        while (rows.next()) {
          var row = new LinkedHashMap<String, Object>();
          for (int i = 0; i < compiled.fields().size(); i++) {
            assertThat(rows.getMetaData().getColumnLabel(i + 1)).isEqualTo(compiled.fields().get(i).name());
            row.put(compiled.fields().get(i).name(), rows.getObject(i + 1));
          }
          result.add(row);
        }
        return result;
      }
    }
  }

  @Test void cleansDeduplicatesFiltersAndAggregatesRealRows() throws Exception {
    var compiled = compile(plan("summary", "[\"team\"]", INPUT + "," + """
        {"id":"dedup","type":"DEDUPLICATE","input":"source","keys":["id"],"order":[
          {"field":"amount","direction":"DESC","nulls":"LAST"},
          {"field":"team","direction":"ASC","nulls":"FIRST"}
        ]},
        {"id":"clean","type":"SELECT","input":"dedup","fields":[
          {"name":"id","expression":{"field":"id"}},
          {"name":"team","expression":{"op":"TRIM","args":[{"field":"team"}]}},
          {"name":"amount","expression":{"field":"amount"}}
        ]},
        {"id":"filtered","type":"FILTER","input":"clean","mode":"ALL","conditions":[
          {"field":"id","operator":"GTE","value":{"literal":1,"type":"bigint"}},
          {"field":"id","operator":"LT","value":{"literal":4,"type":"bigint"}}
        ]},
        {"id":"summary","type":"AGGREGATE","input":"filtered","groupBy":["team"],"measures":[
          {"name":"average","op":"AVG","field":"amount","sumName":"total","countName":"samples"},
          {"name":"orders","op":"COUNT_DISTINCT","field":"id"},
          {"name":"rows","op":"COUNT_ROWS"}
        ]}
        """));
    var rows = execute(compiled);
    assertThat(rows).hasSize(2);
    var teamA = rows.stream().filter(row -> row.get("team").equals("a")).findFirst().orElseThrow();
    assertThat(teamA.get("orders")).isEqualTo(2L);
    assertThat(teamA.get("rows")).isEqualTo(2L);
    assertThat(teamA.get("samples")).isEqualTo(1L);
    assertThat((java.math.BigDecimal) teamA.get("total")).isEqualByComparingTo("10");
    assertThat((java.math.BigDecimal) teamA.get("average")).isEqualByComparingTo("10");
    assertThat(execute(compiled)).containsExactlyInAnyOrderElementsOf(rows);
  }

  @Test void joinPreservesUnmatchedRowsAndUnionModeIsExplicit() throws Exception {
    String inputs = INPUT + "," + INPUT.replace("source", "other").replace("orders", "archive");
    var joined = execute(compile(plan("joined", "[\"id\"]", inputs + "," + """
        {"id":"joined","type":"JOIN","left":"source","right":"other","mode":"LEFT",
         "on":[{"left":"id","right":"id"}],"fields":[
          {"side":"left","field":"id","name":"id"},
          {"side":"right","field":"team","name":"old_team"}
        ]}
        """)));
    assertThat(joined).hasSize(5);
    assertThat(joined.stream().filter(row -> row.get("old_team") == null).count()).isEqualTo(3);
    for (String mode : List.of("ALL", "DISTINCT")) {
      var union = compile(plan("combined", "[\"id\",\"team\",\"amount\"]", inputs + "," + """
          {"id":"combined","type":"UNION","inputs":["source","other"],"mode":"%s"}
          """.formatted(mode)));
      assertThat(execute(union)).hasSize(mode.equals("ALL") ? 7 : 6);
    }
  }

  @Test void nullArithmeticPrecisionAndInjectionShapedTextAreNotAltered() throws Exception {
    var compiled = compile(plan("result", "[\"id\"]", INPUT + "," + """
        {"id":"result","type":"SELECT","input":"source","fields":[
          {"name":"id","expression":{"field":"id"}},
          {"name":"zero_ratio","expression":{"op":"DIVIDE","args":[{"field":"amount"},{"literal":"0","type":"numeric"}]}},
          {"name":"filled","expression":{"op":"COALESCE","args":[{"field":"amount"},{"literal":"7","type":"numeric"}]}},
          {"name":"exact","expression":{"op":"ADD","args":[{"literal":"9007199254740993.01","type":"numeric"},{"literal":"0.02","type":"numeric"}]}},
          {"name":"note","expression":{"literal":"'; DROP TABLE orders; --","type":"text"}}
        ]}
        """));
    var rows = execute(compiled);
    assertThat(rows).hasSize(5);
    assertThat(rows).allSatisfy(row -> {
      assertThat(row.get("zero_ratio")).isNull();
      assertThat((java.math.BigDecimal) row.get("exact")).isEqualByComparingTo("9007199254740993.03");
      assertThat(row.get("note")).isEqualTo("'; DROP TABLE orders; --");
    });
    assertThat((java.math.BigDecimal) rows.stream().filter(r -> r.get("id").equals(2L)).findFirst().orElseThrow().get("filled"))
        .isEqualByComparingTo("7");
    assertThat(execute(compile(plan("source", "[\"id\"]", INPUT)))).hasSize(5);
  }

  @Test void parameterOrderFollowsDagCompilationNotEditorArrayOrder() throws Exception {
    var compiled = compile(plan("both", "[\"id\"]", """
        {"id":"both","type":"UNION","inputs":["second","first"],"mode":"ALL"},
        {"id":"first","type":"FILTER","input":"source","mode":"ALL","conditions":[
          {"field":"id","operator":"EQ","value":{"literal":3,"type":"bigint"}}
        ]},
        {"id":"second","type":"FILTER","input":"source","mode":"ALL","conditions":[
          {"field":"id","operator":"EQ","value":{"literal":4,"type":"bigint"}}
        ]},
        """ + INPUT));
    assertThat(compiled.parameters()).containsExactly(4L, 3L);
    assertThat(execute(compiled)).extracting(r -> r.get("id")).containsExactly(4L, 3L);
  }
}
