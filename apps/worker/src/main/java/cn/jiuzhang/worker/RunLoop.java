package cn.jiuzhang.worker;

import cn.jiuzhang.platform.execution.application.ExecutionEngine;
import cn.jiuzhang.platform.warehouse.application.WarehouseService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class RunLoop {
  private final ExecutionEngine engine;
  private final WarehouseService warehouse;

  public RunLoop(ExecutionEngine engine, WarehouseService warehouse) {
    this.engine = engine;
    this.warehouse = warehouse;
  }

  @Scheduled(fixedDelay = 500)
  void run() {
    try {
      engine.next();
    } catch (Exception e) {
      org.slf4j.LoggerFactory.getLogger(RunLoop.class)
          .warn("Worker poll failed ({})", e.getClass().getSimpleName());
    }
  }

  @Scheduled(fixedDelay = 60000, initialDelay = 15000)
  void cleanup() {
    engine.cleanupAll();
  }

  @Scheduled(fixedDelay = 60000, initialDelay = 20000)
  void cleanupExports() {
    try {
      int cleaned = warehouse.cleanupExpiredExports();
      if (cleaned > 0)
        org.slf4j.LoggerFactory.getLogger(RunLoop.class)
            .info("Expired export contents removed: {}", cleaned);
    } catch (Exception e) {
      org.slf4j.LoggerFactory.getLogger(RunLoop.class)
          .warn("Export cleanup failed ({})", e.getClass().getSimpleName());
    }
  }
}
