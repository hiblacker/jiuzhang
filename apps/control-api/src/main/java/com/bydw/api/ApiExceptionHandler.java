package com.bydw.api;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);

  @ExceptionHandler(ApiException.class)
  ResponseEntity<ApiError> api(ApiException exception, HttpServletRequest request) {
    return error(exception.status(), exception.code(), exception.getMessage(), request);
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<ApiError> malformed(HttpServletRequest request) {
    return error(HttpStatus.BAD_REQUEST, "MALFORMED_JSON", "Request body is not valid JSON", request);
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  ResponseEntity<ApiError> invalidParameter(HttpServletRequest request) {
    return error(HttpStatus.BAD_REQUEST, "INVALID_PARAMETER", "Request parameter has an invalid type", request);
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<ApiError> unexpected(Exception exception, HttpServletRequest request) {
    Object value = request.getAttribute(RequestAuthenticationFilter.REQUEST_ID_ATTRIBUTE);
    LOG.error("Request failed: requestId={}, exceptionType={}", value, exception.getClass().getName());
    return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Request could not be completed", request);
  }

  private ResponseEntity<ApiError> error(
      HttpStatus status, String code, String message, HttpServletRequest request) {
    Object value = request.getAttribute(RequestAuthenticationFilter.REQUEST_ID_ATTRIBUTE);
    String requestId = value instanceof String id ? id : "unavailable";
    return ResponseEntity.status(status).body(new ApiError(code, message, requestId));
  }
}
