package cn.jiuzhang.platform.source.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.jiuzhang.platform.shared.application.Failure;
import org.junit.jupiter.api.Test;

class ReadOnlySqlTest {
  @Test
  void acceptsReadOnlyQueriesWithJoinsCtesAndAggregates() {
    assertThat(ReadOnlySql.validate("WITH recent AS (SELECT id FROM orders) SELECT id FROM recent"))
        .startsWith("WITH recent");
    assertThat(ReadOnlySql.validate(
            "SELECT c.name, SUM(o.amount) AS revenue FROM customers c JOIN orders o ON o.customer_id=c.id GROUP BY c.name"))
        .contains("SUM(o.amount)");
  }

  @Test
  void acceptsSetOperationsWindowsSubqueriesAndLiteralKeywords() {
    for (var sql : new String[] {
      "SELECT id FROM orders UNION ALL SELECT id FROM orders",
      "(SELECT id FROM orders)",
      "SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS row_number FROM orders",
      "SELECT id FROM orders WHERE id IN (SELECT id FROM orders)",
      "SELECT 'INTO' AS label, 'SLEEP(5)' AS description FROM orders",
      "SELECT `into` FROM orders /* SLEEP(5) */"
    }) {
      assertThat(ReadOnlySql.validate(sql)).isEqualTo(sql);
    }
  }

  @Test
  void rejectsWritesMultipleStatementsAndKnownSideEffects() {
    for (var sql : new String[] {
      "UPDATE orders SET amount=0",
      "SELECT 1; DELETE FROM orders",
      "SELECT SLEEP(30)",
      "SELECT GET_LOCK('x', 10)",
      "SELECT id FROM orders INTO OUTFILE '/tmp/export.csv'",
      "SELECT id FROM orders FOR UPDATE",
      "SELECT id FROM orders LOCK IN SHARE MODE",
      "SELECT @next_id := id FROM orders",
      "SELECT LAST_INSERT_ID(5)"
    }) {
      assertThatThrownBy(() -> ReadOnlySql.validate(sql)).isInstanceOf(Failure.class);
    }
  }

  @Test
  void rejectsCommentSeparatedNestedAndQuotedSideEffects() {
    for (var sql : new String[] {
      "SELECT SLEEP/**/(30)",
      "SELECT `GET_LOCK`('x', 10)",
      "SELECT id FROM orders FOR/**/UPDATE",
      "SELECT (SELECT GET_LOCK('x',10)) FROM orders",
      "WITH x AS (SELECT SLEEP(30)) SELECT * FROM x",
      "SELECT 1 UNION ALL SELECT SLEEP(30)",
      "SELECT 1 /*!50000 INTO OUTFILE '/tmp/export.csv' */"
    }) {
      assertThatThrownBy(() -> ReadOnlySql.validate(sql)).isInstanceOf(Failure.class);
    }
  }
}
