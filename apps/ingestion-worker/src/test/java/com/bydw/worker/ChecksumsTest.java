package com.bydw.worker;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import org.junit.jupiter.api.Test;

class ChecksumsTest {
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final Checksums checksums = new Checksums(objectMapper);

  @Test
  void emptyBatchChecksumIsSha256OfEmptyInput() {
    assertThat(checksums.finish(checksums.batchDigest()))
        .isEqualTo("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  }

  @Test
  void payloadChecksumIsStableForTheSameJson() throws Exception {
    var payload = objectMapper.readTree("{\"ID\":1,\"TYPE\":0}");
    String first = checksums.payloadChecksum(payload);
    String second = checksums.payloadChecksum(objectMapper.readTree("{\"ID\":1,\"TYPE\":0}"));
    assertThat(first).isEqualTo(second).hasSize(64);
  }

  @Test
  void batchChecksumJoinsPayloadChecksumsWithNewlines() throws Exception {
    String one = checksums.payloadChecksum(objectMapper.readTree("{\"ID\":1}"));
    String two = checksums.payloadChecksum(objectMapper.readTree("{\"ID\":2}"));
    MessageDigest digest = checksums.batchDigest();
    checksums.appendPayloadChecksum(digest, one, true);
    checksums.appendPayloadChecksum(digest, two, false);
    assertThat(checksums.finish(digest)).hasSize(64).isNotEqualTo(one);
  }
}
