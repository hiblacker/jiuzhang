package cn.jiuzhang.worker;
import cn.jiuzhang.platform.execution.application.ExecutionEngine;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
@Component
public class RunLoop{
 private final ExecutionEngine engine;public RunLoop(ExecutionEngine engine){this.engine=engine;}
 @Scheduled(fixedDelay=500) void run(){try{engine.next();}catch(Exception e){org.slf4j.LoggerFactory.getLogger(RunLoop.class).warn("Worker poll failed ({})",e.getClass().getSimpleName());}}
 @Scheduled(fixedDelay=60000,initialDelay=15000) void cleanup(){engine.cleanupAll();}
}
