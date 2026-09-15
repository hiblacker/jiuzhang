package com.bydw.lake;

import com.bydw.api.ApiException;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only control-plane queries for the lake ledger and run overview. */
@RestController
@RequestMapping("/api/v1/lake")
public class LakeController {
  private static final Pattern SOURCE_CODE = Pattern.compile("^[a-z][a-z0-9._-]{1,99}$");
  private final JdbcTemplate jdbc;

  public LakeController(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  @GetMapping("/summary")
  public Map<String, Object> summary(@RequestParam(required = false) String sourceCode) {
    String code = validateSourceCode(sourceCode);
    Map<String, Object> runs = jdbc.queryForMap("""
        SELECT count(*) AS run_count,
               count(*) FILTER (WHERE sr.state = 'COMPLETE') AS complete_count,
               count(*) FILTER (WHERE sr.state IN ('FAILED', 'INCOMPLETE')) AS failed_count,
               count(*) FILTER (WHERE sr.state = 'RUNNING') AS running_count
          FROM lake.system_run sr
          JOIN control.source_connection sc ON sc.id = sr.source_id
         WHERE (CAST(? AS VARCHAR) IS NULL OR sc.code = ?)
        """, code, code);
    Map<String, Object> objects = jdbc.queryForMap("""
        SELECT count(*) AS object_count,
               coalesce(sum(orun.row_count), 0) AS row_count,
               count(*) FILTER (WHERE orun.state = 'RAW_COMMITTED') AS raw_committed_count,
               count(*) FILTER (WHERE orun.state = 'FAILED') AS failed_object_count
          FROM lake.object_run orun
          JOIN lake.system_run sr ON sr.id = orun.system_run_id
          JOIN control.source_connection sc ON sc.id = sr.source_id
         WHERE (CAST(? AS VARCHAR) IS NULL OR sc.code = ?)
        """, code, code);
    Map<String, Object> response = new LinkedHashMap<>();
    response.put("sourceCode", code);
    response.put("runs", runs);
    response.put("objects", objects);
    return response;
  }

  @GetMapping("/runs")
  public List<Map<String, Object>> runs(
      @RequestParam(required = false) String sourceCode,
      @RequestParam(defaultValue = "50") int limit) {
    String code = validateSourceCode(sourceCode);
    if (limit < 1 || limit > 200) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LIMIT", "limit must be between 1 and 200");
    }
    return jdbc.queryForList("""
        SELECT sr.id, sc.code AS source_code, sr.plan_version, sr.run_key,
               sr.mode, sr.attempt, sr.revision, sr.state,
               sr.scheduled_window_start, sr.scheduled_window_end,
               sr.started_at, sr.finished_at, sr.error_code
          FROM lake.system_run sr
          JOIN control.source_connection sc ON sc.id = sr.source_id
         WHERE (CAST(? AS VARCHAR) IS NULL OR sc.code = ?)
         ORDER BY sr.id DESC
         LIMIT ?
        """, code, code, limit);
  }

  @GetMapping("/deliveries")
  public List<Map<String, Object>> deliveries(
      @RequestParam(required = false) String sourceCode,
      @RequestParam(defaultValue = "50") int limit) {
    String code = validateSourceCode(sourceCode);
    if (limit < 1 || limit > 200) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LIMIT", "limit must be between 1 and 200");
    }
    return jdbc.queryForList("""
        SELECT dl.id, sc.code AS source_code, dl.scheduled_window_start,
               dl.scheduled_window_end, dl.delivery_kind,
               dl.expected_state, dl.observed_state, dl.received_at,
               dl.actual_data_at, dl.run_id, dl.details
          FROM lake.delivery_ledger dl
          JOIN control.source_connection sc ON sc.id = dl.source_id
         WHERE (? IS NULL OR sc.code = ?)
         ORDER BY dl.scheduled_window_start DESC, dl.id DESC
         LIMIT ?
        """, code, code, limit);
  }

  private String validateSourceCode(String sourceCode) {
    if (sourceCode == null || sourceCode.isBlank()) return null;
    if (!SOURCE_CODE.matcher(sourceCode).matches()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SOURCE_CODE", "sourceCode has an invalid format");
    }
    return sourceCode;
  }
}
