package cn.jiuzhang.platform.warehouse.infrastructure;
import cn.jiuzhang.platform.warehouse.application.QueryParser;
import cn.jiuzhang.platform.warehouse.domain.ReadQuery;
import cn.jiuzhang.platform.shared.application.Failure;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
@Component
public class RestrictedSqlParser implements QueryParser{
 private static final String IDENT="[a-zA-Z_][a-zA-Z0-9_]{0,55}";
 private static final Pattern SELECT=Pattern.compile("\\s*SELECT\\s+(\\*|"+IDENT+"(?:\\s*,\\s*"+IDENT+")*)\\s+FROM\\s+("+IDENT+")(?:\\s+LIMIT\\s+([0-9]{1,5})(?:\\s+OFFSET\\s+([0-9]{1,7}))?)?\\s*;?\\s*",Pattern.CASE_INSENSITIVE);
 public ReadQuery parse(String sql){if(sql==null||sql.length()>4096)throw new Failure(422,"UNSUPPORTED_SQL");try{if(CCJSqlParserUtil.parseStatements(sql).size()!=1)throw new Failure(422,"UNSUPPORTED_SQL");}catch(Exception e){throw new Failure(422,"UNSUPPORTED_SQL");}var m=SELECT.matcher(sql);if(!m.matches()||m.group(2).toLowerCase(Locale.ROOT).startsWith("jz_"))throw new Failure(422,"UNSUPPORTED_SQL");int limit=m.group(3)==null?100:Integer.parseInt(m.group(3)),offset=m.group(4)==null?0:Integer.parseInt(m.group(4));if(limit<1||limit>1000||offset>1000000)throw new Failure(422,"QUERY_LIMIT");return new ReadQuery(m.group(2),m.group(1).equals("*")?List.of():Arrays.stream(m.group(1).split(",")).map(String::strip).toList(),limit,offset);}
}
