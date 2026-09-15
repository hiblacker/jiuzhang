package com.bydw.worker;

class WorkerFailedException extends RuntimeException {
  private final String errorCode;

  WorkerFailedException(String errorCode, String message) {
    super(message);
    this.errorCode = errorCode;
  }

  WorkerFailedException(String errorCode, String message, Throwable cause) {
    super(message, cause);
    this.errorCode = errorCode;
  }

  String errorCode() {
    return errorCode;
  }
}
