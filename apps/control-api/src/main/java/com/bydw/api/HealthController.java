package com.bydw.api;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class HealthController {
  @GetMapping("/status")
  public Map<String, Object> status() {
    return Map.of("service", "jiuzhang-control-api", "status", "UP", "time", OffsetDateTime.now(ZoneOffset.UTC));
  }
}
