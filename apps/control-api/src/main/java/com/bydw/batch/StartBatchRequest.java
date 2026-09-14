package com.bydw.batch;

import com.fasterxml.jackson.databind.JsonNode;

public record StartBatchRequest(String runKey, JsonNode cursorTo) {}
