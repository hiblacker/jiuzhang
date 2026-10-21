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
}
