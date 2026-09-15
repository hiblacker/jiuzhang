package com.bydw.worker;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

final class RecordWindow {
  boolean includes(
      String strategy,
      FixtureRecord record,
      JsonNode cursorFrom,
      JsonNode cursorTo,
      int overlapSeconds,
      List<String> keyColumns) {
    if ("FULL".equals(strategy)) return true;
    if (!"UPDATED_AT_KEYSET".equals(strategy)) return false;
    if (record.sourceUpdatedAt() == null) return false;
    OffsetDateTime upper = timestamp(cursorTo, "updatedAt");
    if (upper == null) {
      throw new IllegalArgumentException("UPDATED_AT_KEYSET cursorTo.updatedAt is required");
    }
    if (compare(record, cursorTo, keyColumns, upper) >= 0) return false;
    OffsetDateTime lower = timestamp(cursorFrom, "updatedAt");
    if (lower == null) return true;
    if (overlapSeconds > 0) lower = lower.minus(overlapSeconds, ChronoUnit.SECONDS);
    return compare(record, cursorFrom, keyColumns, lower) >= 0;
  }

  List<String> keyColumns(JsonNode cursorSpec) {
    List<String> keys = new ArrayList<>();
    if (cursorSpec == null || !cursorSpec.has("keyColumns") || !cursorSpec.get("keyColumns").isArray()) {
      return keys;
    }
    for (JsonNode key : cursorSpec.get("keyColumns")) {
      if (key.isTextual()) keys.add(key.textValue());
    }
    return keys;
  }

  int overlapSeconds(JsonNode cursorSpec) {
    if (cursorSpec == null || !cursorSpec.has("overlapSeconds") || !cursorSpec.get("overlapSeconds").canConvertToInt()) {
      return 0;
    }
    return cursorSpec.get("overlapSeconds").intValue();
  }

  private int compare(
      FixtureRecord record, JsonNode cursor, List<String> keyColumns, OffsetDateTime boundTime) {
    int time = record.sourceUpdatedAt().compareTo(boundTime);
    if (time != 0 || keyColumns.isEmpty() || cursor == null) return time;
    for (String key : keyColumns) {
      JsonNode left = record.sourceRecordKey().get(key);
      JsonNode right = cursor.get(key);
      if (left == null || right == null) continue;
      int compared = stringify(left).compareTo(stringify(right));
      if (compared != 0) return compared;
    }
    return 0;
  }

  private OffsetDateTime timestamp(JsonNode cursor, String field) {
    if (cursor == null || !cursor.has(field) || cursor.get(field).isNull()) return null;
    JsonNode value = cursor.get(field);
    if (!value.isTextual()) return null;
    return OffsetDateTime.parse(value.textValue());
  }

  private String stringify(JsonNode value) {
    if (value.isTextual()) return value.textValue();
    if (value.isNumber()) return value.numberValue().toString();
    if (value.isBoolean()) return Boolean.toString(value.booleanValue());
    return value.toString();
  }
}
