package com.bydw.lake;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

@ExtendWith(MockitoExtension.class)
class LakeRegistrationServiceTest {
  @Mock JdbcTemplate jdbc;

  @Test
  void rejectsUntrustedManifestBeforeDatabaseAccess() {
    var service = new LakeRegistrationService(jdbc, new ObjectMapper());
    var request = new RegisterManifestRequest(
        "../source", 1, "batch:1", "FULL", 1, 1, "COMPLETE", "ONE_REPEATABLE_READ_TRANSACTION",
        null, null, null, null, null, java.util.List.of());
    assertThatThrownBy(() -> service.registerManifest(request, "worker-a"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> org.assertj.core.api.Assertions.assertThat(exception.code()).isEqualTo("INVALID_SOURCE_CODE"));
  }

  @Test
  void rejectsInventoryWithoutAHashOrObjects() {
    var service = new LakeRegistrationService(jdbc, new ObjectMapper());
    var request = new RegisterInventoryRequest("mysql-source", 1, java.time.OffsetDateTime.now(), null, "bad", java.util.List.of());
    assertThatThrownBy(() -> service.registerInventory(request, "admin"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> org.assertj.core.api.Assertions.assertThat(exception.code()).isEqualTo("INVALID_INVENTORY"));
  }
}
