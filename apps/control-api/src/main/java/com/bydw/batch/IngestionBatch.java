package com.bydw.batch;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;

public record IngestionBatch(
    long id,
    long jobId,
    String runKey,
    int attempt,
    JsonNode cursorFrom,
    JsonNode cursorTo,
    String state,
    long rowCount,
    String checksum,
    String errorCode,
    String diagnosticRef,
    long checkpointVersion,
    OffsetDateTime startedAt,
    OffsetDateTime finishedAt,
    OffsetDateTime committedAt) {}
