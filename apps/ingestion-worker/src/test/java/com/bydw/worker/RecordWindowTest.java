package com.bydw.worker;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

class RecordWindowTest {
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final RecordWindow window = new RecordWindow();

  @Test
  void fullStrategyKeepsRecordsWithoutTimestamps() throws Exception {
    var record = new FixtureRecord(
        objectMapper.readTree("{\"ID\":1}"), objectMapper.readTree("{\"ID\":1}"), null, null);
    assertThat(window.includes("FULL", record, objectMapper.createObjectNode(),
        objectMapper.readTree("{\"updatedAt\":\"2026-09-15T12:00:00+08:00\"}"), 0, List.of("ID")))
        .isTrue();
  }

  @Test
  void updatedAtWindowIsHalfOpenAndAppliesOverlap() throws Exception {
    var inRange = record(1, "2026-09-15T10:00:00+08:00");
    var atUpperSameKey = record(99, "2026-09-15T12:00:00+08:00");
    var atUpperLowerKey = record(1, "2026-09-15T12:00:00+08:00");
    var beforeCheckpoint = record(1, "2026-09-15T08:00:00+08:00");
    var overlapped = record(1, "2026-09-15T08:55:00+08:00");
    var cursorFrom = objectMapper.readTree("{\"updatedAt\":\"2026-09-15T09:00:00+08:00\",\"ID\":0}");
    var cursorTo = objectMapper.readTree("{\"updatedAt\":\"2026-09-15T12:00:00+08:00\",\"ID\":99}");
    var timeOnlyUpper = objectMapper.readTree("{\"updatedAt\":\"2026-09-15T12:00:00+08:00\"}");
    List<String> keys = List.of("ID");
    assertThat(window.includes("UPDATED_AT_KEYSET", inRange, cursorFrom, cursorTo, 300, keys)).isTrue();
    assertThat(window.includes("UPDATED_AT_KEYSET", atUpperSameKey, cursorFrom, cursorTo, 300, keys)).isFalse();
    assertThat(window.includes("UPDATED_AT_KEYSET", atUpperLowerKey, cursorFrom, cursorTo, 300, keys)).isTrue();
    assertThat(window.includes("UPDATED_AT_KEYSET", atUpperLowerKey, cursorFrom, timeOnlyUpper, 300, keys)).isFalse();
    assertThat(window.includes("UPDATED_AT_KEYSET", beforeCheckpoint, cursorFrom, cursorTo, 300, keys)).isFalse();
    assertThat(window.includes("UPDATED_AT_KEYSET", overlapped, cursorFrom, cursorTo, 300, keys)).isTrue();
    assertThat(window.includes("UPDATED_AT_KEYSET", overlapped, cursorFrom, cursorTo, 0, keys)).isFalse();
  }

  @Test
  void missingUpdateTimeIsNotInventedForIncrementalReads() throws Exception {
    var record = new FixtureRecord(
        objectMapper.readTree("{\"ID\":1}"), objectMapper.readTree("{\"ID\":1}"), null, null);
    var cursorTo = objectMapper.readTree("{\"updatedAt\":\"2026-09-15T12:00:00+08:00\"}");
    assertThat(window.includes("UPDATED_AT_KEYSET", record, objectMapper.createObjectNode(),
        cursorTo, 0, List.of("ID"))).isFalse();
  }

  private FixtureRecord record(int id, String updatedAt) throws Exception {
    return new FixtureRecord(
        objectMapper.readTree("{\"ID\":" + id + "}"),
        objectMapper.readTree("{\"ID\":" + id + "}"),
        OffsetDateTime.parse(updatedAt),
        null);
  }
}
