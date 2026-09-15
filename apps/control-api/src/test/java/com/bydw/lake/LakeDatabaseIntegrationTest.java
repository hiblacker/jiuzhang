package com.bydw.lake;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bydw.ControlApplication;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.UUID;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;

/** Opt-in real HTTP/JDBC test. Only accepts a separately provisioned loopback test database. */
@EnabledIfEnvironmentVariable(named = "LAKE_REVIEW_ALLOW_MIGRATIONS", matches = "isolated")
class LakeDatabaseIntegrationTest {
  private static ServletWebServerApplicationContext app;
  private static ObjectMapper json;
  private static String base;
  private static String jdbcUrl;
  private static final String ADMIN = "synthetic-admin-" + UUID.randomUUID();
  private static final String WORKER = "synthetic-worker-" + UUID.randomUUID();
  private static final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  @BeforeAll
  static void start() throws Exception {
    jdbcUrl = System.getenv("LAKE_REVIEW_JDBC_URL");
    assertThat(jdbcUrl).matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/lake_review");
    try (var bootstrap = DriverManager.getConnection(jdbcUrl.replace("/lake_review", "/postgres"),
        System.getenv("LAKE_REVIEW_DB_OWNER"), System.getenv("LAKE_REVIEW_DB_OWNER_PASSWORD"));
        var statement = bootstrap.createStatement()) {
      try (var result = statement.executeQuery("SELECT 1 FROM pg_database WHERE datname = 'lake_review'")) {
        if (!result.next()) statement.execute("CREATE DATABASE lake_review");
      }
    }
    try (var owner = owner()) {
      migrate(owner);
      provision(owner, "bydw_control_api_login", System.getenv("LAKE_REVIEW_CONTROL_PASSWORD"));
      provision(owner, "bydw_ingestion_worker_login", System.getenv("LAKE_REVIEW_WORKER_PASSWORD"));
    }
    app = (ServletWebServerApplicationContext) new SpringApplicationBuilder(ControlApplication.class)
        .run("--server.address=127.0.0.1", "--server.port=0", "--spring.main.banner-mode=off",
            "--logging.level.root=ERROR", "--spring.datasource.url=" + jdbcUrl,
            "--spring.datasource.username=bydw_control_api_login",
            "--spring.datasource.password=" + System.getenv("LAKE_REVIEW_CONTROL_PASSWORD"),
            "--bydw.security.admin-token=" + ADMIN, "--bydw.security.worker-token=" + WORKER,
            "--bydw.web.allowed-origins=http://localhost:5173");
    json = app.getBean(ObjectMapper.class);
    base = "http://127.0.0.1:" + app.getWebServer().getPort();
  }

  @AfterAll
  static void stop() { if (app != null) app.close(); }

  @Test
  void registersThroughLeastPrivilegeRoleAndPreservesCommittedEvidence() throws Exception {
    String source = "review_" + UUID.randomUUID().toString().replace("-", "");
    var sourceBody = json.createObjectNode().put("code", source).put("sourceType", "MYSQL")
        .put("credentialRef", "env://SYNTHETIC_SOURCE");
    sourceBody.putObject("config").put("database", "synthetic");
    assertStatus(post("/api/v1/sources", ADMIN, sourceBody), 201);
    ObjectNode inventory = (ObjectNode) json.readTree("""
        {"planVersion":1,"observedAt":"2026-09-15T00:00:00Z","sourceScope":{},
         "objects":[{"objectName":"example","objectType":"TABLE","schema":[],
           "primaryKey":["id"],"required":true,"strategy":"FULL_SNAPSHOT","state":"READY"}]}
        """);
    inventory.put("sourceCode", source).put("schemaSha256", "a".repeat(64));
    var firstInventory = post("/api/v1/lake/inventories", ADMIN, inventory);
    assertStatus(firstInventory, 201);
    assertThat(post("/api/v1/lake/inventories", ADMIN, inventory).body()).isEqualTo(firstInventory.body());
    var changedContract = inventory.deepCopy();
    ((ObjectNode) changedContract.at("/objects/0")).put("required", false);
    assertStatus(post("/api/v1/lake/inventories", ADMIN, changedContract), 409);

    ObjectNode newer = manifest(source, "newer", "2026-09-16T02:00:00Z");
    assertStatus(post("/api/v1/lake/manifests", ADMIN, newer), 401);
    assertStatus(post("/api/v1/lake/inventories", WORKER, inventory), 401);
    // Exercise competing first inserts, not only serial retries.
    var a = http.sendAsync(request("/api/v1/lake/manifests", WORKER, newer), HttpResponse.BodyHandlers.ofString());
    var b = http.sendAsync(request("/api/v1/lake/manifests", WORKER, newer), HttpResponse.BodyHandlers.ofString());
    var first = a.get();
    assertStatus(first, 201);
    assertStatus(b.get(), 201);
    assertThat(b.get().body()).isEqualTo(first.body());
    long newerId = json.readTree(first.body()).get("systemRunId").asLong();
    var mutation = newer.deepCopy();
    ((ObjectNode) mutation.at("/objects/0")).put("rowCount", 999);
    assertStatus(post("/api/v1/lake/manifests", WORKER, mutation), 409);

    assertStatus(post("/api/v1/lake/manifests", WORKER,
        manifest(source, "older", "2026-09-16T01:00:00Z")), 201);
    var failed = manifest(source, "failed", "2026-09-16T03:00:00Z");
    failed.put("state", "FAILED");
    ((ObjectNode) failed.at("/objects/0")).put("state", "FAILED");
    assertStatus(post("/api/v1/lake/manifests", WORKER, failed), 201);
    try (var owner = owner()) {
      assertThat(scalar(owner, "SELECT a.run_id FROM lake.active_run a JOIN control.source_connection s ON s.id = a.source_id WHERE s.code = ?", source)).isEqualTo(newerId);
      assertThat(scalar(owner, "SELECT d.run_id FROM lake.delivery_ledger d JOIN control.source_connection s ON s.id = d.source_id WHERE s.code = ?", source)).isEqualTo(newerId);
      assertThat(scalar(owner, "SELECT count(*) FROM lake.system_run r JOIN control.source_connection s ON s.id = r.source_id WHERE s.code = ?", source)).isEqualTo(3L);
      assertThat(scalar(owner, "SELECT o.row_count FROM lake.object_run o WHERE o.system_run_id = ?", newerId)).isEqualTo(1L);
      assertThat(scalar(owner, "SELECT count(*) FROM control.audit_log WHERE action = 'LAKE_MANIFEST_REGISTER' AND resource = ?", "lake/system-run/" + newerId)).isEqualTo(1L);
    }
    for (String role : new String[]{"bydw_control_api_login", "bydw_ingestion_worker_login"}) {
      String password = System.getenv(role.contains("control") ? "LAKE_REVIEW_CONTROL_PASSWORD" : "LAKE_REVIEW_WORKER_PASSWORD");
      try (var connection = DriverManager.getConnection(jdbcUrl, role, password);
          var statement = connection.createStatement()) {
        assertThatThrownBy(() -> statement.executeUpdate("UPDATE lake.active_run SET revision = 0 WHERE false"))
            .isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("42501"));
        assertThatThrownBy(() -> statement.executeUpdate("UPDATE lake.object_run SET row_count = 0 WHERE false"))
            .isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("42501"));
      }
    }
    for (String route : new String[]{"summary", "runs", "deliveries"}) {
      var response = http.send(HttpRequest.newBuilder(URI.create(base + "/api/v1/lake/" + route))
          .timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + ADMIN).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertStatus(response, 200);
    }
    var cors = http.send(HttpRequest.newBuilder(URI.create(base + "/api/v1/lake/summary"))
        .header("Origin", "http://localhost:5173").header("Access-Control-Request-Method", "GET")
        .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
    assertStatus(cors, 200);
    assertThat(cors.headers().firstValue("Access-Control-Allow-Origin")).contains("http://localhost:5173");
  }

  private static ObjectNode manifest(String source, String key, String started) throws Exception {
    ObjectNode node = (ObjectNode) json.readTree("""
        {"planVersion":1,"mode":"DAILY","attempt":1,"revision":1,"state":"COMPLETE",
         "consistency":"ONE_REPEATABLE_READ_TRANSACTION",
         "scheduledWindowStart":"2026-09-16T00:00:00+08:00","scheduledWindowEnd":"2026-09-17T00:00:00+08:00",
         "finishedAt":"2026-09-16T04:00:00Z","objects":[{"objectName":"example","state":"RAW_COMMITTED",
           "rowCount":1,"byteCount":6,"format":"JSONL"}]}
        """);
    node.put("sourceCode", source).put("runKey", key).put("startedAt", started);
    ((ObjectNode) node.at("/objects/0")).put("rawPath", "batches/" + key + "/example/rows.jsonl")
        .put("rawSha256", "a".repeat(64)).put("schemaSha256", "b".repeat(64));
    return node;
  }

  @Test
  @EnabledIfEnvironmentVariable(named = "LAKE_REVIEW_REAL_MANIFEST", matches = ".+")
  void registersAnExistingLocalSnapshotWithoutConnectingToItsSource() throws Exception {
    Path repo = Path.of(System.getenv("LAKE_REVIEW_REPO"));
    Path manifestFile = Path.of(System.getenv("LAKE_REVIEW_REAL_MANIFEST"));
    JsonNode manifest = json.readTree(Files.readString(manifestFile));
    String source = manifest.get("sourceCode").asText();
    var sourceBody = json.createObjectNode().put("code", source).put("sourceType", "MYSQL")
        .put("credentialRef", "env://LOCAL_MYSQL_TEST_SOURCE");
    sourceBody.putObject("config").put("purpose", "local-review-registration");
    assertThat(post("/api/v1/sources", ADMIN, sourceBody).statusCode()).isIn(201, 409);
    var process = new ProcessBuilder("node", repo.resolve("tools/lake-register.mjs").toString(),
        "--control-api", base, "--inventory", System.getenv("LAKE_REVIEW_REAL_INVENTORY"),
        "--manifest", manifestFile.toString(), "--lake-root", System.getenv("LAKE_REVIEW_REAL_LAKE_ROOT"),
        "--source-code", source);
    process.environment().put("CONTROL_API_ADMIN_TOKEN", ADMIN);
    process.environment().put("CONTROL_API_WORKER_TOKEN", WORKER);
    Path output = repo.resolve("work/lake-review/registration-process.json");
    process.redirectErrorStream(true).redirectOutput(output.toFile());
    var running = process.start();
    boolean finished = running.waitFor(90, TimeUnit.SECONDS);
    if (!finished) running.destroyForcibly();
    assertThat(finished).isTrue();
    assertThat(running.exitValue()).as("Registrar failed; inspect the private local output").isZero();
    JsonNode result = json.readTree(Files.readString(output));
    assertThat(result.get("state").asText()).isEqualTo("COMPLETE");
    long runId = result.at("/manifest/systemRunId").asLong();
    long expectedRows = 0;
    for (JsonNode table : manifest.get("tables")) expectedRows += table.get("rowCount").asLong();
    try (var owner = owner()) {
      assertThat(scalar(owner, "SELECT count(*) FROM lake.object_run WHERE system_run_id = ? AND state = 'RAW_COMMITTED'", runId)).isEqualTo(manifest.get("tables").size());
      assertThat(scalar(owner, "SELECT sum(row_count) FROM lake.object_run WHERE system_run_id = ?", runId)).isEqualTo(expectedRows);
    }
    Files.writeString(repo.resolve("work/lake-review/registration-evidence.json"), json.createObjectNode()
        .put("state", "COMPLETE").put("registeredObjects", manifest.get("tables").size())
        .put("registeredRows", expectedRows).put("runId", runId).toPrettyString());
  }

  @Test
  void calendarFindsGapsAndExecutionLeasesFenceRetriesAndCancellation() throws Exception {
    String source = "calendar_" + UUID.randomUUID().toString().replace("-", "");
    var sourceBody = json.createObjectNode().put("code", source).put("sourceType", "FILE")
        .put("credentialRef", "env://SYNTHETIC_FOLDER");
    sourceBody.putObject("config");
    assertStatus(post("/api/v1/sources", ADMIN, sourceBody), 201);
    var today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
    var plan = json.createObjectNode().put("sourceCode", source).put("expectedVersion", 0)
        .put("kind", "FILE_SCAN").put("runtimeRef", source).put("timezone", "Asia/Shanghai")
        .put("triggerTime", "00:00:00").put("startDate", today.minusDays(1).toString())
        .put("historicalRead", true).put("maxAttempts", 3).put("timeoutSeconds", 300);
    plan.putObject("contract").put("deliveryMode", "DAILY");
    var saved = post("/api/v1/lake/plans", ADMIN, plan); assertStatus(saved, 200);
    long planId = json.readTree(saved.body()).get("id").asLong();
    try {
      // A manual current-day trigger must not hide the prior missing schedule day.
      var trigger = json.createObjectNode().put("day", today.toString()).put("revision", false).put("reason", "synthetic review");
      assertStatus(post("/api/v1/lake/plans/" + planId + "/trigger", ADMIN, trigger), 200);
      var service = app.getBean(LakeExecutionService.class);
      service.reconcile(java.time.Instant.now()); service.reconcile(java.time.Instant.now());
      assertThat(service.windows(planId)).hasSize(2);
      assertThat(service.attempts(planId)).hasSize(2);
      var capabilities = json.createObjectNode(); capabilities.putArray("runtimeRefs").add(source);
      var firstClaim = http.sendAsync(request("/api/v1/lake/executions/claim", WORKER, capabilities), HttpResponse.BodyHandlers.ofString());
      var secondClaim = http.sendAsync(request("/api/v1/lake/executions/claim", WORKER, capabilities), HttpResponse.BodyHandlers.ofString());
      assertStatus(firstClaim.get(), 200); assertStatus(secondClaim.get(), 200);
      JsonNode a = json.readTree(firstClaim.get().body()), b = json.readTree(secondClaim.get().body());
      JsonNode claimed = a.path("state").asText().equals("RUNNING") ? a : b;
      assertThat(List.of(a.path("state").asText(), b.path("state").asText())).containsExactlyInAnyOrder("RUNNING", "IDLE");
      assertThat(claimed.at("/contract/deliveryMode").asText()).isEqualTo("DAILY");
      long id = claimed.get("id").asLong();
      String lease = claimed.get("leaseToken").asText();
      var wrongLease = json.createObjectNode().put("leaseToken", UUID.randomUUID().toString());
      assertStatus(post("/api/v1/lake/executions/" + id + "/heartbeat", WORKER, wrongLease), 409);
      // Simulate a stopped worker by advancing only this lease in the isolated DB.
      try (var owner = owner(); var statement = owner.prepareStatement("UPDATE lake.execution_attempt SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = ?")) {
        statement.setLong(1, id); statement.executeUpdate();
      }
      service.reconcile(java.time.Instant.now());
      var completion = json.createObjectNode().put("leaseToken", lease).put("state", "COMPLETE");
      completion.putObject("result").put("rows", 0);
      assertStatus(post("/api/v1/lake/executions/" + id + "/finish", WORKER, completion), 409);
      var retry = post("/api/v1/lake/executions/" + id + "/retry", ADMIN, json.createObjectNode()); assertStatus(retry, 200);
      long retryId = json.readTree(retry.body()).get("id").asLong();
      var nextClaim = post("/api/v1/lake/executions/claim", WORKER, capabilities); assertStatus(nextClaim, 200);
      JsonNode next = json.readTree(nextClaim.body()); assertThat(next.get("id").asLong()).isEqualTo(retryId);
      assertThat(next.get("leaseToken").asText()).isNotEqualTo(lease);
      assertStatus(post("/api/v1/lake/executions/" + retryId + "/cancel", ADMIN, json.createObjectNode()), 200);
      var heartbeat = json.createObjectNode().put("leaseToken", next.get("leaseToken").asText());
      assertThat(json.readTree(post("/api/v1/lake/executions/" + retryId + "/heartbeat", WORKER, heartbeat).body()).path("state").asText()).isEqualTo("CANCEL_REQUESTED");
      completion.put("leaseToken", next.get("leaseToken").asText());
      assertThat(json.readTree(post("/api/v1/lake/executions/" + retryId + "/finish", WORKER, completion).body()).path("state").asText()).isEqualTo("CANCELLED");
      var repeatedRetry = json.readTree(post("/api/v1/lake/executions/" + id + "/retry", ADMIN, json.createObjectNode()).body());
      assertThat(repeatedRetry.get("id").asLong()).isEqualTo(retryId);
      assertThat(service.windows(planId).stream().filter(w -> ((Number) w.get("id")).longValue() == next.get("window_id").asLong()).findFirst().orElseThrow().get("state")).isEqualTo("CANCELLED");
    } finally { app.getBean(LakeExecutionService.class).setState(planId, "PAUSED", "local-review"); }
  }

  private static HttpRequest request(String path, String token, JsonNode body) {
    return HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(15))
        .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
  }

  private static HttpResponse<String> post(String path, String token, JsonNode body) throws Exception {
    return http.send(request(path, token, body), HttpResponse.BodyHandlers.ofString());
  }

  private static void assertStatus(HttpResponse<String> response, int status) {
    assertThat(response.statusCode()).as("HTTP response: %s", response.body()).isEqualTo(status);
  }

  private static Connection owner() throws SQLException {
    return DriverManager.getConnection(jdbcUrl, System.getenv("LAKE_REVIEW_DB_OWNER"), System.getenv("LAKE_REVIEW_DB_OWNER_PASSWORD"));
  }

  private static long scalar(Connection connection, String sql, Object parameter) throws SQLException {
    try (var statement = connection.prepareStatement(sql)) {
      statement.setObject(1, parameter);
      try (var result = statement.executeQuery()) { assertThat(result.next()).isTrue(); return result.getLong(1); }
    }
  }

  private static void provision(Connection owner, String role, String password) throws SQLException {
    assertThat(password).isNotBlank();
    try (var format = owner.prepareStatement("SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', ?::text, ?::text)")) {
      format.setString(1, role); format.setString(2, password);
      try (var result = format.executeQuery()) {
        result.next();
        try (var statement = owner.createStatement()) { statement.execute(result.getString(1)); }
      }
    }
  }

  private static void migrate(Connection owner) throws Exception {
    Path directory = Path.of(System.getenv("LAKE_REVIEW_REPO")).resolve("migrations");
    try (var statement = owner.createStatement()) {
      statement.execute("CREATE SCHEMA IF NOT EXISTS control; CREATE TABLE IF NOT EXISTS control.schema_migration (version VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL, executed_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    }
    try (var files = Files.list(directory)) {
      for (Path file : files.filter(p -> p.getFileName().toString().matches("V[0-9]{3}__.+\\.sql")).sorted().toList()) {
        String version = file.getFileName().toString();
        String checksum = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
        try (var query = owner.prepareStatement("SELECT checksum FROM control.schema_migration WHERE version = ?")) {
          query.setString(1, version);
          try (var result = query.executeQuery()) {
            if (result.next()) { assertThat(result.getString(1)).isEqualTo(checksum); continue; }
          }
        }
        owner.setAutoCommit(false);
        try (var statement = owner.createStatement();
            var record = owner.prepareStatement("INSERT INTO control.schema_migration(version, checksum) VALUES (?, ?)")) {
          statement.execute(Files.readString(file));
          record.setString(1, version); record.setString(2, checksum); record.executeUpdate();
          owner.commit();
        } catch (Exception error) { owner.rollback(); throw error; }
        finally { owner.setAutoCommit(true); }
      }
    }
  }
}
