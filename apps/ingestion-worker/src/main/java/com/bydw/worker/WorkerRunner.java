package com.bydw.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.stereotype.Component;

@Component
class WorkerRunner implements ApplicationRunner, ExitCodeGenerator {
  private static final Logger LOG = LoggerFactory.getLogger(WorkerRunner.class);
  private static final Pattern INSTANCE = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$");
  private static final Pattern RUN_KEY = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,119}");

  private final ControlApiClient api;
  private final RawIngestRepository raw;
  private final ObjectMapper objectMapper;
  private final FixtureRecordReader reader;
  private final RecordWindow window;
  private final Checksums checksums;
  private final String instanceId;
  private final long jobId;
  private final String runKey;
  private final JsonNode cursorTo;
  private final Path fixturePath;
  private final int leaseSeconds;
  private final int heartbeatSeconds;
  private final int apiWaitSeconds;
  private volatile int exitCode = 1;

  WorkerRunner(
      ControlApiClient api,
      RawIngestRepository raw,
      ObjectMapper objectMapper,
      @Value("${bydw.worker.instance-id}") String instanceId,
      @Value("${bydw.worker.job-id}") long jobId,
      @Value("${bydw.worker.run-key}") String runKey,
      @Value("${bydw.worker.cursor-to}") String cursorToJson,
      @Value("${bydw.worker.fixture-path}") String fixturePath,
      @Value("${bydw.worker.lease-duration-seconds}") int leaseSeconds,
      @Value("${bydw.worker.heartbeat-interval-seconds}") int heartbeatSeconds,
      @Value("${bydw.worker.api-wait-seconds}") int apiWaitSeconds) {
    this.api = api;
    this.raw = raw;
    this.objectMapper = objectMapper;
    this.reader = new FixtureRecordReader(objectMapper);
    this.window = new RecordWindow();
    this.checksums = new Checksums(objectMapper);
    this.instanceId = instanceId;
    this.jobId = jobId;
    this.runKey = runKey;
    try {
      this.cursorTo = objectMapper.readTree(cursorToJson);
    } catch (Exception exception) {
      throw new IllegalArgumentException("INGESTION_CURSOR_TO must be a JSON object", exception);
    }
    this.fixturePath = Path.of(fixturePath);
    this.leaseSeconds = leaseSeconds;
    this.heartbeatSeconds = heartbeatSeconds;
    this.apiWaitSeconds = apiWaitSeconds;
  }

  @Override
  public void run(ApplicationArguments args) {
    Long batchId = null;
    boolean started = false;
    try {
      validate();
      api.waitUntilReady(apiWaitSeconds);
      JsonNode job = api.getJob(jobId);
      String strategy = job.path("strategy").asText();
      if (!"FULL".equals(strategy) && !"UPDATED_AT_KEYSET".equals(strategy)) {
        throw new WorkerFailedException("UNSUPPORTED_STRATEGY", "Worker only executes FULL or UPDATED_AT_KEYSET");
      }
      JsonNode checkpoint = api.checkpoint(jobId);
      JsonNode batch = api.startBatch(jobId, runKey, cursorTo);
      batchId = batch.path("id").asLong();
      String state = batch.path("state").asText();
      String owner = batch.path("leaseOwner").asText();
      if ("SUCCEEDED".equals(state)) {
        LOG.info("Batch already succeeded: jobId={}, batchId={}, runKey={}", jobId, batchId, runKey);
        exitCode = 0;
        return;
      }
      if (!"RUNNING".equals(state)) {
        throw new WorkerFailedException("BATCH_NOT_RUNNING", "Start returned non-running batch " + state);
      }
      if (!instanceId.equals(owner)) {
        throw new WorkerFailedException("BATCH_LEASE_NOT_ACTIVE", "Running batch is owned by another worker");
      }
      started = true;
      JsonNode cursorFrom = batch.get("cursorFrom");
      long expectedVersion = batch.path("checkpointVersion").asLong();
      List<String> keyColumns = window.keyColumns(job.get("cursorSpec"));
      int overlap = window.overlapSeconds(job.get("cursorSpec"));
      ScheduledExecutorService heartbeats = startHeartbeats(batchId);
      try {
        List<FixtureRecord> records = reader.read(fixturePath);
        MessageDigest digest = checksums.batchDigest();
        boolean first = true;
        int written = 0;
        for (FixtureRecord record : records) {
          if (!window.includes(strategy, record, cursorFrom, cursorTo, overlap, keyColumns)) continue;
          String payloadChecksum = checksums.payloadChecksum(record.payload());
          raw.ingest(batchId, record.sourceRecordKey(), record.payload(), payloadChecksum,
              record.sourceUpdatedAt(), record.eventTime());
          checksums.appendPayloadChecksum(digest, payloadChecksum, first);
          first = false;
          written++;
        }
        String batchChecksum = checksums.finish(digest);
        long sealed = raw.seal(batchId, batchChecksum, instanceId);
        JsonNode completed = api.complete(batchId, expectedVersion, cursorTo, sealed, batchChecksum);
        LOG.info("Batch completed: jobId={}, batchId={}, state={}, sealed={}, written={}",
            jobId, batchId, completed.path("state").asText(), sealed, written);
        if (!"SUCCEEDED".equals(completed.path("state").asText())) {
          throw new WorkerFailedException("BATCH_NOT_SUCCEEDED", "Complete did not return SUCCEEDED");
        }
        exitCode = 0;
      } finally {
        heartbeats.shutdownNow();
      }
    } catch (WorkerFailedException exception) {
      LOG.error("Worker failed: code={}, jobId={}", exception.errorCode(), jobId);
      failQuietly(started, batchId, exception.errorCode());
    } catch (Exception exception) {
      LOG.error("Worker failed: jobId={}, exceptionType={}", jobId, exception.getClass().getName());
      failQuietly(started, batchId, "WORKER_EXECUTION_FAILED");
    }
  }

  @Override
  public int getExitCode() {
    return exitCode;
  }

  private void validate() {
    if (jobId < 1) throw new IllegalArgumentException("INGESTION_JOB_ID must be positive");
    if (runKey == null || !RUN_KEY.matcher(runKey).matches()) {
      throw new IllegalArgumentException("INGESTION_RUN_KEY must be a stable identifier");
    }
    if (instanceId == null || !INSTANCE.matcher(instanceId).matches()) {
      throw new IllegalArgumentException("WORKER_INSTANCE_ID must be a stable bounded identifier");
    }
    if (cursorTo == null || !cursorTo.isObject() || cursorTo.isEmpty()) {
      throw new IllegalArgumentException("INGESTION_CURSOR_TO must be a non-empty JSON object");
    }
    if (leaseSeconds < 30 || leaseSeconds > 3600) {
      throw new IllegalArgumentException("Batch lease duration must be between 30 and 3600 seconds");
    }
  }

  private ScheduledExecutorService startHeartbeats(long batchId) {
    int interval = heartbeatSeconds > 0 ? heartbeatSeconds : Math.max(5, leaseSeconds / 2);
    ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(thread -> {
      Thread worker = new Thread(thread);
      worker.setName("ingestion-heartbeat");
      worker.setDaemon(true);
      return worker;
    });
    executor.scheduleAtFixedRate(() -> {
      try {
        api.heartbeat(batchId);
      } catch (RuntimeException exception) {
        LOG.error("Heartbeat failed: batchId={}", batchId);
      }
    }, interval, interval, TimeUnit.SECONDS);
    return executor;
  }

  private void failQuietly(boolean started, Long batchId, String errorCode) {
    if (!started || batchId == null) return;
    try {
      String diagnostic = ("worker-run/" + runKey);
      if (diagnostic.length() > 300) diagnostic = diagnostic.substring(0, 300);
      api.fail(batchId, errorCode, diagnostic);
    } catch (RuntimeException ignored) {
      LOG.error("Failed to mark batch failed: batchId={}", batchId);
    }
  }
}
