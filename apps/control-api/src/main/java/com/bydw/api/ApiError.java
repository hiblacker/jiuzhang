package com.bydw.api;

public record ApiError(String code, String message, String requestId) {}
