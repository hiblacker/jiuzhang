package com.bydw.source;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Iterator;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SourceService {
  private static final Pattern CODE = Pattern.compile("[a-z][a-z0-9_-]{2,99}");
  private static final Pattern SOURCE_TYPE = Pattern.compile("[A-Z][A-Z0-9_]{1,39}");
  private static final Pattern CREDENTIAL_REF = Pattern.compile("env://[A-Z][A-Z0-9_]{2,99}");
  private static final Pattern SENSITIVE_KEY = Pattern.compile(
      "(?i)(password|passwd|pwd|secret|token|api[-_]?key|private[-_]?key|credential)");
  private static final int MAX_CONFIG_BYTES = 16_384;

  private final SourceRepository repository;
  private final ObjectMapper objectMapper;

  public SourceService(SourceRepository repository, ObjectMapper objectMapper) {
    this.repository = repository;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public SourceConnection create(CreateSourceRequest request, String principal) {
    if (request == null || !matches(CODE, request.code())) {
      throw badRequest("INVALID_SOURCE_CODE", "Source code must use lowercase letters, digits, _ or -");
    }
    if (!matches(SOURCE_TYPE, request.sourceType())) {
      throw badRequest("INVALID_SOURCE_TYPE", "Source type must be an uppercase stable identifier");
    }
    if (request.config() == null || !request.config().isObject()) {
      throw badRequest("INVALID_SOURCE_CONFIG", "Source config must be a JSON object");
    }
    rejectSensitiveKeys(request.config());
    if (!matches(CREDENTIAL_REF, request.credentialRef())) {
      throw badRequest("INVALID_CREDENTIAL_REF", "Credential reference must use env://VARIABLE_NAME");
    }

    String configJson = json(request.config());
    if (configJson.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_CONFIG_BYTES) {
      throw badRequest("SOURCE_CONFIG_TOO_LARGE", "Source config exceeds 16384 bytes");
    }
    SourceConnection source;
    try {
      source = repository.create(
          request.code(), request.sourceType(), configJson, request.credentialRef());
    } catch (DuplicateKeyException exception) {
      throw new ApiException(HttpStatus.CONFLICT, "SOURCE_CONFLICT", "Source code already exists");
    }
    repository.audit(principal, "SOURCE_CREATE", "source/" + source.id(),
        json(Map.of("code", source.code(), "sourceType", source.sourceType())));
    return source;
  }

  @Transactional
  public SourcePage list(int limit, int offset, String principal) {
    if (limit < 1 || limit > 100 || offset < 0 || offset > 1_000_000) {
      throw badRequest("INVALID_PAGE", "limit must be 1..100 and offset must be 0..1000000");
    }
    var items = repository.list(limit, offset);
    repository.audit(principal, "SOURCE_LIST", "sources",
        json(Map.of("limit", limit, "offset", offset, "returned", items.size())));
    return new SourcePage(items, limit, offset, items.size());
  }

  @Transactional
  public SourceConnection find(long id, String principal) {
    if (id < 1) throw badRequest("INVALID_SOURCE_ID", "Source id must be positive");
    SourceConnection source = repository.findById(id)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SOURCE_NOT_FOUND", "Source not found"));
    repository.audit(principal, "SOURCE_READ", "source/" + id, "{}");
    return source;
  }

  private void rejectSensitiveKeys(JsonNode node) {
    if (node.isObject()) {
      Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
      while (fields.hasNext()) {
        Map.Entry<String, JsonNode> field = fields.next();
        if (SENSITIVE_KEY.matcher(field.getKey()).find()) {
          throw badRequest("SENSITIVE_CONFIG_KEY", "Secrets must use credentialRef, not source config");
        }
        rejectSensitiveKeys(field.getValue());
      }
    } else if (node.isArray()) {
      node.forEach(this::rejectSensitiveKeys);
    }
  }

  private String json(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "Value cannot be serialized");
    }
  }

  private boolean matches(Pattern pattern, String value) {
    return value != null && pattern.matcher(value).matches();
  }

  private ApiException badRequest(String code, String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, code, message);
  }
}
