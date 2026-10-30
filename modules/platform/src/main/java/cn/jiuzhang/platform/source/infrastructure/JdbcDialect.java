package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Properties;

/** Only MySQL-compatible differences belong here; row/schema handling stays in the JDBC reader. */
enum JdbcDialect {
  MYSQL("MySQL"), OCEANBASE("OceanBase");
  final String sourceType;
  JdbcDialect(String sourceType) { this.sourceType=sourceType; }

  Properties properties(SourceConnector.Connection config,boolean loopback,int queryTimeoutSeconds) {
    if(!config.tls()&&!loopback)throw new Failure(422,"SOURCE_TLS_REQUIRED");
    var p=new Properties();
    // Credentials are JDBC properties, never URL fragments. In particular, @ and # are opaque.
    p.setProperty("user",config.username());p.setProperty("password",config.password());
    p.setProperty("connectTimeout","5000");
    p.setProperty("socketTimeout",this==OCEANBASE?Integer.toString(Math.max(330000,queryTimeoutSeconds*1000+5000)):"30000");
    p.setProperty("useCursorFetch","true");p.setProperty("useServerPrepStmts","true");
    p.setProperty("characterEncoding","UTF-8");
    p.setProperty("connectionTimeZone","UTC");p.setProperty("forceConnectionTimeZoneToSession","true");
    p.setProperty("allowPublicKeyRetrieval","false");p.setProperty("allowMultiQueries","false");
    p.setProperty("sslMode",config.tls()?(this==OCEANBASE?"VERIFY_IDENTITY":"REQUIRED"):"DISABLED");
    if(this==MYSQL&&!config.tls()) {
      Path key=Path.of(System.getenv().getOrDefault("JIUZHANG_MYSQL_PUBLIC_KEY",".local/mysql-public-key.pem"));
      if(!Files.isRegularFile(key))throw new Failure(422,"SOURCE_KEY_REQUIRED");
      p.setProperty("serverRSAPublicKeyFile",key.toAbsolutePath().toString());
    }
    return p;
  }

  void initialize(Connection connection,int queryTimeoutSeconds)throws SQLException {
    if(this!=OCEANBASE)return;
    try(var statement=connection.createStatement()) {
      statement.setQueryTimeout(10);
      statement.execute("SET SESSION ob_read_consistency='STRONG'");
      statement.execute("SET SESSION ob_query_timeout="+queryTimeoutSeconds*1_000_000L);
      // ob_trx_timeout defaults to 86400s. Do not lower or overwrite the tenant's setting.
    }
  }
}
