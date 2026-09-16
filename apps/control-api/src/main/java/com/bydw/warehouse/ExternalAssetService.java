package com.bydw.warehouse;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Called inside the execution completion transaction, after its lease is checked. */
@Service
public class ExternalAssetService {
  private final JdbcTemplate jdbc;
  public ExternalAssetService(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  public void register(long execution, String source, String kind, JsonNode result, String state) {
    if (result == null || !result.has("assets")) {
      if ("COMPLETE".equals(state)) bad();
      return;
    }
    JsonNode assets = result.path("assets");
    if (!assets.isArray() || assets.size() > 1000) bad();
    String expectedKind = "FILE_SCAN".equals(kind) ? "FILE" : "API";
    var keys = new HashSet<String>();
    for (JsonNode asset : assets) {
      String key = asset.path("key").asText();
      if (key.isBlank() || key.length() > 512 || !keys.add(key) || !expectedKind.equals(asset.path("kind").asText())
          || !java.util.Set.of("RAW_COMMITTED", "PARSED", "FAILED").contains(asset.path("state").asText())
          || !asset.path("contractSha256").asText().matches("[0-9a-f]{64}")
          || !asset.path("rows").canConvertToLong() || asset.path("rows").asLong() < 0
          || !asset.path("bytes").canConvertToLong() || asset.path("bytes").asLong() < 0
          || !asset.path("schema").isObject() || !asset.path("evidence").isObject()) bad();
      evidence(asset.at("/evidence/raw"));
      if (asset.path("state").asText().equals("PARSED")) evidence(asset.at("/evidence/parsed"));
      jdbc.update("""
          INSERT INTO warehouse.external_asset(execution_id, source_id, object_key, kind, business_date,
            state, contract_sha256, schema_json, evidence, row_count, byte_count)
          SELECT a.id, s.id, ?, ?, w.business_date, ?, ?, ?::jsonb, ?::jsonb, ?, ?
          FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id = a.window_id
          JOIN lake.ingestion_plan p ON p.id = w.plan_id JOIN control.source_connection s ON s.id = p.source_id
          WHERE a.id = ? AND s.code = ?
          """, key, expectedKind, asset.path("state").asText(), asset.path("contractSha256").asText(),
          asset.path("schema").toString(), asset.path("evidence").toString(), asset.path("rows").asLong(), asset.path("bytes").asLong(), execution, source);
    }
  }
  private static void evidence(JsonNode node) {
    String path = node.path("path").asText();
    if (!node.isObject() || path.isBlank() || path.length() > 2000 || path.startsWith("/") || path.contains("\\")
        || java.util.Arrays.asList(path.split("/", -1)).stream().anyMatch(part -> part.equals("..") || part.isBlank())
        || !node.path("sha256").asText().matches("[0-9a-f]{64}") || !node.path("bytes").canConvertToLong() || node.path("bytes").asLong() < 0) bad();
  }
  private static void bad() { throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ASSET_EVIDENCE", "Asset completion evidence is invalid"); }
}
