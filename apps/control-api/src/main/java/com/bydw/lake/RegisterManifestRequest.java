package com.bydw.lake;

import java.time.OffsetDateTime;
import java.util.List;

public record RegisterManifestRequest(
    String sourceCode,
    long planVersion,
    String runKey,
    String mode,
    int attempt,
    int revision,
    String state,
    String consistency,
    OffsetDateTime scheduledWindowStart,
    OffsetDateTime scheduledWindowEnd,
    OffsetDateTime startedAt,
    OffsetDateTime finishedAt,
    String errorCode,
    List<ManifestObject> objects) {
  public record ManifestObject(
      String objectName,
      String state,
      long rowCount,
      long byteCount,
      String rawPath,
      String rawSha256,
      String schemaSha256,
      String format) {}
}
