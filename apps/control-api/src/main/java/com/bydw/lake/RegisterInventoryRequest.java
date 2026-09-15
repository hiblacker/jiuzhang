package com.bydw.lake;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;
import java.util.List;

public record RegisterInventoryRequest(
    String sourceCode,
    long planVersion,
    OffsetDateTime observedAt,
    JsonNode sourceScope,
    String schemaSha256,
    List<InventoryObject> objects) {
  public record InventoryObject(
      String objectName,
      String objectType,
      JsonNode schema,
      List<String> primaryKey,
      boolean required,
      String strategy,
      String state) {}
}
