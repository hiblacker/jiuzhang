package com.bydw.api;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Optional, explicit CORS for the separately served local read-only console. */
@Configuration
public class WebCorsConfiguration implements WebMvcConfigurer {
  private final List<String> allowedOrigins;

  public WebCorsConfiguration(
      @Value("${bydw.web.allowed-origins:}") String configuredOrigins) {
    this.allowedOrigins = parseOrigins(configuredOrigins);
  }

  static List<String> parseOrigins(String configuredOrigins) {
    if (configuredOrigins == null || configuredOrigins.isBlank()) return List.of();
    return Arrays.stream(configuredOrigins.split(","))
        .map(String::trim)
        .filter(value -> !value.isEmpty())
        .peek(WebCorsConfiguration::validateOrigin)
        .distinct()
        .toList();
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    if (allowedOrigins.isEmpty()) return;
    registry.addMapping("/api/**")
        .allowedOrigins(allowedOrigins.toArray(String[]::new))
        .allowedMethods("GET", "POST", "OPTIONS")
        .allowedHeaders("Authorization", "Content-Type", "X-Worker-Instance")
        .exposedHeaders("X-Request-Id")
        .allowCredentials(false)
        .maxAge(600);
  }

  private static void validateOrigin(String value) {
    if (value.contains("*") || value.contains(" ")) {
      throw new IllegalArgumentException("CORS origins must be explicit origins");
    }
    try {
      URI uri = new URI(value);
      if (!("http".equalsIgnoreCase(uri.getScheme())
          || "https".equalsIgnoreCase(uri.getScheme()))
          || uri.getRawAuthority() == null
          || uri.getRawAuthority().isBlank()
          || uri.getRawUserInfo() != null
          || uri.getRawPath() != null && !uri.getRawPath().isEmpty()
          || uri.getRawQuery() != null
          || uri.getRawFragment() != null) {
        throw new IllegalArgumentException("CORS origins must contain scheme and authority only");
      }
    } catch (URISyntaxException exception) {
      throw new IllegalArgumentException("CORS origin is invalid", exception);
    }
  }
}
