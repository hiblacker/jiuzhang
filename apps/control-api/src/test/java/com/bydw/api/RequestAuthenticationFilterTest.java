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
  private static final String TOKEN = "synthetic-admin-token-123456";

  @Test
  void rejectsMissingTokenWithoutInvokingApplication() throws Exception {
    var filter = new RequestAuthenticationFilter(TOKEN, new ObjectMapper());
    var request = new MockHttpServletRequest("GET", "/api/v1/sources");
    var response = new MockHttpServletResponse();
    var invoked = new AtomicBoolean(false);

    FilterChain chain = (req, res) -> invoked.set(true);
    filter.doFilter(request, response, chain);

    assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
    assertThat(response.getContentAsString()).contains("UNAUTHORIZED").doesNotContain(TOKEN);
    assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
    assertThat(invoked).isFalse();
  }

  @Test
  void acceptsExactBearerTokenAndSetsTrustedPrincipal() throws Exception {
    var filter = new RequestAuthenticationFilter(TOKEN, new ObjectMapper());
    var request = new MockHttpServletRequest("GET", "/api/v1/sources");
    request.addHeader("Authorization", "Bearer " + TOKEN);
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
    var filter = new RequestAuthenticationFilter(TOKEN, new ObjectMapper());
    var request = new MockHttpServletRequest("GET", "/actuator/health");
    var invoked = new AtomicBoolean(false);

    FilterChain chain = (req, res) -> invoked.set(true);
    filter.doFilter(request, new MockHttpServletResponse(), chain);

    assertThat(invoked).isTrue();
  }

  @Test
  void refusesWeakConfiguredToken() {
    org.assertj.core.api.Assertions.assertThatThrownBy(
        () -> new RequestAuthenticationFilter("too-short", new ObjectMapper()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
