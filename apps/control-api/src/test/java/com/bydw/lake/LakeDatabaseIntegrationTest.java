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
      if (System.getenv("LAKE_REVIEW_MODEL_PASSWORD") != null) provision(owner, "bydw_model_worker_login", System.getenv("LAKE_REVIEW_MODEL_PASSWORD"));
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

  @Test
  void schemaApprovalCreatesAnImmutableInventoryAndWorkerContract() throws Exception {
    String source = "schema_" + UUID.randomUUID().toString().replace("-", "");
    var definition = json.createObjectNode().put("code", source).put("sourceType", "MYSQL").put("credentialRef", "env://SYNTHETIC_SOURCE");
    definition.putObject("config"); assertStatus(post("/api/v1/sources", ADMIN, definition), 201);
    var initial = (ObjectNode) json.readTree("""
        {"planVersion":1,"observedAt":"2026-09-16T00:00:00Z","sourceScope":{"database":"synthetic"},
         "objects":[{"objectName":"example","objectType":"TABLE","schema":{"engine":"InnoDB","columns":[]},
           "primaryKey":["id"],"required":true,"strategy":"FULL_SNAPSHOT","state":"READY"}]}
        """);
    initial.put("sourceCode", source).put("schemaSha256", "a".repeat(64));
    assertStatus(post("/api/v1/lake/inventories", ADMIN, initial), 201);
    var day = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
    var plan = json.createObjectNode().put("sourceCode", source).put("expectedVersion", 0).put("inventoryVersion", 1)
        .put("kind", "MYSQL_SNAPSHOT").put("runtimeRef", source).put("timezone", "Asia/Shanghai").put("triggerTime", "00:00:00")
        .put("startDate", day.toString()).put("historicalRead", false).put("maxAttempts", 3).put("timeoutSeconds", 300);
    plan.putObject("contract");
    long planId = json.readTree(post("/api/v1/lake/plans", ADMIN, plan).body()).get("id").asLong();
    var service = app.getBean(LakeExecutionService.class);
    var capabilities = json.createObjectNode(); capabilities.putArray("runtimeRefs").add(source);
    try {
      service.reconcile(java.time.Instant.now());
      var task = json.readTree(post("/api/v1/lake/executions/claim", WORKER, capabilities).body());
      long id = task.get("id").asLong();
      var runtime = (ObjectNode) json.readTree("""
          {"plan_version":2,"source_scope":{"database":"synthetic"},"tables":[
           {"table":"example","engine":"InnoDB","columns":[{"column":"id","type":"int"}],"primary_key":["id"]}]}
          """);
      var inventory = initial.deepCopy(); inventory.put("planVersion", 2).put("schemaSha256", "b".repeat(64));
      ((ObjectNode) inventory.at("/objects/0/schema")).set("columns", runtime.at("/tables/0/columns"));
      var completion = json.createObjectNode().put("leaseToken", task.get("leaseToken").asText())
          .put("state", "FAILED").put("errorCode", "SCHEMA_CHANGE_REVIEW_REQUIRED");
      var proposal = completion.putObject("result").putObject("schemaChange");
      proposal.set("proposedInventory", runtime); proposal.set("inventoryRequest", inventory);
      proposal.putObject("changes").putArray("changed").add("example");
      assertStatus(post("/api/v1/lake/executions/" + id + "/finish", WORKER, completion), 200);
      var approval = json.createObjectNode().put("reason", "synthetic schema approval");
      assertStatus(post("/api/v1/lake/executions/" + id + "/approve-schema", WORKER, approval), 401);
      var first = post("/api/v1/lake/executions/" + id + "/approve-schema", ADMIN, approval); assertStatus(first, 200);
      assertThat(json.readTree(first.body()).path("version").asInt()).isEqualTo(2);
      assertThat(post("/api/v1/lake/executions/" + id + "/approve-schema", ADMIN, approval).body()).isEqualTo(first.body());
      service.reconcile(java.time.Instant.now());
      var next = json.readTree(post("/api/v1/lake/executions/claim", WORKER, capabilities).body());
      assertThat(next.get("runtime_inventory")).isEqualTo(runtime);
      assertThat(next.path("inventory_version").asLong()).isEqualTo(2);
      service.cancel(next.get("id").asLong(), "local-review");
      var cancelled = json.createObjectNode().put("leaseToken", next.get("leaseToken").asText()).put("state", "CANCELLED");
      assertStatus(post("/api/v1/lake/executions/" + next.get("id").asLong() + "/finish", WORKER, cancelled), 200);
      try (var connection = owner()) {
        assertThat(scalar(connection, "SELECT count(*) FROM lake.inventory i JOIN control.source_connection s ON s.id=i.source_id WHERE s.code=?", source)).isEqualTo(2);
      }
    } finally { service.setState(planId, "PAUSED", "local-review"); }
  }

  @Test
  void waitingDeliveriesResumeWithoutConsumingFailureBudgetAndSupersededPlansAreClosed() throws Exception {
    String source = "waiting_" + UUID.randomUUID().toString().replace("-", "");
    var definition = json.createObjectNode().put("code", source).put("sourceType", "FILE").put("credentialRef", "env://SYNTHETIC_FOLDER");
    definition.putObject("config"); assertStatus(post("/api/v1/sources", ADMIN, definition), 201);
    var day = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
    var plan = json.createObjectNode().put("sourceCode", source).put("expectedVersion", 0).put("kind", "FILE_SCAN")
        .put("runtimeRef", source).put("timezone", "Asia/Shanghai").put("triggerTime", "00:00:00")
        .put("startDate", day.toString()).put("historicalRead", true).put("maxAttempts", 1).put("timeoutSeconds", 300);
    plan.putObject("contract").put("pollSeconds", 60).put("lateDays", 7);
    long planId = json.readTree(post("/api/v1/lake/plans", ADMIN, plan).body()).get("id").asLong();
    var service = app.getBean(LakeExecutionService.class);
    var capabilities = json.createObjectNode(); capabilities.putArray("runtimeRefs").add(source);
    try {
      service.reconcile(java.time.Instant.now());
      long first = 0;
      for (int observation = 0; observation < 3; observation++) {
        var task = json.readTree(post("/api/v1/lake/executions/claim", WORKER, capabilities).body());
        assertThat(task.path("state").asText()).isEqualTo("RUNNING");
        long id = task.get("id").asLong(); if (observation == 0) first = id;
        var result = json.createObjectNode().put("leaseToken", task.get("leaseToken").asText()).put("state", "INCOMPLETE");
        result.putObject("result").put("deliveryState", "WAITING_READY").putArray("assets");
        assertStatus(post("/api/v1/lake/executions/" + id + "/finish", WORKER, result), 200);
        service.reconcile(java.time.Instant.now()); service.reconcile(java.time.Instant.now());
        assertThat(service.attempts(planId)).hasSize(observation + 2);
        assertThat(json.readTree(post("/api/v1/lake/executions/claim", WORKER, capabilities).body()).path("state").asText()).isEqualTo("IDLE");
        try (var connection = owner(); var statement = connection.prepareStatement("UPDATE lake.execution_attempt SET not_before = clock_timestamp() WHERE window_id = ? AND state = 'QUEUED'")) {
          statement.setLong(1, task.get("window_id").asLong()); statement.executeUpdate();
        }
      }
      var task = json.readTree(post("/api/v1/lake/executions/claim", WORKER, capabilities).body());
      var failed = json.createObjectNode().put("leaseToken", task.get("leaseToken").asText()).put("state", "FAILED").put("errorCode", "API_HTTP_503");
      assertStatus(post("/api/v1/lake/executions/" + task.get("id").asLong() + "/finish", WORKER, failed), 200);
      service.reconcile(java.time.Instant.now());
      assertThat(service.attempts(planId)).hasSize(4); // Waiting observations did not exhaust the failure budget; one actual failure does.
      service.trigger(planId, day, true, "synthetic revision", "local-review");
      plan.put("expectedVersion", 1);
      assertStatus(post("/api/v1/lake/plans", ADMIN, plan), 200);
      assertThat(service.attempts(planId).getFirst().get("error_code")).isEqualTo("PLAN_SUPERSEDED");
      assertStatus(post("/api/v1/lake/executions/" + first + "/retry", ADMIN, json.createObjectNode()), 409);
    } finally { service.setState(planId, "PAUSED", "local-review"); }
  }

  @Test
  void projectMembershipScopesAssetsAndRevocationTakesEffectImmediately() throws Exception {
    String suffix = UUID.randomUUID().toString().replace("-", "");
    var project = json.createObjectNode().put("code", "project-" + suffix).put("name", "Synthetic project");
    var created = post("/api/v1/warehouse/projects", ADMIN, project); assertStatus(created, 200);
    long projectId = json.readTree(created.body()).get("id").asLong();
    project.put("code", "other-" + suffix);
    long otherId = json.readTree(post("/api/v1/warehouse/projects", ADMIN, project).body()).get("id").asLong();
    String identity = "reader-" + suffix;
    var issued = post("/api/v1/warehouse/identities", ADMIN, json.createObjectNode().put("id", identity));
    assertThat(issued.statusCode()).isEqualTo(200);
    String token = json.readTree(issued.body()).get("token").asText();
    String prefix = "/api/v1/warehouse/projects/" + projectId;
    assertStatus(post(prefix + "/members", ADMIN, json.createObjectNode().put("identity", identity).put("role", "VIEWER")), 200);
    assertThat(json.readTree(get("/api/v1/warehouse/projects", token).body())).hasSize(1);
    assertStatus(get("/api/v1/warehouse/projects/" + otherId + "/assets", token), 403);
    assertStatus(post(prefix + "/members", token, json.createObjectNode().put("identity", identity).put("role", "OWNER")), 403);
    assertStatus(post("/api/v1/warehouse/projects", token, project), 403);
    assertStatus(get("/api/v1/lake/runs", token), 401);
    assertStatus(post("/api/v1/warehouse/identities", ADMIN, json.createObjectNode().put("id", "local-admin")), 400);
    String source = "assets_" + suffix;
    var sourceBody = json.createObjectNode().put("code", source).put("sourceType", "MYSQL").put("credentialRef", "env://SYNTHETIC_SOURCE");
    sourceBody.putObject("config"); assertStatus(post("/api/v1/sources", ADMIN, sourceBody), 201);
    var bind = json.createObjectNode().put("sourceCode", source);
    assertStatus(post(prefix + "/sources", ADMIN, bind), 200);
    assertStatus(post("/api/v1/warehouse/projects/" + otherId + "/sources", ADMIN, bind), 409);
    assertStatus(get(prefix + "/sources", token), 200);
    ObjectNode inventory = (ObjectNode) json.readTree("""
        {"planVersion":1,"observedAt":"2026-09-15T00:00:00Z","sourceScope":{},
         "objects":[{"objectName":"example","objectType":"TABLE","schema":[],
           "primaryKey":["id"],"required":true,"strategy":"FULL_SNAPSHOT","state":"READY"}]}
        """);
    inventory.put("sourceCode", source).put("schemaSha256", "a".repeat(64));
    assertStatus(post("/api/v1/lake/inventories", ADMIN, inventory), 201);
    var registered = post("/api/v1/lake/manifests", WORKER, manifest(source, "asset-run", "2026-09-16T02:00:00Z")); assertStatus(registered, 201);
    long run = json.readTree(registered.body()).get("systemRunId").asLong();
    var assets = get(prefix + "/assets", token); assertStatus(assets, 200);
    var listed = json.readTree(assets.body()); assertThat(listed).hasSize(1);
    String assetId = listed.get(0).get("id").asText();
    var detail = get(prefix + "/assets/" + assetId, token); assertStatus(detail, 200);
    assertThat(detail.body()).doesNotContain("raw_path", "storage_path", "credential", "token");
    assertStatus(get("/api/v1/warehouse/projects/" + otherId + "/assets/" + assetId, ADMIN), 404);
    var coverage = get(prefix + "/coverage/" + run, token); assertStatus(coverage, 200);
    assertThat(json.readTree(coverage.body()).at("/coverage/committed").asLong()).isEqualTo(1);
    assertStatus(post("/api/v1/warehouse/identities/" + identity + "/revoke", ADMIN, json.createObjectNode()), 200);
    assertStatus(get(prefix + "/assets", token), 401);
  }

  @Test
  void independentWorkerReceivesAndParsesADirectoryDeliveryThroughTheQueue() throws Exception {
    Path repo = Path.of(System.getenv("LAKE_REVIEW_REPO"));
    Path root = Files.createTempDirectory("jiuzhang-worker-integration-");
    Path inbox = Files.createDirectory(root.resolve("inbox"));
    Path lake = root.resolve("lake");
    Files.writeString(inbox.resolve("data.csv"), "id,name\n001,example\n");
    Files.writeString(inbox.resolve("data.csv.done"), "");
    String source = "worker_" + UUID.randomUUID().toString().replace("-", "");
    var sourceBody = json.createObjectNode().put("code", source).put("sourceType", "FILE")
        .put("credentialRef", "env://SYNTHETIC_FOLDER");
    sourceBody.putObject("config"); assertStatus(post("/api/v1/sources", ADMIN, sourceBody), 201);
    var day = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
    var plan = json.createObjectNode().put("sourceCode", source).put("expectedVersion", 0)
        .put("kind", "FILE_SCAN").put("runtimeRef", source).put("timezone", "Asia/Shanghai")
        .put("triggerTime", "00:00:00").put("startDate", day.toString())
        .put("historicalRead", true).put("maxAttempts", 3).put("timeoutSeconds", 300);
    plan.putObject("contract");
    var saved = post("/api/v1/lake/plans", ADMIN, plan); assertStatus(saved, 200);
    long planId = json.readTree(saved.body()).get("id").asLong();
    try {
      assertStatus(post("/api/v1/lake/plans/" + planId + "/trigger", ADMIN,
          json.createObjectNode().put("day", day.toString()).put("reason", "directory integration")), 200);
      var registry = json.createObjectNode().put("version", 1).put("lakeRoot", lake.toString());
      registry.putObject("profiles").putObject(source).put("kind", "FILE_SCAN")
          .put("sourceCode", source).put("inboxRoot", inbox.toString());
      Path registryFile = root.resolve("registry.json"); Files.writeString(registryFile, registry.toString());
      var builder = new ProcessBuilder("node", repo.resolve("apps/ingestion-worker/lake-runtime.mjs").toString(),
          "--registry", registryFile.toString(), "--control-api", base, "--instance", source, "--once");
      builder.environment().put("CONTROL_API_WORKER_TOKEN", WORKER);
      Path output = root.resolve("worker-output.json"); builder.redirectErrorStream(true).redirectOutput(output.toFile());
      var process = builder.start(); boolean finished = process.waitFor(30, TimeUnit.SECONDS);
      if (!finished) process.destroyForcibly(); assertThat(finished).isTrue();
      assertThat(process.exitValue()).as("Worker output: %s", Files.readString(output)).isZero();
      var attempts = app.getBean(LakeExecutionService.class).attempts(planId);
      assertThat(attempts).hasSize(1); assertThat(attempts.getFirst().get("state")).isEqualTo("COMPLETE");
      var result = (JsonNode) attempts.getFirst().get("result");
      assertThat(result.get("parsed").asInt()).isEqualTo(1);
      try (var owner = owner()) {
        assertThat(scalar(owner, "SELECT count(*) FROM warehouse.external_asset WHERE execution_id = ? AND state = 'PARSED'", attempts.getFirst().get("id"))).isEqualTo(1L);
      }
      assertThat(result.at("/assets/0/schema/provenance").asText()).isEqualTo("OBSERVED_SAMPLE");
      JsonNode batch = json.readTree(Files.readString(lake.resolve("file-batches").resolve(result.get("batchId").asText()).resolve("batch.json")));
      Path parsed = lake.resolve(batch.at("/entries/0/parsedPath").asText());
      assertThat(json.readTree(Files.readString(parsed)).get("id").asText()).isEqualTo("001");
      try (var receipts = Files.list(lake.resolve("worker-outbox").resolve(source))) {
        var receipt = json.readTree(Files.readString(receipts.findFirst().orElseThrow()));
        assertThat(receipt.get("acknowledged").asBoolean()).isTrue();
      }
      Files.delete(inbox.resolve("data.csv")); Files.delete(inbox.resolve("data.csv.done")); Files.delete(inbox);
      long originalExecution = ((Number) attempts.getFirst().get("id")).longValue();
      var reprocess = post("/api/v1/lake/executions/" + originalExecution + "/reprocess", ADMIN, json.createObjectNode()); assertStatus(reprocess, 200);
      assertThat(post("/api/v1/lake/executions/" + originalExecution + "/reprocess", ADMIN, json.createObjectNode()).body()).isEqualTo(reprocess.body());
      var resumed = builder.start(); boolean resumedFinished = resumed.waitFor(30, TimeUnit.SECONDS);
      if (!resumedFinished) resumed.destroyForcibly(); assertThat(resumedFinished).isTrue();
      assertThat(resumed.exitValue()).as("Worker output: %s", Files.readString(output)).isZero();
      assertThat(app.getBean(LakeExecutionService.class).attempts(planId).getFirst().get("state")).isEqualTo("COMPLETE");
    } finally {
      app.getBean(LakeExecutionService.class).setState(planId, "PAUSED", "local-review");
      // Only this test-created synthetic directory is removed.
      try (var files = Files.walk(root)) { for (Path file : files.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(file); }
    }
  }

  private static HttpRequest request(String path, String token, JsonNode body) {
    return HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(15))
        .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
  }

  @Test
  void browserAccountsEnforceCsrfProjectScopeAndRevocation() throws Exception {
    String identity = "browser_" + UUID.randomUUID().toString().replace("-", "");
    var projectResponse = post("/api/v1/warehouse/projects", ADMIN,
        json.createObjectNode().put("code",identity).put("name","Browser project"));
    assertStatus(projectResponse,200);
    long project=json.readTree(projectResponse.body()).get("id").asLong();
    var invitation=post("/api/v1/warehouse/accounts/invite",ADMIN,json.createObjectNode()
        .put("identity",identity).put("displayName","Synthetic user").put("projectId",project).put("role","OWNER"));
    assertStatus(invitation,200);
    String code=json.readTree(invitation.body()).get("invitation").asText();
    String password="Synthetic-password-"+UUID.randomUUID();
    var cookies=new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL);
    var browser=HttpClient.newBuilder().cookieHandler(cookies).build();
    var csrf=browserCsrf(browser);
    var activate=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/activate"))
        .header("Content-Type","application/json").header(csrf.get("headerName").asText(),csrf.get("token").asText())
        .POST(HttpRequest.BodyPublishers.ofString(json.createObjectNode().put("invitation",code).put("password",password).toString())).build();
    assertStatus(browser.send(activate,HttpResponse.BodyHandlers.ofString()),200);
    assertStatus(browser.send(activate,HttpResponse.BodyHandlers.ofString()),400);
    var noCsrf=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login"))
        .header("Content-Type","application/x-www-form-urlencoded").header("Authorization","Bearer forged")
        .POST(HttpRequest.BodyPublishers.ofString("username="+identity+"&password="+password)).build();
    assertStatus(browser.send(noCsrf,HttpResponse.BodyHandlers.ofString()),403);
    var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login"))
        .header("Content-Type","application/x-www-form-urlencoded").header(csrf.get("headerName").asText(),csrf.get("token").asText())
        .POST(HttpRequest.BodyPublishers.ofString("username="+identity+"&password="+password)).build();
    assertStatus(browser.send(login,HttpResponse.BodyHandlers.ofString()),200);
    assertThat(cookies.getCookieStore().getCookies()).anySatisfy(cookie -> {assertThat(cookie.isHttpOnly()).isTrue();});
    var me=HttpRequest.newBuilder(URI.create(base+"/api/v1/warehouse/me")).GET().build();
    assertStatus(browser.send(me,HttpResponse.BodyHandlers.ofString()),200);
    assertThat(json.readTree(browser.send(me,HttpResponse.BodyHandlers.ofString()).body()).get("identity").asText()).isEqualTo(identity);
    assertStatus(browser.send(HttpRequest.newBuilder(me.uri()).header("Authorization","Bearer invalid").GET().build(),HttpResponse.BodyHandlers.ofString()),401);
    var unauthorized=HttpRequest.newBuilder(URI.create(base+"/api/v1/warehouse/catalog/projects/9223372036854775806/sources")).GET().build();
    assertStatus(browser.send(unauthorized,HttpResponse.BodyHandlers.ofString()),403);
    var page=HttpRequest.newBuilder(URI.create(base+"/api/v1/warehouse/catalog/projects?limit=1")).GET().build();
    var result=browser.send(page,HttpResponse.BodyHandlers.ofString());assertStatus(result,200);
    assertThat(json.readTree(result.body()).get("total").asInt()).isEqualTo(1);
    assertStatus(post("/api/v1/warehouse/accounts/"+identity+"/reset",ADMIN,json.createObjectNode()),200);
    assertStatus(browser.send(me,HttpResponse.BodyHandlers.ofString()),401);
    assertStatus(browser.send(login,HttpResponse.BodyHandlers.ofString()),403); // pre-login token was rotated
  }

  private static JsonNode browserCsrf(HttpClient browser) throws Exception {
    var response=browser.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString());
    assertStatus(response,200);return json.readTree(response.body());
  }

  @Test
  @EnabledIfEnvironmentVariable(named = "LAKE_REVIEW_SCALE", matches = "true")
  void catalogPaginatesFiftySystemsThreeHundredChannelsAndTenThousandObjects() throws Exception {
    String prefix="scale_"+UUID.randomUUID().toString().replace("-", "");
    long project=json.readTree(post("/api/v1/warehouse/projects",ADMIN,json.createObjectNode().put("code",prefix).put("name","Synthetic metadata scale")).body()).path("id").asLong();
    long firstSystem;
    try(var connection=owner()){
      connection.setAutoCommit(false);
      var jdbc=new org.springframework.jdbc.core.JdbcTemplate(new org.springframework.jdbc.datasource.SingleConnectionDataSource(connection,true));
      jdbc.update("INSERT INTO warehouse.business_system(code,name,business_owner,technical_owner,managing_project_id) SELECT ?||'_'||n,'Synthetic system '||n,'Synthetic','Synthetic',? FROM generate_series(1,50) n",prefix,project);
      jdbc.update("INSERT INTO warehouse.system_project SELECT id,? FROM warehouse.business_system WHERE managing_project_id=?",project,project);
      jdbc.update("INSERT INTO warehouse.system_instance(system_id,code,name,environment) SELECT id,'test','Test','TEST' FROM warehouse.business_system WHERE managing_project_id=?",project);
      jdbc.update("INSERT INTO warehouse.instance_project SELECT i.id,? FROM warehouse.system_instance i JOIN warehouse.business_system s ON s.id=i.system_id WHERE s.managing_project_id=?",project,project);
      jdbc.update("INSERT INTO warehouse.execution_environment(code,name,worker_ids,max_parallel) VALUES (?,'Synthetic scale','[]',2)",prefix);
      long resource=jdbc.queryForObject("INSERT INTO warehouse.ingest_resource(code,name,environment_code,kind,resource_group,max_parallel,max_bytes,requests_per_second) VALUES (?,'Scale MySQL',?,'MYSQL_SNAPSHOT',?,1,1048576,5) RETURNING id",Long.class,prefix,prefix,prefix);
      jdbc.update("INSERT INTO warehouse.resource_project(resource_id,project_id) VALUES (?,?)",resource,project);
      jdbc.update("INSERT INTO warehouse.ingest_connection(instance_id,code,name,resource_id,managing_project_id,active_version) SELECT i.id,'connection_'||n,'Connection '||n,?,?,1 FROM warehouse.system_instance i JOIN warehouse.business_system s ON s.id=i.system_id CROSS JOIN generate_series(1,3) n WHERE s.managing_project_id=?",resource,project,project);
      jdbc.update("INSERT INTO warehouse.connection_project(connection_id,project_id) SELECT id,? FROM warehouse.ingest_connection WHERE managing_project_id=?",project,project);
      jdbc.update("INSERT INTO warehouse.connection_version(connection_id,version,config,created_by) SELECT id,1,'{\"database\":\"synthetic\"}',? FROM warehouse.ingest_connection WHERE managing_project_id=?",prefix,project);
      jdbc.update("INSERT INTO control.source_connection(code,source_type,credential_ref) SELECT ?||'_'||c.id||'_'||n,'MYSQL','env://SYNTHETIC' FROM warehouse.ingest_connection c CROSS JOIN generate_series(1,2) n WHERE c.managing_project_id=?",prefix,project);
      jdbc.update("INSERT INTO warehouse.project_source(source_id,project_id) SELECT id,? FROM control.source_connection WHERE starts_with(code,?||'_')",project,prefix);
      jdbc.update("INSERT INTO warehouse.ingest_channel(source_id,connection_id,name,active_version) SELECT s.id,c.id,'Channel '||n,1 FROM warehouse.ingest_connection c CROSS JOIN generate_series(1,2) n JOIN control.source_connection s ON s.code=?||'_'||c.id||'_'||n WHERE c.managing_project_id=?",prefix,project);
      jdbc.update("INSERT INTO warehouse.channel_version(source_id,version,connection_id,connection_version,config,created_by) SELECT ch.source_id,1,ch.connection_id,1,'{}',? FROM warehouse.ingest_channel ch JOIN warehouse.project_source ps ON ps.source_id=ch.source_id WHERE ps.project_id=?",prefix,project);
      long source=jdbc.queryForObject("SELECT min(source_id) FROM warehouse.project_source WHERE project_id=?",Long.class,project);
      long inventory=jdbc.queryForObject("INSERT INTO lake.inventory(source_id,plan_version,observed_at,source_scope,object_count,schema_sha256,state) VALUES (?,1,now(),'{}',10000,repeat('a',64),'ACTIVE') RETURNING id",Long.class,source);
      jdbc.update("INSERT INTO lake.source_object(inventory_id,object_name,object_type,schema_json,strategy,state) SELECT ?,'table_'||lpad(n::text,5,'0'),'TABLE','[]','FULL_SNAPSHOT','READY' FROM generate_series(1,10000) n",inventory);
      long run=jdbc.queryForObject("INSERT INTO lake.system_run(source_id,plan_version,run_key,mode,state,started_at,finished_at) VALUES (?,1,?,'FULL','COMPLETE',now(),now()) RETURNING id",Long.class,source,prefix);
      jdbc.update("INSERT INTO lake.object_run(system_run_id,source_object_id,state,row_count) SELECT ?,id,'RAW_COMMITTED',0 FROM lake.source_object WHERE inventory_id=?",run,inventory);
      firstSystem=jdbc.queryForObject("SELECT min(id) FROM warehouse.business_system WHERE managing_project_id=?",Long.class,project);
      connection.commit();
    }
    var timings=json.createObjectNode();var seen=new java.util.HashSet<String>();
    for(var kind:java.util.Map.of("systems",50,"connections",150,"channels",300,"assets",10000).entrySet()){
      String route=kind.getKey().equals("systems")?"/api/v1/warehouse/projects/"+project+"/systems":"/api/v1/warehouse/catalog/projects/"+project+"/"+kind.getKey();
      long started=System.nanoTime();seen.clear();int requests=0;
      for(int offset=0;offset<kind.getValue();offset+=200){
        var response=get(route+"?limit=200&offset="+offset,ADMIN);assertStatus(response,200);var result=json.readTree(response.body());
        assertThat(result.path("total").asInt()).isEqualTo(kind.getValue());
        for(var row:result.path("items"))assertThat(seen.add(row.path("id").asText())).isTrue();requests++;
      }
      assertThat(seen).hasSize(kind.getValue());timings.putObject(kind.getKey()).put("objects",seen.size()).put("requests",requests).put("elapsedMillis",(System.nanoTime()-started)/1000000);
    }
    var filtered=json.readTree(get("/api/v1/warehouse/catalog/projects/"+project+"/assets?q=table_099&limit=25&offset=75",ADMIN).body());
    assertThat(filtered.path("total").asInt()).isEqualTo(100);assertThat(filtered.path("items")).hasSize(25);
    var targets=json.createObjectNode().put("action","PAUSE").put("reason","Synthetic scale impact preview");targets.putArray("targets").addObject().put("type","system").put("id",firstSystem).put("expectedVersion",1);
    var preview=post("/api/v1/warehouse/projects/"+project+"/ingestion-operations/preview",ADMIN,targets);assertStatus(preview,200);
    var evidence=json.createObjectNode().put("state","PASS").put("scope","Synthetic metadata pagination; not ingestion throughput").put("projectId",project).put("java",System.getProperty("java.version")).put("processors",Runtime.getRuntime().availableProcessors()).put("maxHeapBytes",Runtime.getRuntime().maxMemory());evidence.set("timings",timings);evidence.set("impact",json.readTree(preview.body()));
    Path output=Path.of(System.getenv("LAKE_REVIEW_REPO"),"work/product-review/scale-evidence.json");Files.createDirectories(output.getParent());Files.writeString(output,json.writerWithDefaultPrettyPrinter().writeValueAsString(evidence));
  }

  @Test
  @EnabledIfEnvironmentVariable(named = "LAKE_REVIEW_BROWSER", matches = "true")
  void browserCompletesManagedIngestionModelAndScopedQuery() throws Exception {
    Path repo=Path.of(System.getenv("LAKE_REVIEW_REPO"));
    var builder=new ProcessBuilder("node",repo.resolve("tests/product-browser.mjs").toString()).directory(repo.toFile());
    builder.environment().put("MODEL_TEST_API",base);builder.environment().put("MODEL_TEST_ADMIN",ADMIN);
    builder.environment().put("CONTROL_API_WORKER_TOKEN",WORKER);
    Path output=repo.resolve("work/product-review/browser-integration.log");Files.createDirectories(output.getParent());
    builder.redirectErrorStream(true).redirectOutput(output.toFile());
    var process=builder.start();boolean finished=process.waitFor(240,TimeUnit.SECONDS);
    if(!finished)process.destroyForcibly();assertThat(finished).as("Browser integration timed out").isTrue();
    assertThat(process.exitValue()).as("Browser: %s",Files.readString(output)).isZero();
  }

  @Test
  void dynamicWorkerOnboardsFileAndApiChannelsWithoutChangingProfiles() throws Exception {
    Path repo=Path.of(System.getenv("LAKE_REVIEW_REPO"));
    var builder=new ProcessBuilder("node",repo.resolve("tests/managed-ingestion-integration.mjs").toString()).directory(repo.toFile());
    builder.environment().put("MODEL_TEST_API",base);builder.environment().put("MODEL_TEST_ADMIN",ADMIN);builder.environment().put("CONTROL_API_WORKER_TOKEN",WORKER);
    Path output=repo.resolve("work/lake-review/managed-ingestion-integration.log");builder.redirectErrorStream(true).redirectOutput(output.toFile());
    var process=builder.start();boolean finished=process.waitFor(90,TimeUnit.SECONDS);if(!finished)process.destroyForcibly();assertThat(finished).isTrue();
    assertThat(process.exitValue()).as("Managed integration: %s",Files.readString(output)).isZero();
  }

  @Test
  void systemDirectoryKeepsSharedMetadataSeparateFromInstancesAndChecksVersions() throws Exception {
    String code="system_"+UUID.randomUUID().toString().replace("-", "");
    long project=json.readTree(post("/api/v1/warehouse/projects",ADMIN,json.createObjectNode().put("code",code).put("name","Systems")).body()).get("id").asLong();
    long other=json.readTree(post("/api/v1/warehouse/projects",ADMIN,json.createObjectNode().put("code",code+"b").put("name","Other")).body()).get("id").asLong();
    String token=json.readTree(post("/api/v1/warehouse/identities",ADMIN,json.createObjectNode().put("id",code)).body()).get("token").asText();
    assertStatus(post("/api/v1/warehouse/projects/"+other+"/members",ADMIN,json.createObjectNode().put("identity",code).put("role","OWNER")),200);
    String path="/api/v1/warehouse/projects/"+project+"/systems";
    var body=json.createObjectNode().put("code",code).put("name","ERP").put("businessOwner","Synthetic business owner").put("technicalOwner","Synthetic technical owner");
    var created=post(path,ADMIN,body);assertStatus(created,200);long system=json.readTree(created.body()).get("id").asLong();
    var instance=post(path+"/"+system+"/instances",ADMIN,json.createObjectNode().put("code","test").put("name","Test").put("environment","TEST"));assertStatus(instance,200);
    long instanceId=json.readTree(instance.body()).get("id").asLong();
    String sharedPath="/api/v1/warehouse/projects/"+other+"/systems";
    assertStatus(get(sharedPath+"/"+system,token),403);
    var share=json.createObjectNode().put("projectId",other);share.putArray("instanceIds");
    assertStatus(post(path+"/"+system+"/share",ADMIN,share),200);
    var shared=get(sharedPath+"/"+system,token);assertStatus(shared,200);
    assertThat(json.readTree(shared.body()).get("instances")).isEmpty();
    assertThat(json.readTree(get(sharedPath,token).body()).at("/items/0/instance_count").asInt()).isZero();
    body.put("expectedVersion",1).put("name","ERP renamed");
    assertStatus(post(sharedPath+"/"+system,token,body),403);
    assertStatus(post(path+"/"+system,ADMIN,body),200);
    assertStatus(post(path+"/"+system,ADMIN,body),409);
    share.withArray("instanceIds").add(instanceId);
    assertStatus(post(path+"/"+system+"/share",ADMIN,share),200);
    assertThat(json.readTree(get(sharedPath+"/"+system,token).body()).get("instances")).hasSize(1);
    assertThat(json.readTree(get(sharedPath+"?environment=PRODUCTION",token).body()).get("total").asInt()).isZero();
    assertThat(json.readTree(get(sharedPath+"?environment=TEST&limit=1&offset=1",token).body()).get("total").asInt()).isEqualTo(1);
    assertThat(json.readTree(get(sharedPath+"?environment=TEST&limit=1&offset=1",token).body()).get("items")).isEmpty();
  }

  @Test
  @EnabledIfEnvironmentVariable(named = "LAKE_REVIEW_DBT_PYTHON", matches = ".+")
  void dbtProductBuildPublishAndQueryUsesRealRolesAndSql() throws Exception {
    Path repo = Path.of(System.getenv("LAKE_REVIEW_REPO"));
    var builder = new ProcessBuilder(System.getenv("LAKE_REVIEW_DBT_PYTHON"), repo.resolve("tests/model-product-integration.py").toString());
    builder.environment().put("MODEL_TEST_API", base);
    builder.environment().put("MODEL_TEST_ADMIN", ADMIN);
    builder.environment().put("CONTROL_API_WORKER_TOKEN", WORKER);
    Path output = repo.resolve("work/lake-review/model-integration.log");
    builder.redirectErrorStream(true).redirectOutput(output.toFile());
    var process = builder.start(); boolean finished = process.waitFor(180, TimeUnit.SECONDS);
    if (!finished) process.destroyForcibly(); assertThat(finished).isTrue();
    assertThat(process.exitValue()).as("See private model-integration.log for execution evidence").isZero();
  }

  @Test
  void apiWorkerRepairsParsingWithoutContactingTheSourceAgain() throws Exception {
    Path repo = Path.of(System.getenv("LAKE_REVIEW_REPO"));
    var builder = new ProcessBuilder("node", repo.resolve("tests/api-worker-integration.mjs").toString()).directory(repo.toFile());
    builder.environment().put("MODEL_TEST_API", base); builder.environment().put("MODEL_TEST_ADMIN", ADMIN);
    builder.environment().put("CONTROL_API_WORKER_TOKEN", WORKER);
    Path output = repo.resolve("work/lake-review/api-worker-integration.log"); builder.redirectErrorStream(true).redirectOutput(output.toFile());
    var process = builder.start(); boolean finished = process.waitFor(60, TimeUnit.SECONDS);
    if (!finished) process.destroyForcibly(); assertThat(finished).isTrue();
    assertThat(process.exitValue()).as("See private api-worker-integration.log").isZero();
  }

  private static HttpResponse<String> get(String path, String token) throws Exception {
    return http.send(HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(15))
        .header("Authorization", "Bearer " + token).GET().build(), HttpResponse.BodyHandlers.ofString());
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
