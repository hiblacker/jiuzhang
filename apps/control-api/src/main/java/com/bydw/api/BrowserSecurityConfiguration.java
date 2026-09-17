package com.bydw.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

/** Spring owns password verification, session fixation protection, logout and CSRF. */
@Configuration
public class BrowserSecurityConfiguration {
  @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }

  @Bean SecurityFilterChain browserSecurity(HttpSecurity http, BrowserAccountService accounts,
      PasswordEncoder encoder, ObjectMapper json) throws Exception {
    var provider = new DaoAuthenticationProvider(accounts);
    provider.setPasswordEncoder(encoder);
    http.authenticationProvider(provider)
        .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
        .csrf(csrf -> csrf.ignoringRequestMatchers(request -> {
          String header = request.getHeader("Authorization");
          // The application filter never falls back to cookies when this header exists.
          return !request.getRequestURI().startsWith("/api/v1/auth/")
              && header != null && header.startsWith("Bearer ");
        }))
        .requestCache(cache -> cache.disable())
        .formLogin(form -> form.loginProcessingUrl("/api/v1/auth/login")
            .successHandler((request, response, authentication) -> {
              accounts.loginSucceeded(authentication.getName());
              response.setContentType("application/json");
              json.writeValue(response.getOutputStream(), Map.of("authenticated", true));
            })
            .failureHandler((request, response, failure) -> {
              accounts.loginFailed(request.getParameter("username"));
              response.setStatus(401); response.setContentType("application/json");
              json.writeValue(response.getOutputStream(), Map.of("code", "LOGIN_FAILED", "message", "账号或密码不正确，或账号暂不可用"));
            }))
        .logout(logout -> logout.logoutUrl("/api/v1/auth/logout")
            .logoutSuccessHandler((request, response, authentication) -> response.setStatus(204)))
        .exceptionHandling(errors -> errors.accessDeniedHandler((request, response, failure) -> {
          response.setStatus(403); response.setContentType("application/json");
          json.writeValue(response.getOutputStream(), Map.of("code", "CSRF_REQUIRED", "message", "会话已变化，请刷新后重试"));
        }));
    return http.build();
  }
}
