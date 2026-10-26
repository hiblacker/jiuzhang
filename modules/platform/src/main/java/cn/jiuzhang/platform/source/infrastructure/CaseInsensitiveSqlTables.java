package cn.jiuzhang.platform.source.infrastructure;

import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Set;
import java.util.stream.Collectors;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.schema.Table;
import net.sf.jsqlparser.parser.Token;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.Select;
import net.sf.jsqlparser.util.TablesNamesFinder;

final class CaseInsensitiveSqlTables {
  private record Replacement(int start, int end, String value) {}

  private CaseInsensitiveSqlTables() {}

  static String canonicalize(String sql, Collection<String> availableTables)
      throws JSQLParserException {
    Statement statement = net.sf.jsqlparser.parser.CCJSqlParserUtil.parse(sql);
    if (!(statement instanceof Select select)) return sql;

    Set<String> referencedTables =
        TablesNamesFinder.findTables(sql).stream()
            .map(CaseInsensitiveSqlTables::unquotedName)
            .map(name -> name.toLowerCase(Locale.ROOT))
            .collect(Collectors.toSet());
    Map<String, List<String>> catalog =
        availableTables.stream()
            .collect(Collectors.groupingBy(name -> name.toLowerCase(Locale.ROOT)));
    List<Replacement> replacements = new ArrayList<>();
    TablesNamesFinder<Void> resolver =
        new TablesNamesFinder<>() {
          @Override
          public <S> Void visit(Table table, S context) {
            String identifier = table.getName();
            String name = unquotedName(identifier);
            String reference = name.toLowerCase(Locale.ROOT);
            super.visit(table, context);
            if (!referencedTables.contains(reference)
                || table.getDatabaseName() != null
                || table.getSchemaName() != null) return null;

            List<String> matches = catalog.get(name.toLowerCase(Locale.ROOT));
            if (matches != null && matches.size() == 1 && !name.equals(matches.getFirst())) {
              Token token = table.getASTNode().jjtGetFirstToken();
              String replacement = matches.getFirst();
              if (identifier.startsWith("`") && identifier.endsWith("`"))
                replacement = "`" + replacement.replace("`", "``") + "`";
              else if (identifier.startsWith("\"") && identifier.endsWith("\""))
                replacement = "\"" + replacement.replace("\"", "\"\"") + "\"";
              replacements.add(
                  new Replacement(
                      token.absoluteBegin - 1, token.absoluteEnd - 1, replacement));
            }
            return null;
          }
        };
    resolver.getTables(statement);
    StringBuilder result = new StringBuilder(sql);
    replacements.sort(Comparator.comparingInt(Replacement::start).reversed());
    for (Replacement replacement : replacements)
      result.replace(replacement.start(), replacement.end(), replacement.value());
    return result.toString();
  }

  private static String unquotedName(String name) {
    int separator = name.lastIndexOf('.');
    String part = name.substring(separator + 1);
    if (part.length() >= 2
        && part.startsWith("`")
        && part.endsWith("`")) return part.substring(1, part.length() - 1).replace("``", "`");
    if (part.length() >= 2 && part.startsWith("\"") && part.endsWith("\""))
      return part.substring(1, part.length() - 1).replace("\"\"", "\"");
    return part;
  }
}
