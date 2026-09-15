package com.bydw.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class WebCorsConfigurationTest {
  @Test
  void parsesOnlyExplicitOriginsAndRemovesDuplicates() {
    assertThat(WebCorsConfiguration.parseOrigins(
        "http://127.0.0.1:4173, http://localhost:4173,http://127.0.0.1:4173"))
        .containsExactly("http://127.0.0.1:4173", "http://localhost:4173");
  }

  @Test
  void rejectsWildcardPathAndQueryOrigins() {
    assertThatThrownBy(() -> WebCorsConfiguration.parseOrigins("*"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> WebCorsConfiguration.parseOrigins("http://localhost:4173/path"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> WebCorsConfiguration.parseOrigins("http://localhost:4173?token=x"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
