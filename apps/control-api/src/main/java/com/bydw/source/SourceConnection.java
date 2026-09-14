package com.bydw.source;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;

public record SourceConnection(
    long id,
    String code,
    String sourceType,
    JsonNode config,
    String state,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
