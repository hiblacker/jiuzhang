package cn.jiuzhang.platform.source.infrastructure;

import static org.assertj.core.api.Assertions.*;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import org.junit.jupiter.api.Test;

class PostgreSqlConnectorTest {
    @Test void verifiesTlsIdentityAndKeepsCredentialsOutOfUrlsAndDiagnostics() {
        var connector=new PostgreSqlConnector(300,"/service/ca.crt");
        var config=new SourceConnector.Connection("database.example",5432,"retail-db",true,"reader@example","synthetic-password","Retail");
        var properties=connector.properties(config,false);
        assertThat(properties.getProperty("sslmode")).isEqualTo("verify-full");
        assertThat(properties.getProperty("sslrootcert")).isEqualTo("/service/ca.crt");
        assertThat(properties.getProperty("user")).isEqualTo("reader@example");
        assertThat(properties.getProperty("readOnlyMode")).isEqualTo("always");
        assertThat(config.toString()).doesNotContain("synthetic-password","reader@example");
        var plain=new SourceConnector.Connection("database.example",5432,"retail",false,"reader","synthetic-password","public");
        assertThatThrownBy(()->connector.properties(plain,false)).isInstanceOf(Failure.class).extracting("code").isEqualTo("SOURCE_TLS_REQUIRED");
        assertThat(connector.properties(plain,true).getProperty("sslmode")).isEqualTo("disable");
    }

    @Test void quotesEachIdentifierWithoutSplittingDotsOrChangingCase() {
        assertThat(PostgreSqlConnector.quote("Order.Items")).isEqualTo("\"Order.Items\"");
        assertThat(PostgreSqlConnector.quote("A\"B")).isEqualTo("\"A\"\"B\"");
        assertThatThrownBy(()->PostgreSqlConnector.quote("x\u0000y")).isInstanceOf(Failure.class);
        assertThatThrownBy(()->PostgreSqlConnector.quote("数".repeat(22))).isInstanceOf(Failure.class);
    }
}
