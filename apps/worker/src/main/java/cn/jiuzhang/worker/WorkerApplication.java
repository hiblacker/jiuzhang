package cn.jiuzhang.worker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication(scanBasePackages = "cn.jiuzhang")
public class WorkerApplication {
    public static void main(String[] args) { SpringApplication.run(WorkerApplication.class, args); }
}
