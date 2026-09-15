package com.bydw.ingestion;

import com.bydw.api.ApiException;
import com.bydw.source.SourceConnection;
import com.bydw.source.SourceRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IngestionJobService {
  private static final Pattern OBJECT_NAME = Pattern.compile(
      "[A-Za-z_][A-Za-z0-9_$]{0,63}(\\.[A-Za-z_][A-Za-z0-9_$]{0,63}){0,2}");
  private static final Pattern COLUMN_NAME = Pattern.compile("[A-Za-z_][A-Za-z0-9_$]{0,63}");
  private static final Set<String> STRATEGIES = Set.of("FULL", "UPDATED_AT_KEYSET", "RECONCILIATION");
  private static final Set<String> CURSOR_KEYS = Set.of("updatedAtColumn", "keyColumns", "overlapSeconds");
  private static final Set<String> DELETE_KEYS = Set.of("mode", "column", "activeValue", "deletedValue");

  private final IngestionJobRepository repository;
  private final SourceRepository sourceRepository;
  private final ObjectMapper objectMapper;

  public IngestionJobService(
      IngestionJobRepository repository, SourceRepository sourceRepository, ObjectMapper objectMapper) {
    this.repository = repository;
    this.sourceRepository = sourceRepository;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public IngestionJob create(CreateIngestionJobRequest request, String principal) {
    if (request == null || request.sourceId() < 1) {
      throw badRequest("INVALID_SOURCE_ID", "Source id must be positive");
    }
    SourceConnection source = sourceRepository.findById(request.sourceId())
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SOURCE_NOT_FOUND", "Source not found"));
    if ("DISABLED".equals(source.state())) {
      throw new ApiException(HttpStatus.CONFLICT, "SOURCE_DISABLED", "Disabled source cannot accept jobs");
    }
    if (request.objectName() == null || !OBJECT_NAME.matcher(request.objectName()).matches()) {
      throw badRequest("INVALID_OBJECT_NAME", "Object name must contain one to three identifier segments");
    }
    if (request.strategy() == null || !STRATEGIES.contains(request.strategy())) {
      throw badRequest("INVALID_INGESTION_STRATEGY", "Unsupported ingestion strategy");
    }
    validateCursor(request.strategy(), request.cursorSpec());
    validateDelete(request.deleteSpec());

    IngestionJob job;
    try {
      job = repository.create(request.sourceId(), request.objectName(), request.strategy(),
          json(request.cursorSpec()), json(request.deleteSpec()));
    } catch (DuplicateKeyException exception) {
      throw new ApiException(HttpStatus.CONFLICT, "INGESTION_JOB_CONFLICT",
          "An ingestion job already exists for this source object");
    }
    sourceRepository.audit(principal, "INGESTION_JOB_CREATE", "ingestion-job/" + job.id(),
        json(Map.of("sourceId", job.sourceId(), "objectName", job.objectName(),
            "strategy", job.strategy())));
    return job;
  }

  @Transactional
  public IngestionJobPage list(int limit, int offset, String principal) {
    validatePage(limit, offset);
    List<IngestionJob> items = repository.list(limit, offset);
    sourceRepository.audit(principal, "INGESTION_JOB_LIST", "ingestion-jobs",
        json(Map.of("limit", limit, "offset", offset, "returned", items.size())));
    return new IngestionJobPage(items, limit, offset, items.size());
  }

  @Transactional
  public IngestionJob find(long id, String principal) {
    if (id < 1) throw badRequest("INVALID_INGESTION_JOB_ID", "Ingestion job id must be positive");
    IngestionJob job = repository.findById(id)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
            "INGESTION_JOB_NOT_FOUND", "Ingestion job not found"));
    sourceRepository.audit(principal, "INGESTION_JOB_READ", "ingestion-job/" + id, "{}");
    return job;
  }

  @Transactional
  public IngestionJob activate(long id, String principal) {
    if (id < 1) throw badRequest("INVALID_INGESTION_JOB_ID", "Ingestion job id must be positive");
    IngestionJob activated = repository.activate(id).orElse(null);
    if (activated != null) {
      sourceRepository.audit(principal, "INGESTION_JOB_ACTIVATE", "ingestion-job/" + id,
          json(Map.of("state", activated.state())));
      return activated;
    }
    IngestionJob existing = repository.findById(id)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
            "INGESTION_JOB_NOT_FOUND", "Ingestion job not found"));
    throw new ApiException(HttpStatus.CONFLICT, "INGESTION_JOB_DISABLED",
        "Disabled ingestion job cannot be activated");
  }

  private void validateCursor(String strategy, JsonNode spec) {
    requireObject(spec, "INVALID_CURSOR_SPEC", "Cursor spec must be a JSON object");
    rejectUnknownKeys(spec, CURSOR_KEYS, "UNKNOWN_CURSOR_FIELD");
    JsonNode keys = spec.get("keyColumns");
    if (keys == null || !keys.isArray() || keys.isEmpty() || keys.size() > 8) {
      throw badRequest("INVALID_KEY_COLUMNS", "keyColumns must contain 1..8 identifiers");
    }
    Set<String> unique = new HashSet<>();
    for (JsonNode key : keys) {
      if (!key.isTextual() || !COLUMN_NAME.matcher(key.textValue()).matches() || !unique.add(key.textValue())) {
        throw badRequest("INVALID_KEY_COLUMNS", "keyColumns must be unique identifiers");
      }
    }

    if ("UPDATED_AT_KEYSET".equals(strategy)) {
      JsonNode updated = spec.get("updatedAtColumn");
      JsonNode overlap = spec.get("overlapSeconds");
      if (updated == null || !updated.isTextual()
          || !COLUMN_NAME.matcher(updated.textValue()).matches()) {
        throw badRequest("INVALID_UPDATED_AT_COLUMN", "updatedAtColumn must be an identifier");
      }
      if (overlap == null || !overlap.canConvertToInt()
          || overlap.intValue() < 0 || overlap.intValue() > 86_400) {
        throw badRequest("INVALID_OVERLAP", "overlapSeconds must be 0..86400");
      }
    } else if (spec.has("updatedAtColumn") || spec.has("overlapSeconds")) {
      throw badRequest("UNUSED_CURSOR_FIELD", "Only UPDATED_AT_KEYSET accepts update cursor fields");
    }
  }

  private void validateDelete(JsonNode spec) {
    requireObject(spec, "INVALID_DELETE_SPEC", "Delete spec must be a JSON object");
    rejectUnknownKeys(spec, DELETE_KEYS, "UNKNOWN_DELETE_FIELD");
    JsonNode modeNode = spec.get("mode");
    String mode = modeNode != null && modeNode.isTextual() ? modeNode.textValue() : null;
    if (mode == null || !Set.of("NONE", "LOGICAL_FLAG", "KEY_RECONCILIATION").contains(mode)) {
      throw badRequest("INVALID_DELETE_MODE", "Unsupported delete mode");
    }
    if ("LOGICAL_FLAG".equals(mode)) {
      JsonNode column = spec.get("column");
      JsonNode active = spec.get("activeValue");
      JsonNode deleted = spec.get("deletedValue");
      if (column == null || !column.isTextual() || !COLUMN_NAME.matcher(column.textValue()).matches()
          || !isScalar(active) || !isScalar(deleted) || active.equals(deleted)) {
        throw badRequest("INVALID_LOGICAL_DELETE", "Logical delete requires column and distinct scalar values");
      }
    } else if (spec.size() != 1) {
      throw badRequest("UNUSED_DELETE_FIELD", "Delete mode does not accept additional fields");
    }
  }

  private boolean isScalar(JsonNode value) {
    return value != null && (value.isTextual() || value.isNumber() || value.isBoolean());
  }

  private void requireObject(JsonNode value, String code, String message) {
    if (value == null || !value.isObject()) throw badRequest(code, message);
  }

  private void rejectUnknownKeys(JsonNode object, Set<String> allowed, String code) {
    object.fieldNames().forEachRemaining(name -> {
      if (!allowed.contains(name)) throw badRequest(code, "Contract contains an unsupported field");
    });
  }

  private void validatePage(int limit, int offset) {
    if (limit < 1 || limit > 100 || offset < 0 || offset > 1_000_000) {
      throw badRequest("INVALID_PAGE", "limit must be 1..100 and offset must be 0..1000000");
    }
  }

  private String json(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw badRequest("INVALID_JSON", "Value cannot be serialized");
    }
  }

  private ApiException badRequest(String code, String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, code, message);
  }
}
