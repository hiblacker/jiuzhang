package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.shared.application.Failure;
import net.sf.jsqlparser.parser.CCJSqlParserConstants;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.select.PlainSelect;
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
    try {
      // Inspect lexer tokens so literals and ordinary comments are not treated as SQL.
      var lexer = CCJSqlParserUtil.newParser(sql);
      var syntax = new StringBuilder();
      while (true) {
        var token = lexer.getNextToken();
        for (var comment = token.specialToken; comment != null; comment = comment.specialToken)
          if (comment.image.startsWith("/*!") || comment.image.startsWith("/*M!"))
            throw new Failure(422, "UNSUPPORTED_SQL");
        if (token.kind == CCJSqlParserConstants.EOF) break;
        String text = token.image;
        if (token.kind == CCJSqlParserConstants.S_CHAR_LITERAL) text = "?";
        else if (token.kind == CCJSqlParserConstants.S_QUOTED_IDENTIFIER) {
          String name = text.substring(1, text.length() - 1);
          // Quoted column names are not keywords, but quoted function names still execute.
          text = SIDE_EFFECT_FUNCTION.matcher(name + "(").find()
                  || USER_VARIABLE_WRITE.matcher(name + "(").find()
              ? name : "quoted_identifier";
        }
        syntax.append(text).append(' ');
      }
      if (SIDE_EFFECT_FUNCTION.matcher(syntax).find()
          || FILE_OUTPUT.matcher(syntax).find()
          || ROW_LOCK.matcher(syntax).find()
          || USER_VARIABLE_WRITE.matcher(syntax).find())
        throw new Failure(422, "UNSUPPORTED_SQL");
      var statements = CCJSqlParserUtil.parseStatements(sql).getStatements();
      if (statements.size() != 1 || !(statements.getFirst() instanceof Select select))
        throw new Failure(422, "UNSUPPORTED_SQL");
      if (select.getForUpdateTable() != null
          || select.getForMode() != null
          || select.getForClause() != null
          || select.isSkipLocked()) throw new Failure(422, "UNSUPPORTED_SQL");
      if (select instanceof PlainSelect plain
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
