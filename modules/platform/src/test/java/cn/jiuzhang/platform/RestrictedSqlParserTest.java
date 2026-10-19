package cn.jiuzhang.platform;
import cn.jiuzhang.platform.warehouse.infrastructure.RestrictedSqlParser;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
class RestrictedSqlParserTest{
 private final RestrictedSqlParser parser=new RestrictedSqlParser();
 @Test void parsesProjectionPaginationAndDefaults(){var q=parser.parse("SELECT id,amount FROM orders LIMIT 20 OFFSET 40;");assertThat(q.table()).isEqualTo("orders");assertThat(q.columns()).containsExactly("id","amount");assertThat(q.limit()).isEqualTo(20);assertThat(q.offset()).isEqualTo(40);assertThat(parser.parse("select * from orders").limit()).isEqualTo(100);}
 @Test void rejectsAnythingOutsideTheClosedReadLanguage(){for(String sql:java.util.List.of("DELETE FROM orders","SELECT sleep(1) FROM orders","SELECT * FROM jz_s_1","SELECT * FROM orders; SELECT 1","SELECT * FROM orders LIMIT 0","SELECT * FROM orders LIMIT 1001","SELECT * FROM orders INTO OUTFILE '/tmp/data'","SELECT * FROM orders JOIN users ON 1=1","SELECT * FROM (SELECT * FROM orders) x"))assertThatThrownBy(()->parser.parse(sql)).isInstanceOf(cn.jiuzhang.platform.shared.application.Failure.class);}
}
