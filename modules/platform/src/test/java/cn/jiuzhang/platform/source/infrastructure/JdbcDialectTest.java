package cn.jiuzhang.platform.source.infrastructure;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import java.sql.Connection;
import java.sql.Statement;
import java.util.List;
import org.junit.jupiter.api.Test;

class JdbcDialectTest {
  SourceConnector.Connection config(String account,boolean tls) {
    return new SourceConnector.Connection("db.invalid",2881,"demo_retail",tls,account,"synthetic");
  }

  @Test void passesBothAccountFormsUnchangedWithoutMysqlRsaPinning() {
    for(String account:List.of("reader@tenant","reader@tenant#cluster")) {
      var properties=JdbcDialect.OCEANBASE.properties(config(account,false),true,300);
      assertThat(properties.getProperty("user")).isEqualTo(account);
      assertThat(properties.getProperty("allowPublicKeyRetrieval")).isEqualTo("false");
      assertThat(properties).doesNotContainKey("serverRSAPublicKeyFile");
      assertThat(properties.getProperty("sslMode")).isEqualTo("DISABLED");
      assertThat(Integer.parseInt(properties.getProperty("socketTimeout"))).isGreaterThan(300000);
    }
  }

  @Test void oceanBaseTlsVerifiesIdentityAndRemotePlaintextIsRejected() {
    assertThat(JdbcDialect.OCEANBASE.properties(config("reader@tenant",true),false,300)
        .getProperty("sslMode")).isEqualTo("VERIFY_IDENTITY");
    assertThatThrownBy(()->JdbcDialect.OCEANBASE.properties(config("reader@tenant",false),false,300))
        .isInstanceOfSatisfying(Failure.class,error->assertThat(error.code).isEqualTo("SOURCE_TLS_REQUIRED"));
    assertThat(JdbcDialect.MYSQL.properties(config("reader",true),false,300)
        .getProperty("sslMode")).isEqualTo("REQUIRED");
  }

  @Test void initializesStrongReadsAndMicrosecondTimeoutWithoutChangingTransactionTimeout() throws Exception {
    var connection=mock(Connection.class);var statement=mock(Statement.class);
    when(connection.createStatement()).thenReturn(statement);
    JdbcDialect.OCEANBASE.initialize(connection,300);
    verify(statement).execute("SET SESSION ob_read_consistency='STRONG'");
    verify(statement).execute("SET SESSION ob_query_timeout=300000000");
    verify(statement,never()).execute(contains("ob_trx_timeout"));
    verify(statement).close();
    clearInvocations(statement);
    JdbcDialect.OCEANBASE.initialize(connection,60);
    verify(statement).execute("SET SESSION ob_query_timeout=60000000");
    assertThatThrownBy(()->new OceanBaseConnector(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(()->new OceanBaseConnector(601)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test void compositePrimaryKeyPaginationUsesBoundValuesAndNeverOffset() {
    String sql=JdbcSourceConnector.keysetSql("orders",List.of("amount","tenant_id","id"),List.of("tenant_id","id"),true);
    assertThat(sql).contains("WHERE (`tenant_id`,`id`) > (?,?)","ORDER BY `tenant_id`,`id` LIMIT ?")
        .doesNotContain("OFFSET");
    assertThat(JdbcSourceConnector.keysetSql("orders",List.of("id"),List.of("id"),false))
        .isEqualTo("SELECT `id` FROM `orders` ORDER BY `id` LIMIT ?");
  }
}
