package com.bydw.lake;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.when;

import com.bydw.api.ApiException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

@ExtendWith(MockitoExtension.class)
class LakeControllerTest {
  @Mock JdbcTemplate jdbc;

  @Test
  void summaryAllowsAllSourcesWithoutPuttingNullIntoMapOf() {
    when(jdbc.queryForMap(anyString(), nullable(String.class), nullable(String.class)))
        .thenReturn(Map.of("run_count", 0L))
        .thenReturn(Map.of("object_count", 0L));

    var result = new LakeController(jdbc).summary(null);

    assertThat(result).containsEntry("sourceCode", null);
    assertThat(result).containsKeys("runs", "objects");
  }

  @Test
  void rejectsUnboundedSourceIdentifiersAndLimits() {
    var controller = new LakeController(jdbc);
    assertThatThrownBy(() -> controller.summary("../secret"))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INVALID_SOURCE_CODE"));
    assertThatThrownBy(() -> controller.runs(null, 201))
        .isInstanceOfSatisfying(ApiException.class,
            exception -> assertThat(exception.code()).isEqualTo("INVALID_LIMIT"));
  }
}
