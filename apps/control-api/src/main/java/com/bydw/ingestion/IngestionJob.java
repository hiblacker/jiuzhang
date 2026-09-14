package com.bydw.ingestion;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;

public record IngestionJob(
    long id,
    long sourceId,
    String objectName,
    String strategy,
    JsonNode cursorSpec,
    JsonNode deleteSpec,
    String state,
    long version,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
