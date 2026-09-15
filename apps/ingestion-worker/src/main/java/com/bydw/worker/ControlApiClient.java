package com.bydw.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class ControlApiClient {
  private final HttpClient http;
  private final ObjectMapper objectMapper;
  private final String baseUrl;
  private final String workerToken;
  private final String instanceId;

  ControlApiClient(
      ObjectMapper objectMapper,
      @Value("${bydw.worker.api-base-url}") String baseUrl,
      @Value("${bydw.worker.worker-token}") String workerToken,
      @Value("${bydw.worker.instance-id}") String instanceId) {
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    this.objectMapper = objectMapper;
    this.baseUrl = trimSlash(baseUrl);
    this.workerToken = workerToken;
    this.instanceId = instanceId;
  }

  JsonNode waitUntilReady(int waitSeconds) {
    long deadline = System.nanoTime() + waitSeconds * 1_000_000_000L;
    Exception last = null;
    while (System.nanoTime() < deadline) {
      try {
        return get("/api/v1/status");
      } catch (Exception exception) {
        last = exception;
        try {
          Thread.sleep(2_000L);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw new WorkerFailedException("WORKER_INTERRUPTED", "Interrupted while waiting for control API");
        }
      }
    }
    throw new WorkerFailedException("CONTROL_API_UNAVAILABLE", "Control API was not ready", last);
  }

  JsonNode getJob(long jobId) {
    return get("/api/v1/ingestion-jobs/" + jobId);
  }

  JsonNode checkpoint(long jobId) {
    return get("/api/v1/ingestion-jobs/" + jobId + "/checkpoint");
  }

  JsonNode startBatch(long jobId, String runKey, JsonNode cursorTo) {
    ObjectNode body = objectMapper.createObjectNode();
    body.put("runKey", runKey);
    body.set("cursorTo", cursorTo);
    return send("POST", "/api/v1/ingestion-jobs/" + jobId + "/batches", body);
  }

  JsonNode heartbeat(long batchId) {
    return send("POST", "/api/v1/ingestion-batches/" + batchId + "/heartbeat", null);
  }

  JsonNode complete(
      long batchId, long expectedCheckpointVersion, JsonNode nextCheckpoint, long rowCount, String checksum) {
    ObjectNode body = objectMapper.createObjectNode();
    body.put("expectedCheckpointVersion", expectedCheckpointVersion);
    body.set("nextCheckpoint", nextCheckpoint);
    body.put("rowCount", rowCount);
    body.put("checksum", checksum);
    return send("POST", "/api/v1/ingestion-batches/" + batchId + "/complete", body);
  }

  JsonNode fail(long batchId, String errorCode, String diagnosticRef) {
    ObjectNode body = objectMapper.createObjectNode();
    body.put("errorCode", errorCode);
    if (diagnosticRef != null) body.put("diagnosticRef", diagnosticRef);
    return send("POST", "/api/v1/ingestion-batches/" + batchId + "/fail", body);
  }

  private JsonNode get(String path) {
    return send("GET", path, null);
  }

  private JsonNode send(String method, String path, JsonNode body) {
    try {
      HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path))
          .timeout(Duration.ofSeconds(15))
          .header("Authorization", "Bearer " + workerToken)
          .header("X-Worker-Instance", instanceId)
          .header("Accept", "application/json");
      if (body == null) {
        builder.method(method, HttpRequest.BodyPublishers.noBody());
      } else {
        builder.header("Content-Type", "application/json")
            .method(method, HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)));
      }
      HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      JsonNode parsed = parse(response.body());
      if (response.statusCode() >= 200 && response.statusCode() < 300) return parsed;
      String code = parsed.path("code").asText("HTTP_" + response.statusCode());
      throw new WorkerFailedException(code, "Control API " + method + " " + path + " returned " + response.statusCode());
    } catch (WorkerFailedException exception) {
      throw exception;
    } catch (IOException | InterruptedException exception) {
      if (exception instanceof InterruptedException) Thread.currentThread().interrupt();
      throw new WorkerFailedException("CONTROL_API_REQUEST_FAILED", "Control API request failed", exception);
    }
  }

  private JsonNode parse(String body) {
    if (body == null || body.isBlank()) return objectMapper.createObjectNode();
    try {
      return objectMapper.readTree(body);
    } catch (Exception exception) {
      return objectMapper.createObjectNode();
    }
  }

  private static String trimSlash(String value) {
    if (value == null || value.isBlank()) return "http://control-api:8080";
    return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
  }
}
