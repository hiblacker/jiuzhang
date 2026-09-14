package com.bydw.batch;

public record FailBatchRequest(String errorCode, String diagnosticRef) {}
