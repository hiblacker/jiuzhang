package com.bydw.source;

import com.fasterxml.jackson.databind.JsonNode;

public record CreateSourceRequest(
    String code, String sourceType, JsonNode config, String credentialRef) {}
