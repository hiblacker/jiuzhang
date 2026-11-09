package cn.jiuzhang.platform.source.infrastructure;

import static org.assertj.core.api.Assertions.*;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import java.util.List;
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

    // serial / bigserial 是 pgjdbc 对自增列报出的伪类型名，不归一的话
    // 每张带自增主键的表（ORM 生成的表几乎都是）都会被判成不支持的类型。
    @Test void normalizesSerialPseudoTypesReportedByMetadata() {
        assertThat(PostgreSqlConnector.catalogType("bigserial")).isEqualTo("bigint");
        assertThat(PostgreSqlConnector.catalogType("serial")).isEqualTo("integer");
        assertThat(PostgreSqlConnector.catalogType("smallserial")).isEqualTo("smallint");
        assertThat(PostgreSqlConnector.catalogType("int8")).isEqualTo("bigint");
        assertThat(PostgreSqlConnector.catalogType("varchar")).isEqualTo("varchar");
        assertThat(PostgreSqlConnector.catalogType("timestamptz")).isEqualTo("timestamp with time zone");
        assertThat(PostgreSqlConnector.catalogType("bytea")).isEqualTo("bytea");
    }

    // ORM 建的表常见「带自增主键 + 无精度 numeric 金额列 + varchar」，三者都得能读。
    @Test void acceptsAutoIncrementPrimaryKeyAndUnboundedNumeric() {
        var connector=new PostgreSqlConnector(300,"");
        assertThatCode(()->connector.supported(List.of(
                column("id","bigint"),column("balance","numeric"),column("remark","varchar"),
                column("amount","decimal(20,4)"),column("created_time","bigint"))))
                .doesNotThrowAnyException();
        assertThatThrownBy(()->connector.supported(List.of(column("payload","bytea"))))
                .isInstanceOf(Failure.class).extracting("code").isEqualTo("SOURCE_COLUMN_TYPE_UNSUPPORTED");
    }

    private static SourceConnector.Column column(String name,String type) {
        return new SourceConnector.Column(name,type,0,0,0,true,"");
    }
}
