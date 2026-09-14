package com.bydw.batch;

import com.fasterxml.jackson.databind.JsonNode;

public record CompleteBatchRequest(
    long expectedCheckpointVersion,
    JsonNode nextCheckpoint,
    long rowCount,
    String checksum) {}
