package cn.jiuzhang.platform.source.infrastructure;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public final class OceanBaseConnector extends JdbcSourceConnector {
  public OceanBaseConnector(@Value("${JIUZHANG_OCEANBASE_QUERY_TIMEOUT_SECONDS:300}") int queryTimeoutSeconds) {
    super(JdbcDialect.OCEANBASE,queryTimeoutSeconds);
  }
}
