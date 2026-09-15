package com.bydw.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

final class Checksums {
  private static final HexFormat HEX = HexFormat.of();
  private final ObjectMapper objectMapper;

  Checksums(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  String payloadChecksum(JsonNode payload) {
    return sha256(jsonBytes(payload));
  }

  MessageDigest batchDigest() {
    try {
      return MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is required", exception);
    }
  }

  void appendPayloadChecksum(MessageDigest digest, String payloadChecksum, boolean first) {
    if (!first) digest.update((byte) '\n');
    digest.update(payloadChecksum.getBytes(StandardCharsets.UTF_8));
  }

  String finish(MessageDigest digest) {
    return HEX.formatHex(digest.digest());
  }

  private byte[] jsonBytes(JsonNode node) {
    try {
      return objectMapper.writeValueAsBytes(node);
    } catch (Exception exception) {
      throw new IllegalArgumentException("Payload cannot be serialized", exception);
    }
  }

  private static String sha256(byte[] value) {
    try {
      return HEX.formatHex(MessageDigest.getInstance("SHA-256").digest(value));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is required", exception);
    }
  }
}
