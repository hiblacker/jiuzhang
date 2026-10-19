package cn.jiuzhang.api;

import cn.jiuzhang.platform.shared.application.Failure;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(Failure.class) ResponseEntity<?> failure(Failure error,HttpServletRequest request) { return response(error.status,error.code,request); }
    @ExceptionHandler(DuplicateKeyException.class) ResponseEntity<?> duplicate(HttpServletRequest request) { return response(409,"DUPLICATE_NAME",request); }
    @ExceptionHandler({HttpMessageNotReadableException.class, org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class})
    ResponseEntity<?> malformed(HttpServletRequest request) { return response(422,"VALIDATION_ERROR",request); }
    @ExceptionHandler(NoResourceFoundException.class) ResponseEntity<?> missing(HttpServletRequest request) { return response(501,"NOT_IMPLEMENTED",request); }
    @ExceptionHandler(Exception.class) ResponseEntity<?> internal(Exception error,HttpServletRequest request) {
        org.slf4j.LoggerFactory.getLogger(ApiErrors.class).error("Request {} failed: {}",HttpSupport.requestId(request),error.getClass().getSimpleName());
        return response(500,"INTERNAL_ERROR",request);
    }
    private ResponseEntity<?> response(int status,String code,HttpServletRequest request) {
        return ResponseEntity.status(status).body(HttpSupport.error(code,HttpSupport.requestId(request)));
    }
}
