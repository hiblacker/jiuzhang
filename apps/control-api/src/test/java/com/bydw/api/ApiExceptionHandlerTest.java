package com.bydw.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * An unmapped path must read as a routing mistake, not as a server fault. The
 * integration effect is checked against a running stack; here the mapping from
 * Spring's NoResourceFoundException to the response is pinned without a context.
 */
class ApiExceptionHandlerTest {
  private final ApiExceptionHandler handler = new ApiExceptionHandler();

  @Test
  void unmappedPathReturnsNotFoundInsteadOfServerError() {
    var request = new MockHttpServletRequest("GET", "/api/v1/warehouse/projects/2/runs");
    request.setAttribute(RequestAuthenticationFilter.REQUEST_ID_ATTRIBUTE, "synthetic-request-id");

    var response = handler.notFound(request);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(response.getBody()).isNotNull();
    assertThat(response.getBody().code()).isEqualTo("NOT_FOUND");
    assertThat(response.getBody().requestId()).isEqualTo("synthetic-request-id");
  }

  @Test
  void notFoundKeepsMissingRequestIdExplicit() {
    var response = handler.notFound(new MockHttpServletRequest("GET", "/api/v1/unknown"));

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(response.getBody()).isNotNull();
    assertThat(response.getBody().requestId()).isEqualTo("unavailable");
  }
}
