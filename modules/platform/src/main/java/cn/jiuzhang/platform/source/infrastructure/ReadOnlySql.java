package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.shared.application.Failure;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.select.Select;
import java.util.regex.Pattern;

final class ReadOnlySql {
  private static final Pattern SIDE_EFFECT_FUNCTION =
      Pattern.compile("\\b(GET_LOCK|RELEASE_LOCK|RELEASE_ALL_LOCKS|SLEEP|BENCHMARK|LOAD_FILE)\\s*\\(", Pattern.CASE_INSENSITIVE);
  private static final Pattern FILE_OUTPUT =
      Pattern.compile("\\bINTO\\b", Pattern.CASE_INSENSITIVE);
  private static final Pattern ROW_LOCK =
      Pattern.compile("\\bFOR\\s+(UPDATE|SHARE)\\b|\\bLOCK\\s+IN\\s+SHARE\\s+MODE\\b", Pattern.CASE_INSENSITIVE);
  private static final Pattern USER_VARIABLE_WRITE = Pattern.compile(":=|\\bLAST_INSERT_ID\\s*\\(", Pattern.CASE_INSENSITIVE);
  private ReadOnlySql() {}

  static String validate(String sql) {
    if (sql == null || sql.isBlank() || sql.length() > 8192)
      throw new Failure(422, "UNSUPPORTED_SQL");
    if (SIDE_EFFECT_FUNCTION.matcher(sql).find()
        || FILE_OUTPUT.matcher(sql).find()
        || ROW_LOCK.matcher(sql).find()
        || USER_VARIABLE_WRITE.matcher(sql).find())
      throw new Failure(422, "UNSUPPORTED_SQL");
    try {
      var statements = CCJSqlParserUtil.parseStatements(sql).getStatements();
      if (statements.size() != 1 || !(statements.getFirst() instanceof Select select))
        throw new Failure(422, "UNSUPPORTED_SQL");
      if (select.getForUpdateTable() != null
          || select.getForMode() != null
          || select.getForClause() != null
          || select.isSkipLocked()) throw new Failure(422, "UNSUPPORTED_SQL");
      var plain = select.getPlainSelect();
      if (plain != null
          && (plain.getIntoTempTable() != null
              || (plain.getIntoTables() != null && !plain.getIntoTables().isEmpty())))
        throw new Failure(422, "UNSUPPORTED_SQL");
      return sql.strip().replaceFirst(";\\s*$", "");
    } catch (Failure e) {
      throw e;
    } catch (Exception e) {
      throw new Failure(422, "UNSUPPORTED_SQL");
    }
  }
}
