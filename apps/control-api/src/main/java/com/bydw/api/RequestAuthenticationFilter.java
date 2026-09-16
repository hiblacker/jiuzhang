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
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import com.bydw.warehouse.ProductAccessService;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(-90) // Runs after Spring Security has restored the browser session.
public class RequestAuthenticationFilter extends OncePerRequestFilter {
  public static final String REQUEST_ID_ATTRIBUTE = "bydw.requestId";
  public static final String PRINCIPAL_ATTRIBUTE = "bydw.principal";
  private static final String ADMIN_PRINCIPAL = "local-admin";
  private static final String WORKER_PRINCIPAL = "local-worker";
  private static final String WORKER_INSTANCE_HEADER = "X-Worker-Instance";
  private static final Pattern BATCH_START = Pattern.compile(
      "^/api/v1/ingestion-jobs/[^/]+/batches/?$");
  private static final Pattern BATCH_MUTATION = Pattern.compile(
      "^/api/v1/ingestion-batches/[^/]+/(?:complete|fail|retry|cancel|heartbeat)/?$");
  private static final Pattern CHECKPOINT_READ = Pattern.compile(
      "^/api/v1/ingestion-jobs/[^/]+/checkpoint/?$");
  private static final Pattern JOB_READ = Pattern.compile(
      "^/api/v1/ingestion-jobs/[^/]+/?$");
  private static final Pattern LAKE_MANIFEST_WRITE = Pattern.compile(
      "^/api/v1/lake/manifests/?$");
  private static final Pattern LAKE_EXECUTION_WORKER = Pattern.compile(
      "^/api/v1/lake/executions/(?:claim|[0-9]+/(?:heartbeat|finish))/?$");
  private static final Pattern MODEL_EXECUTION_WORKER = Pattern.compile(
      "^/api/v1/warehouse/builds/(?:claim|[0-9]+/(?:heartbeat|finish))/?$");
  private static final Pattern WORKER_INSTANCE = Pattern.compile(
      "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$");

  private final byte[] adminToken;
  private final byte[] workerToken;
  private final ObjectMapper objectMapper;
  @Autowired(required = false)
  private ProductAccessService productAccess;
  @Autowired(required = false)
  private BrowserAccountService browserAccounts;

  public RequestAuthenticationFilter(
      @Value("${bydw.security.admin-token}") String configuredAdminToken,
      @Value("${bydw.security.worker-token}") String configuredWorkerToken,
      ObjectMapper objectMapper) {
    if (configuredAdminToken == null || configuredAdminToken.length() < 24
        || configuredWorkerToken == null || configuredWorkerToken.length() < 24) {
      throw new IllegalArgumentException("Admin and worker tokens must each contain at least 24 characters");
    }
    if (MessageDigest.isEqual(configuredAdminToken.getBytes(StandardCharsets.UTF_8),
        configuredWorkerToken.getBytes(StandardCharsets.UTF_8))) {
      throw new IllegalArgumentException("Admin and worker tokens must be different");
    }
    this.adminToken = configuredAdminToken.getBytes(StandardCharsets.UTF_8);
    this.workerToken = configuredWorkerToken.getBytes(StandardCharsets.UTF_8);
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

    // CORS preflight carries no application credentials; Web MVC applies the
    // explicit origin allowlist before the actual request is dispatched.
    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
      filterChain.doFilter(request, response);
      return;
    }

    if (isPublicPath(request.getRequestURI())) {
      filterChain.doFilter(request, response);
      return;
    }

    String authorization = request.getHeader("Authorization");
    byte[] supplied = authorization != null && authorization.startsWith("Bearer ")
        ? authorization.substring(7).getBytes(StandardCharsets.UTF_8)
        : new byte[0];
    Access access = accessFor(request.getMethod(), request.getRequestURI());
    boolean admin = MessageDigest.isEqual(adminToken, supplied);
    boolean worker = MessageDigest.isEqual(workerToken, supplied);
    String browserActor = null;
    if (authorization == null && browserAccounts != null) {
      var authentication = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
      if (authentication != null && authentication.isAuthenticated()) browserActor = browserAccounts.sessionActor(authentication.getPrincipal());
      if ("local-admin".equals(browserActor)) admin = true;
    }
    String projectIdentity = null;
    if (!admin && !worker && access != Access.WORKER && productAccess != null && request.getRequestURI().startsWith("/api/v1/warehouse/")) {
      projectIdentity = productAccess.authenticate(new String(supplied, StandardCharsets.UTF_8));
    }
    if (!admin && browserActor != null && access != Access.WORKER && request.getRequestURI().startsWith("/api/v1/warehouse/")) projectIdentity = browserActor;
    boolean accepted = access == Access.ADMIN ? admin
        : access == Access.WORKER ? worker : admin || worker;
    accepted = accepted || projectIdentity != null;
    if (!accepted) {
      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      objectMapper.writeValue(response.getOutputStream(),
          new ApiError("UNAUTHORIZED", "Valid bearer token required", requestId));
      return;
    }

    if (worker) {
      String instance = request.getHeader(WORKER_INSTANCE_HEADER);
      if (instance != null && !instance.isBlank()) {
        if (!WORKER_INSTANCE.matcher(instance).matches()) {
          response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
          response.setContentType(MediaType.APPLICATION_JSON_VALUE);
          objectMapper.writeValue(response.getOutputStream(),
              new ApiError("INVALID_WORKER_INSTANCE",
                  "X-Worker-Instance must be a stable bounded identifier", requestId));
          return;
        }
        request.setAttribute(PRINCIPAL_ATTRIBUTE, instance);
      } else {
        request.setAttribute(PRINCIPAL_ATTRIBUTE, WORKER_PRINCIPAL);
      }
    } else if (projectIdentity != null) {
      request.setAttribute(PRINCIPAL_ATTRIBUTE, projectIdentity);
    } else {
      request.setAttribute(PRINCIPAL_ATTRIBUTE, ADMIN_PRINCIPAL);
    }
    filterChain.doFilter(request, response);
  }

  private Access accessFor(String method, String path) {
    if ("POST".equals(method) && (BATCH_START.matcher(path).matches()
        || BATCH_MUTATION.matcher(path).matches())) return Access.WORKER;
    if ("POST".equals(method) && LAKE_MANIFEST_WRITE.matcher(path).matches()) return Access.WORKER;
    if ("POST".equals(method) && LAKE_EXECUTION_WORKER.matcher(path).matches()) return Access.WORKER;
    if ("POST".equals(method) && MODEL_EXECUTION_WORKER.matcher(path).matches()) return Access.WORKER;
    if ("GET".equals(method) && (CHECKPOINT_READ.matcher(path).matches()
        || JOB_READ.matcher(path).matches())) return Access.EITHER;
    return Access.ADMIN;
  }

  private boolean isPublicPath(String path) {
    return path.equals("/api/v1/status") || path.equals("/actuator/health")
        || path.startsWith("/actuator/health/") || path.equals("/api/v1/auth/csrf")
        || path.equals("/api/v1/auth/activate")
        || (!path.startsWith("/api/") && !path.startsWith("/actuator/"));
  }

  private enum Access { ADMIN, WORKER, EITHER }
}
