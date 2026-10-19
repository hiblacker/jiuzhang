import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import cn.jiuzhang.platform.source.infrastructure.MySqlConnector;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

/** Real local MySQL only; no application hooks or customer data. */
class SourceSnapshotAcceptance {
  static Connection root() throws Exception {
    var properties = new Properties();
    properties.setProperty("user", "root");
    properties.setProperty("password", System.getenv("SOURCE_ROOT_PASSWORD"));
    properties.setProperty("sslMode", "DISABLED");
    properties.setProperty("allowPublicKeyRetrieval", "false");
    properties.setProperty("serverRSAPublicKeyFile", ".local/mysql-public-key.pem");
    properties.setProperty("connectTimeout", "5000");
    properties.setProperty("socketTimeout", "20000");
    return DriverManager.getConnection("jdbc:mysql://127.0.0.1:13306/demo_retail", properties);
  }

  static void require(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  static boolean ddlIsWaiting(String table) throws Exception {
    try (var connection = root();
        var statement = connection.prepareStatement(
            "SELECT count(*) FROM information_schema.processlist WHERE STATE='Waiting for table metadata lock' AND INFO LIKE ?")) {
      statement.setString(1, "ALTER TABLE " + table + "%");
      try (var result = statement.executeQuery()) {
        result.next();
        return result.getInt(1) == 1;
      }
    }
  }

  public static void main(String[] args) throws Exception {
    var connector = new MySqlConnector();
    var config = new SourceConnector.Connection("127.0.0.1", 13306, "demo_retail", false,
        "jiuzhang_reader", System.getenv("SOURCE_READ_PASSWORD"));
    String table = "scan_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    try (var writer = root(); var statement = writer.createStatement();
        var executor = Executors.newSingleThreadExecutor()) {
      statement.execute("CREATE TABLE " + table + " (id BIGINT NOT NULL PRIMARY KEY,payload VARCHAR(20),amount DECIMAL(20,4) NOT NULL) ENGINE=InnoDB");
      try {
        try (var insert = writer.prepareStatement("INSERT INTO " + table + " VALUES (?, ?, ?)")) {
          for (int i = 1; i <= 1200; i++) {
            insert.setLong(1, i);
            insert.setString(2, i == 1 ? null : "before");
            insert.setBigDecimal(3, new java.math.BigDecimal("12345.6700"));
            insert.addBatch();
          }
          insert.executeBatch();
        }
        var columns = connector.discover(config).stream().filter(item -> item.name().equals(table)).findFirst().orElseThrow().columns();
        var selected = List.of("id", "payload", "amount");
        var rows = new ArrayList<java.util.Map<String, Object>>();
        var ddl = new java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<?>>();
        connector.scan(config, table, columns, selected, row -> {
          rows.add(row);
          if (rows.size() != 1) return;
          try {
            statement.executeUpdate("UPDATE " + table + " SET payload='after' WHERE id=1200");
            statement.executeUpdate("INSERT INTO " + table + " VALUES (1201,'after',0.0000)");
            ddl.set(executor.submit(() -> {
              try (var connection = root(); var alter = connection.createStatement()) {
                alter.execute("ALTER TABLE " + table + " ADD COLUMN unused INT");
              } catch (Exception error) {
                throw new RuntimeException("Synthetic DDL failed", error);
              }
            }));
            long end = System.nanoTime() + Duration.ofSeconds(10).toNanos();
            while (!ddlIsWaiting(table) && System.nanoTime() < end) Thread.sleep(25);
            require(ddlIsWaiting(table) && !ddl.get().isDone(), "Concurrent DDL must wait for the scan transaction");
          } catch (Exception error) {
            throw new RuntimeException("Concurrent source verification failed", error);
          }
        }, () -> false);
        ddl.get().get(15, TimeUnit.SECONDS);
        require(rows.size() == 1200, "Snapshot included a concurrent insert or lost rows");
        require(rows.stream().noneMatch(row -> "after".equals(row.get("payload"))), "Snapshot mixed pre/post update values");
        require(rows.stream().anyMatch(row -> row.get("payload") == null), "Snapshot lost null semantics");
        require(rows.stream().allMatch(row -> "12345.6700".equals(row.get("amount"))), "Snapshot lost decimal scale");
        var latest = new ArrayList<java.util.Map<String, Object>>();
        connector.scan(config, table, columns, selected, latest::add, () -> false);
        require(latest.size() == 1201 && latest.stream().filter(row -> "after".equals(row.get("payload"))).count() == 2, "Next scan must see committed source changes");
        AtomicBoolean canceled = new AtomicBoolean();
        try {
          connector.scan(config, table, columns, selected, row -> canceled.set(true), canceled::get);
          throw new AssertionError("Canceled scan returned success");
        } catch (Failure error) {
          require(error.code.equals("RUN_CANCELED"), "Canceled scan returned an unrelated error");
        }
        statement.execute("ALTER TABLE " + table + " MODIFY amount DECIMAL(21,4) NOT NULL");
        try {
          connector.scan(config, table, columns, selected, row -> {throw new AssertionError("Schema mismatch must fail before consuming data");}, () -> false);
          throw new AssertionError("Changed used schema was accepted");
        } catch (Failure error) {
          require(error.code.equals("SCHEMA_CHANGED"), "Used schema drift was not classified");
        }
        System.out.println("PASS actual MySQL snapshot: 1200 rows across cursor batches, concurrent update/insert excluded, DDL waits, next scan sees commits, null/Decimal exact, cancellation and schema checks");
      } finally {
        statement.execute("DROP TABLE IF EXISTS " + table);
      }
    }
  }
}
