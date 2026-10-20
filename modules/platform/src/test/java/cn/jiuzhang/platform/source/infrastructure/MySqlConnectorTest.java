package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.source.domain.SourceConnector.Column;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MySqlConnectorTest {
    @Test
    void ignoresColumnCommentChangesWhenComparingSchemaDefinitions() {
        var expected = new Column("id", "bigint unsigned", 20, 0, 0, false, "old comment");
        var actual = new Column("id", "bigint unsigned", 20, 0, 0, false, "new comment");

        assertThat(MySqlConnector.sameDefinition(expected, actual)).isTrue();
        assertThat(MySqlConnector.sameDefinition(expected,
                new Column("id", "int", 10, 0, 0, false, "new comment"))).isFalse();
    }
}
