package com.bydw.worker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class WorkerApplication {
  public static void main(String[] args) {
    System.exit(SpringApplication.exit(SpringApplication.run(WorkerApplication.class, args)));
  }
}
