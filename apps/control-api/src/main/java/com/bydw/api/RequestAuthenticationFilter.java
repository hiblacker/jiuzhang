package com.bydw.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestAuthenticationFilter extends OncePerRequestFilter {
  public static final String REQUEST_ID_ATTRIBUTE = "bydw.requestId";
  public static final String PRINCIPAL_ATTRIBUTE = "bydw.principal";
  private static final String PRINCIPAL = "local-admin";

  private final byte[] expectedToken;
  private final ObjectMapper objectMapper;

  public RequestAuthenticationFilter(
      @Value("${bydw.security.admin-token}") String adminToken, ObjectMapper objectMapper) {
    if (adminToken == null || adminToken.length() < 24) {
      throw new IllegalArgumentException("CONTROL_API_ADMIN_TOKEN must contain at least 24 characters");
    }
    this.expectedToken = adminToken.getBytes(StandardCharsets.UTF_8);
    this.objectMapper = objectMapper;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String requestId = UUID.randomUUID().toString();
    request.setAttribute(REQUEST_ID_ATTRIBUTE, requestId);
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Cache-Control", "no-store");

    if (isPublicPath(request.getRequestURI())) {
      filterChain.doFilter(request, response);
      return;
    }

    String authorization = request.getHeader("Authorization");
    byte[] supplied = authorization != null && authorization.startsWith("Bearer ")
        ? authorization.substring(7).getBytes(StandardCharsets.UTF_8)
        : new byte[0];
    if (!MessageDigest.isEqual(expectedToken, supplied)) {
      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      objectMapper.writeValue(response.getOutputStream(),
          new ApiError("UNAUTHORIZED", "Valid bearer token required", requestId));
      return;
    }

    request.setAttribute(PRINCIPAL_ATTRIBUTE, PRINCIPAL);
    filterChain.doFilter(request, response);
  }

  private boolean isPublicPath(String path) {
    return path.equals("/api/v1/status") || path.equals("/actuator/health")
        || path.startsWith("/actuator/health/");
  }
}
