package com.bydw.ingestion;

import com.fasterxml.jackson.databind.JsonNode;

public record CreateIngestionJobRequest(
    long sourceId,
    String objectName,
    String strategy,
    JsonNode cursorSpec,
    JsonNode deleteSpec) {}
