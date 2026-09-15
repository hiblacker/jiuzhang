package com.bydw.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FixtureRecordReaderTest {
  private final FixtureRecordReader reader = new FixtureRecordReader(new ObjectMapper());

  @Test
  void readsJsonlAndSkipsBlankLines(@TempDir Path directory) throws Exception {
    Path file = directory.resolve("records.jsonl");
    Files.writeString(file, """
        {"sourceRecordKey":{"ID":1},"payload":{"ID":1,"TYPE":0},"sourceUpdatedAt":"2026-09-15T01:00:00+08:00"}

        {"sourceRecordKey":{"ID":2},"payload":{"ID":2,"TYPE":1},"eventTime":null}
        """);
    var records = reader.read(file);
    assertThat(records).hasSize(2);
    assertThat(records.get(0).sourceRecordKey().path("ID").asInt()).isEqualTo(1);
    assertThat(records.get(0).sourceUpdatedAt()).isNotNull();
    assertThat(records.get(1).eventTime()).isNull();
  }

  @Test
  void rejectsMissingKeyOrPayload(@TempDir Path directory) throws Exception {
    Path file = directory.resolve("bad.jsonl");
    Files.writeString(file, "{\"payload\":{\"ID\":1}}\n");
    assertThatThrownBy(() -> reader.read(file)).isInstanceOf(IllegalArgumentException.class);
  }
}
