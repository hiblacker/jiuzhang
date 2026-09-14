package com.bydw.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SourceServiceTest {
  @Mock SourceRepository repository;
  private ObjectMapper objectMapper;
  private SourceService service;

  @BeforeEach
  void setUp() {
    objectMapper = new ObjectMapper();
    service = new SourceService(repository, objectMapper);
  }

  @Test
  void createsDraftSourceAndAuditsWithoutCredentialValue() throws Exception {
    var config = objectMapper.readTree("{\"host\":\"mysql.internal\",\"port\":3306}");
    var stored = new SourceConnection(7, "devops_mysql", "MYSQL", config, "DRAFT",
        OffsetDateTime.parse("2026-09-14T00:00:00Z"), OffsetDateTime.parse("2026-09-14T00:00:00Z"));
    when(repository.create("devops_mysql", "MYSQL", config.toString(), "env://DEVOPS_DB_PASSWORD"))
        .thenReturn(stored);

    var result = service.create(new CreateSourceRequest(
        "devops_mysql", "MYSQL", config, "env://DEVOPS_DB_PASSWORD"), "local-admin");

    assertThat(result).isEqualTo(stored);
    verify(repository).audit(eq("local-admin"), eq("SOURCE_CREATE"), eq("source/7"), anyString());
  }

  @Test
  void rejectsNestedSecretFields() throws Exception {
    var config = objectMapper.readTree("{\"options\":{\"password\":\"must-not-store\"}}");

    assertThatThrownBy(() -> service.create(new CreateSourceRequest(
        "devops_mysql", "MYSQL", config, "env://DEVOPS_DB_PASSWORD"), "local-admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("SENSITIVE_CONFIG_KEY"));
  }

  @Test
  void enforcesCredentialReferenceAndStableCodes() throws Exception {
    var config = objectMapper.readTree("{}");
    for (var request : List.of(
        new CreateSourceRequest("UPPER", "MYSQL", config, "env://DEVOPS_DB_PASSWORD"),
        new CreateSourceRequest("valid_code", "mysql", config, "env://DEVOPS_DB_PASSWORD"),
        new CreateSourceRequest("valid_code", "MYSQL", config, "plain-password"))) {
      assertThatThrownBy(() -> service.create(request, "local-admin"))
          .isInstanceOf(ApiException.class);
    }
  }

  @Test
  void enforcesBoundedPaginationAndAuditsRead() {
    when(repository.list(50, 0)).thenReturn(List.of());

    SourcePage page = service.list(50, 0, "local-admin");

    assertThat(page.count()).isZero();
    verify(repository).audit(eq("local-admin"), eq("SOURCE_LIST"), eq("sources"), anyString());
    for (int[] invalid : List.of(new int[] {0, 0}, new int[] {101, 0}, new int[] {10, -1})) {
      assertThatThrownBy(() -> service.list(invalid[0], invalid[1], "local-admin"))
          .isInstanceOf(ApiException.class);
    }
  }
}
