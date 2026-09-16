package com.bydw.lake;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.LocalTime;

/** Runtime references resolve only in the worker's administrator-owned registry. */
public record LakePlanRequest(String sourceCode, int expectedVersion, Long inventoryVersion,
    String kind, String runtimeRef, JsonNode contract, String timezone, LocalTime triggerTime,
    LocalDate startDate, boolean historicalRead, int maxAttempts, int timeoutSeconds) {}
