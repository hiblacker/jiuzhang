package com.bydw.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class HealthControllerTest {
  @Test
  void reportsStableServiceIdentity() {
    var status = new HealthController().status();
    assertThat(status).containsEntry("service", "jiuzhang-control-api").containsEntry("status", "UP");
    assertThat(status).containsKey("time");
  }
}
