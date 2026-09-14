package com.bydw.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RequestAuthenticationFilterTest {
  private static final String ADMIN_TOKEN = "synthetic-admin-token-123456";
  private static final String WORKER_TOKEN = "synthetic-worker-token-12345";

  @Test
  void rejectsMissingTokenWithoutInvokingApplication() throws Exception {
    var filter = filter();
    var request = new MockHttpServletRequest("GET", "/api/v1/sources");
    var response = new MockHttpServletResponse();
    var invoked = new AtomicBoolean(false);

    FilterChain chain = (req, res) -> invoked.set(true);
    filter.doFilter(request, response, chain);

    assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
    assertThat(response.getContentAsString()).contains("UNAUTHORIZED").doesNotContain(ADMIN_TOKEN);
    assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
    assertThat(invoked).isFalse();
  }

  @Test
  void acceptsExactBearerTokenAndSetsTrustedPrincipal() throws Exception {
    var filter = filter();
    var request = new MockHttpServletRequest("GET", "/api/v1/sources");
    request.addHeader("Authorization", "Bearer " + ADMIN_TOKEN);
    var response = new MockHttpServletResponse();
    var invoked = new AtomicBoolean(false);

    FilterChain chain = (req, res) -> invoked.set(true);
    filter.doFilter(request, response, chain);

    assertThat(invoked).isTrue();
    assertThat(request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE))
        .isEqualTo("local-admin");
    assertThat(response.getHeader("X-Request-Id")).isNotBlank();
  }

  @Test
  void leavesHealthEndpointPublic() throws Exception {
    var filter = filter();
    var request = new MockHttpServletRequest("GET", "/actuator/health");
    var invoked = new AtomicBoolean(false);

    FilterChain chain = (req, res) -> invoked.set(true);
    filter.doFilter(request, new MockHttpServletResponse(), chain);

    assertThat(invoked).isTrue();
  }

  @Test
  void refusesWeakConfiguredToken() {
    org.assertj.core.api.Assertions.assertThatThrownBy(
        () -> new RequestAuthenticationFilter("too-short", WORKER_TOKEN, new ObjectMapper()))
        .isInstanceOf(IllegalArgumentException.class);
    org.assertj.core.api.Assertions.assertThatThrownBy(
        () -> new RequestAuthenticationFilter(ADMIN_TOKEN, ADMIN_TOKEN, new ObjectMapper()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void workerCanMutateBatchesButAdminCannot() throws Exception {
    var filter = filter();
    var workerRequest = new MockHttpServletRequest("POST", "/api/v1/ingestion-batches/7/complete");
    workerRequest.addHeader("Authorization", "Bearer " + WORKER_TOKEN);
    var workerResponse = new MockHttpServletResponse();
    var workerInvoked = new AtomicBoolean(false);
    filter.doFilter(workerRequest, workerResponse, (req, res) -> workerInvoked.set(true));

    assertThat(workerInvoked).isTrue();
    assertThat(workerRequest.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE))
        .isEqualTo("local-worker");

    var adminRequest = new MockHttpServletRequest("POST", "/api/v1/ingestion-jobs/0007/batches");
    adminRequest.addHeader("Authorization", "Bearer " + ADMIN_TOKEN);
    var adminResponse = new MockHttpServletResponse();
    var adminInvoked = new AtomicBoolean(false);
    filter.doFilter(adminRequest, adminResponse, (req, res) -> adminInvoked.set(true));

    assertThat(adminInvoked).isFalse();
    assertThat(adminResponse.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
  }

  @Test
  void workerCannotUseAdminApiButCanReadCheckpoint() throws Exception {
    var filter = filter();
    var sourceRequest = new MockHttpServletRequest("GET", "/api/v1/sources");
    sourceRequest.addHeader("Authorization", "Bearer " + WORKER_TOKEN);
    var sourceResponse = new MockHttpServletResponse();
    var sourceInvoked = new AtomicBoolean(false);
    filter.doFilter(sourceRequest, sourceResponse, (req, res) -> sourceInvoked.set(true));
    assertThat(sourceInvoked).isFalse();
    assertThat(sourceResponse.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);

    var checkpointRequest = new MockHttpServletRequest(
        "GET", "/api/v1/ingestion-jobs/7/checkpoint");
    checkpointRequest.addHeader("Authorization", "Bearer " + WORKER_TOKEN);
    var checkpointInvoked = new AtomicBoolean(false);
    filter.doFilter(checkpointRequest, new MockHttpServletResponse(),
        (req, res) -> checkpointInvoked.set(true));
    assertThat(checkpointInvoked).isTrue();
  }

  private RequestAuthenticationFilter filter() {
    return new RequestAuthenticationFilter(ADMIN_TOKEN, WORKER_TOKEN, new ObjectMapper());
  }
}
