package com.bydw.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class HealthControllerTest {
  @Test
  void reportsStableServiceIdentity() {
    var status = new HealthController().status();
    assertThat(status).containsEntry("service", "by-data-warehouse-control-api").containsEntry("status", "UP");
    assertThat(status).containsKey("time");
  }
}
