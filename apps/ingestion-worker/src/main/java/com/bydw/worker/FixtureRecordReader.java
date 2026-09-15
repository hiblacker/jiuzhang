package com.bydw.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

final class FixtureRecordReader {
  private static final int MAX_LINE_BYTES = 1_048_576;
  private final ObjectMapper objectMapper;

  FixtureRecordReader(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  List<FixtureRecord> read(Path path) throws IOException {
    if (path == null || !Files.isRegularFile(path)) {
      throw new IllegalArgumentException("Fixture path must be a regular file");
    }
    List<FixtureRecord> records = new ArrayList<>();
    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
      String line;
      int lineNumber = 0;
      while ((line = reader.readLine()) != null) {
        lineNumber++;
        if (line.isBlank()) continue;
        if (line.getBytes(StandardCharsets.UTF_8).length > MAX_LINE_BYTES) {
          throw new IllegalArgumentException("Fixture line " + lineNumber + " exceeds 1MiB");
        }
        records.add(parse(line, lineNumber));
      }
    }
    return records;
  }

  private FixtureRecord parse(String line, int lineNumber) {
    JsonNode node;
    try {
      node = objectMapper.readTree(line);
    } catch (Exception exception) {
      throw new IllegalArgumentException("Fixture line " + lineNumber + " is not valid JSON", exception);
    }
    if (node == null || !node.isObject()) {
      throw new IllegalArgumentException("Fixture line " + lineNumber + " must be a JSON object");
    }
    JsonNode key = node.get("sourceRecordKey");
    JsonNode payload = node.get("payload");
    if (key == null || !key.isObject() || key.isEmpty()
        || payload == null || !payload.isObject()) {
      throw new IllegalArgumentException(
          "Fixture line " + lineNumber + " requires non-empty sourceRecordKey and payload objects");
    }
    return new FixtureRecord(key, payload, timestamp(node.get("sourceUpdatedAt"), lineNumber),
        timestamp(node.get("eventTime"), lineNumber));
  }

  private OffsetDateTime timestamp(JsonNode value, int lineNumber) {
    if (value == null || value.isNull()) return null;
    if (!value.isTextual()) {
      throw new IllegalArgumentException("Fixture line " + lineNumber + " timestamps must be text or null");
    }
    try {
      return OffsetDateTime.parse(value.textValue());
    } catch (Exception exception) {
      throw new IllegalArgumentException("Fixture line " + lineNumber + " has an invalid timestamp", exception);
    }
  }
}
