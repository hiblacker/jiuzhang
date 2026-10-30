package cn.jiuzhang.platform.source.infrastructure;

import org.springframework.stereotype.Component;

@Component
public final class MySqlConnector extends JdbcSourceConnector {
    public MySqlConnector(){super(JdbcDialect.MYSQL,300);}
}
