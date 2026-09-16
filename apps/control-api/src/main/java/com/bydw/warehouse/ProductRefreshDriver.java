package com.bydw.warehouse;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
@Component
@ConditionalOnProperty(name="bydw.lake.calendar-driver",havingValue="local")
public class ProductRefreshDriver {
  private static final Logger LOG=LoggerFactory.getLogger(ProductRefreshDriver.class);
  private final DatasetRefreshService refresh;
  public ProductRefreshDriver(DatasetRefreshService refresh){this.refresh=refresh;}
  @Scheduled(fixedDelayString="${bydw.lake.calendar-interval-ms:10000}")
  public void tick(){try{refresh.reconcileAll(Instant.now());}catch(Exception e){LOG.error("Dataset refresh reconciliation failed: {}",e.getClass().getSimpleName());}}
}
