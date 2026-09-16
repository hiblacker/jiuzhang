package com.bydw.lake;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/** Local development driver. External mode is triggered by the approved scheduler. */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "bydw.lake.calendar-driver", havingValue = "local")
public class LakeCalendarDriver {
  private static final Logger LOG = LoggerFactory.getLogger(LakeCalendarDriver.class);
  private final LakeExecutionService service;
  private final com.bydw.warehouse.SystemDeliveryService delivery;
  public LakeCalendarDriver(LakeExecutionService service,com.bydw.warehouse.SystemDeliveryService delivery) { this.service = service;this.delivery=delivery; }
  @Scheduled(fixedDelayString = "${bydw.lake.calendar-interval-ms:10000}")
  public void tick() {
    try { service.reconcile(Instant.now());delivery.reconcile(Instant.now()); }
    catch (Exception error) { LOG.error("Lake calendar reconciliation failed: {}", error.getClass().getSimpleName()); }
  }
}
