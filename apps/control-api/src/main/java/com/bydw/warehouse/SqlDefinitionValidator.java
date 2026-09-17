package com.bydw.warehouse;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Static gate for registered SQL. Read-only queries are allowed as they are - joins,
 * unions, CTEs, subqueries and aggregation included (ADR-012). What this rejects is
 * the safety boundary: writes and DDL, multiple statements, cross-database and system
 * schemas, side-effecting functions, undeclared placeholders and a self-imposed LIMIT.
 *
 * The database remains the final authority; this is a pre-flight, not a sandbox.
 */
public final class SqlDefinitionValidator {
  public record Issue(String level, String code, String message, Integer line) {}

  public record Result(boolean blocked, List<Issue> issues, List<String> referencedTables, List<String> placeholders) {}

  /** Parameter names the platform injects; a query may only use these. */
  public static final Set<String> INJECTABLE_PARAMETERS = Set.of(
      "window_start", "window_end", "batch_id", "source_timezone", "limit");

  private static final List<String[]> FORBIDDEN = List.of(
      new String[] {"INSERT", "写入语句不允许；只能查询"},
      new String[] {"UPDATE", "写入语句不允许；只能查询"},
      new String[] {"DELETE", "写入语句不允许；只能查询"},
      new String[] {"REPLACE", "写入语句不允许；只能查询"},
      new String[] {"MERGE", "写入语句不允许；只能查询"},
      new String[] {"DROP", "改结构语句不允许"},
      new String[] {"ALTER", "改结构语句不允许"},
      new String[] {"CREATE", "改结构语句不允许"},
      new String[] {"TRUNCATE", "改结构语句不允许"},
      new String[] {"RENAME", "改结构语句不允许"},
      new String[] {"GRANT", "权限语句不允许"},
      new String[] {"REVOKE", "权限语句不允许"},
      new String[] {"CALL", "存储过程调用不允许"},
      new String[] {"EXECUTE", "动态执行不允许"},
      new String[] {"PREPARE", "动态执行不允许"},
      new String[] {"DEALLOCATE", "动态执行不允许"},
      new String[] {"LOAD_FILE", "文件读取函数不允许"},
      new String[] {"LOAD DATA", "文件写入不允许"},
      new String[] {"INTO OUTFILE", "导出到文件不允许"},
      new String[] {"INTO DUMPFILE", "导出到文件不允许"},
      new String[] {"LOCK TABLES", "显式加锁不允许"},
      new String[] {"UNLOCK TABLES", "显式加锁不允许"},
      new String[] {"HANDLER", "直接句柄访问不允许"});

  private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{\\s*([A-Za-z0-9_]{1,40})\\s*}}");
  private static final Pattern DOLLAR_PARAM = Pattern.compile("\\$\\{");
  private static final Pattern SYSTEM_SCHEMA = Pattern.compile(
      "(?i)\\b(information_schema|performance_schema|mysql|sys)\\s*\\.");
  private static final Pattern TABLE_REFERENCE = Pattern.compile(
      "(?i)\\b(?:from|join)\\s+([`\"\\[]?[A-Za-z0-9_$]+[`\"\\]]?(?:\\s*\\.\\s*[`\"\\[]?[A-Za-z0-9_$]+[`\"\\]]?)?)");
  private static final Pattern SELECT_STAR = Pattern.compile("(?i)\\bselect\\s+(?:[a-z0-9_]+\\.)?\\*");

  private SqlDefinitionValidator() {}

  /** Removes line and block comments. String literals are preserved; the caller may not
   *  rely on this for security - the database re-parses everything. */
  static String stripComments(String sql) {
    StringBuilder out = new StringBuilder(sql.length());
    boolean inSingle = false, inDouble = false;
    for (int i = 0; i < sql.length(); i++) {
      char c = sql.charAt(i);
      char next = i + 1 < sql.length() ? sql.charAt(i + 1) : '\0';
      if (!inSingle && !inDouble && c == '-' && next == '-') {
        while (i < sql.length() && sql.charAt(i) != '\n') i++;
        out.append('\n');
        continue;
      }
      if (!inSingle && !inDouble && c == '/' && next == '*') {
        i += 2;
        while (i + 1 < sql.length() && !(sql.charAt(i) == '*' && sql.charAt(i + 1) == '/')) i++;
        i++;
        out.append(' ');
        continue;
      }
      if (c == '\'' && !inDouble) inSingle = !inSingle;
      else if (c == '"' && !inSingle) inDouble = !inDouble;
      out.append(c);
    }
    return out.toString();
  }

  /** Bare table name in lower case: the last dotted segment, without quoting. */
  static String normalizeTable(String raw) {
    String value = raw.replaceAll("[`\"\\[\\]\\s]", "");
    int dot = value.lastIndexOf('.');
    String last = dot >= 0 ? value.substring(dot + 1) : value;
    return last.toLowerCase(Locale.ROOT);
  }

  public static Result validate(String sql) {
    return validate(sql, List.of());
  }

  /**
   * @param allowedTables approved object names for this datasource; when empty the
   *                      table check is skipped (the datasource itself is the boundary)
   */
  public static Result validate(String sql, List<String> allowedTables) {
    List<Issue> issues = new ArrayList<>();
    List<String> tables = new ArrayList<>();
    List<String> placeholders = new ArrayList<>();
    if (sql == null || sql.isBlank()) {
      issues.add(new Issue("BLOCK", "SQL_EMPTY", "SQL 不能为空", null));
      return new Result(true, issues, tables, placeholders);
    }
    String scrubbed = stripComments(sql);
    String trimmed = scrubbed.trim();
    if (trimmed.endsWith(";")) trimmed = trimmed.substring(0, trimmed.length() - 1).trim();
    if (trimmed.contains(";")) {
      issues.add(new Issue("BLOCK", "SQL_MULTIPLE_STATEMENTS", "只能有一条查询语句", lineOf(scrubbed, ';')));
    }
    String lowered = trimmed.toLowerCase(Locale.ROOT);
    if (!lowered.startsWith("select") && !lowered.startsWith("with")) {
      issues.add(new Issue("BLOCK", "SQL_NOT_A_QUERY", "只允许查询（SELECT 或 WITH）", 1));
    }
    if (lowered.contains("${")) {
      issues.add(new Issue("BLOCK", "SQL_FREE_INTERPOLATION", "不允许 ${...} 形式的自由插值；请使用平台参数", null));
    }
    if (DOLLAR_PARAM.matcher(trimmed).find()) {
      issues.add(new Issue("BLOCK", "SQL_FREE_INTERPOLATION", "不允许 ${...} 形式的自由插值；请使用平台参数", null));
    }
    for (String[] entry : FORBIDDEN) {
      Pattern pattern = Pattern.compile("(?i)\\b" + Pattern.quote(entry[0]) + "\\b");
      if (pattern.matcher(trimmed).find()) {
        issues.add(new Issue("BLOCK", "SQL_FORBIDDEN_" + entry[0].replace(' ', '_'), entry[1], null));
      }
    }
    Matcher schema = SYSTEM_SCHEMA.matcher(trimmed);
    if (schema.find()) {
      issues.add(new Issue("BLOCK", "SQL_SYSTEM_SCHEMA", "不允许访问系统库：" + schema.group(1).toLowerCase(Locale.ROOT), null));
    }
    LinkedHashSet<String> seen = new LinkedHashSet<>();
    Matcher tableMatcher = TABLE_REFERENCE.matcher(trimmed);
    while (tableMatcher.find()) {
      String name = normalizeTable(tableMatcher.group(1));
      if (name.isEmpty() || name.startsWith("(")) continue;
      if (seen.add(name)) tables.add(name);
    }
    if (!allowedTables.isEmpty()) {
      Set<String> approved = new LinkedHashSet<>();
      for (String item : allowedTables) approved.add(normalizeTable(item));
      for (String table : tables) {
        if (!approved.contains(table)) {
          issues.add(new Issue("BLOCK", "SQL_TABLE_NOT_APPROVED",
              "表 `" + table + "` 不在已批准清单内；请先完成预检并确认范围", null));
        }
      }
    }
    Matcher placeholder = PLACEHOLDER.matcher(trimmed);
    while (placeholder.find()) {
      String name = placeholder.group(1);
      if (!placeholders.contains(name)) placeholders.add(name);
      if (!INJECTABLE_PARAMETERS.contains(name)) {
        issues.add(new Issue("BLOCK", "SQL_UNKNOWN_PARAMETER",
            "未声明的参数 {{" + name + "}}；可用参数：" + INJECTABLE_PARAMETERS, null));
      }
    }
    if (SELECT_STAR.matcher(trimmed).find()) {
      issues.add(new Issue("WARN", "SQL_SELECT_STAR",
          "使用了 SELECT *：结果列以首次预览为准，精度敏感列仍会被平台转文本", null));
    }
    if (Pattern.compile("(?i)\\blimit\\b").matcher(trimmed).find()) {
      issues.add(new Issue("WARN", "SQL_SELF_LIMIT", "正式执行不应自带 LIMIT；限额由平台控制", null));
    }
    boolean blocked = issues.stream().anyMatch(issue -> "BLOCK".equals(issue.level()));
    return new Result(blocked, issues, tables, placeholders);
  }

  private static Integer lineOf(String sql, char needle) {
    int index = sql.indexOf(needle);
    if (index < 0) return null;
    int line = 1;
    for (int i = 0; i < index; i++) if (sql.charAt(i) == '\n') line++;
    return line;
  }
}
