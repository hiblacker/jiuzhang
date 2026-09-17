package com.bydw.warehouse;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class SqlDefinitionValidatorTest {
  private static List<String> codes(SqlDefinitionValidator.Result result) {
    return result.issues().stream().map(SqlDefinitionValidator.Issue::code).toList();
  }

  @Test
  void acceptsReadOnlyQueriesIncludingJoinsAggregatesAndCtes() {
    assertThat(SqlDefinitionValidator.validate("SELECT id, amount FROM orders").blocked()).isFalse();
    assertThat(SqlDefinitionValidator.validate("""
        WITH recent AS (SELECT id, team_id FROM orders WHERE created_at > '2026-01-01')
        SELECT r.id, t.name, COUNT(*) AS c
          FROM recent r JOIN teams t ON t.id = r.team_id
         GROUP BY r.id, t.name
        """).blocked()).isFalse();
    assertThat(SqlDefinitionValidator.validate(
        "SELECT a.id FROM orders a UNION ALL SELECT b.id FROM orders_archive b").blocked()).isFalse();
  }

  @Test
  void rejectsWritesAndDdl() {
    for (String sql : List.of("UPDATE orders SET amount = 1", "DELETE FROM orders", "DROP TABLE orders",
        "CREATE TABLE x (id INT)", "INSERT INTO orders VALUES (1)", "TRUNCATE TABLE orders",
        "SELECT 1 INTO OUTFILE '/tmp/x'", "CALL do_something()")) {
      assertThat(SqlDefinitionValidator.validate(sql).blocked()).as(sql).isTrue();
    }
  }

  @Test
  void rejectsMultipleStatementsAndNonQueries() {
    assertThat(codes(SqlDefinitionValidator.validate("SELECT 1; SELECT 2"))).contains("SQL_MULTIPLE_STATEMENTS");
    assertThat(codes(SqlDefinitionValidator.validate("SHOW TABLES"))).contains("SQL_NOT_A_QUERY");
    assertThat(SqlDefinitionValidator.validate("SELECT 1;").blocked()).isFalse();
  }

  @Test
  void rejectsSystemSchemasAndUndeclaredParameters() {
    assertThat(codes(SqlDefinitionValidator.validate("SELECT * FROM information_schema.tables")))
        .contains("SQL_SYSTEM_SCHEMA");
    assertThat(codes(SqlDefinitionValidator.validate("SELECT * FROM mysql.user"))).contains("SQL_SYSTEM_SCHEMA");
    assertThat(codes(SqlDefinitionValidator.validate("SELECT {{evil}} FROM orders")))
        .contains("SQL_UNKNOWN_PARAMETER");
    assertThat(SqlDefinitionValidator.validate("SELECT '${x}' AS v FROM orders").blocked()).isTrue();
  }

  @Test
  void acceptsDeclaredParametersAndReportsThem() {
    var result = SqlDefinitionValidator.validate("""
        SELECT id, CAST(amount AS CHAR) AS amount
          FROM orders
         WHERE updated_at > '{{window_start}}' AND updated_at <= '{{window_end}}'
        """);
    assertThat(result.blocked()).isFalse();
    assertThat(result.placeholders()).containsExactly("window_start", "window_end");
    assertThat(result.referencedTables()).containsExactly("orders");
  }

  @Test
  void reportsTablesMissingFromTheApprovedList() {
    var result = SqlDefinitionValidator.validate("SELECT o.id FROM orders o JOIN customers c ON c.id = o.cid",
        List.of("orders"));
    assertThat(result.blocked()).isTrue();
    assertThat(codes(result)).contains("SQL_TABLE_NOT_APPROVED");
    assertThat(SqlDefinitionValidator.validate("SELECT id FROM `orders`", List.of("orders")).blocked()).isFalse();
  }

  @Test
  void warnsButDoesNotBlockOnStarAndSelfLimit() {
    var result = SqlDefinitionValidator.validate("SELECT * FROM orders LIMIT 10");
    assertThat(result.blocked()).isFalse();
    assertThat(codes(result)).contains("SQL_SELECT_STAR", "SQL_SELF_LIMIT");
  }

  @Test
  void stripsCommentsBeforeJudging() {
    assertThat(SqlDefinitionValidator.validate("SELECT 1 -- DELETE FROM x\n").blocked()).isFalse();
    assertThat(SqlDefinitionValidator.validate("SELECT /* DROP TABLE x */ 1").blocked()).isFalse();
    assertThat(SqlDefinitionValidator.validate("SELECT 1 /* comment").blocked()).isFalse();
  }
}
