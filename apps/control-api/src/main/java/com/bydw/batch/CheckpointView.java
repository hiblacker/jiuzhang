package com.bydw.batch;

import com.fasterxml.jackson.databind.JsonNode;

public record CheckpointView(JsonNode value, long version) {}
