package cn.jiuzhang.platform.overview.infrastructure;

import cn.jiuzhang.platform.overview.application.OverviewStore;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcOverviewStore implements OverviewStore {
    private final JdbcTemplate db;

    public JdbcOverviewStore(JdbcTemplate db) { this.db = db; }

    public Map<String, Object> snapshot(boolean includeAudit) {
        var result = new LinkedHashMap<String, Object>();
        result.put("sourceCount", count("SELECT count(*) FROM source_connection"));
        result.put("datasetCount", count("SELECT count(*) FROM dataset"));
        result.put("publishedCount", count("SELECT count(*) FROM dataset WHERE published_version > 0"));
        result.put("runCount", count("SELECT count(*) FROM dataset_run"));
        result.put("successCount", count("SELECT count(*) FROM dataset_run WHERE status='succeeded'"));
        result.put("blockedCount", count("SELECT count(*) FROM dataset_run WHERE status='blocked'"));
        result.put("tableCount", count("SELECT count(*) FROM warehouse_target"));
        result.put("rows", db.queryForObject("SELECT coalesce(sum(s.row_count),0)::text FROM warehouse_target t JOIN warehouse_snapshot s ON s.run_id=t.current_run_id", String.class));
        result.put("attentionCounts", Map.of(
            "draftDatasets", count("SELECT count(*) FROM dataset WHERE status='draft'"),
            "warningSources", count("SELECT count(*) FROM source_connection WHERE status='warning'"),
            "offlineSources", count("SELECT count(*) FROM source_connection WHERE status='offline'")));
        result.put("recentRuns", db.queryForList("SELECT id::text FROM dataset_run ORDER BY started_at DESC,id DESC LIMIT 5", String.class));
        result.put("recentFailures", db.queryForList("SELECT id::text FROM dataset_run WHERE status IN ('failed','blocked') ORDER BY started_at DESC,id DESC LIMIT 5", String.class));
        result.put("trend", db.queryForList("""
            SELECT to_char(day,'MM-DD') AS date,
                count(r.id) FILTER (WHERE r.status='succeeded') AS succeeded,
                count(r.id) FILTER (WHERE r.status IN ('failed','blocked')) AS failed
            FROM generate_series((now() AT TIME ZONE 'Asia/Shanghai')::date - 6,
                (now() AT TIME ZONE 'Asia/Shanghai')::date,interval '1 day') day
            LEFT JOIN dataset_run r ON (r.started_at AT TIME ZONE 'Asia/Shanghai')::date=day::date
            GROUP BY day ORDER BY day
            """));
        result.put("layerCounts", db.queryForList("""
            SELECT layer,count(t.dataset_id) AS tables FROM unnest(ARRAY['ODS','DWD','DWS','ADS']) AS layer
            LEFT JOIN warehouse_target t ON EXISTS (
                SELECT 1 FROM dataset_run r JOIN dataset_version v ON v.dataset_id=r.dataset_id AND v.version=r.dataset_version
                WHERE r.id=t.current_run_id AND v.body->'definition'->'output'->>'layer'=layer)
            GROUP BY layer ORDER BY array_position(ARRAY['ODS','DWD','DWS','ADS'],layer)
            """));
        result.put("recentAudit", includeAudit ? db.queryForList("""
            SELECT e.id::text AS id,coalesce(a.display_name,'system') AS actor,e.action,
                e.resource_type AS resource,e.resource_id AS "resourceId",
                e.created_at AS at,e.action || ' · ' || e.resource_type || ' #' || e.resource_id AS detail
            FROM audit_event e LEFT JOIN account a ON e.actor_id=a.id ORDER BY e.id DESC LIMIT 5
            """) : List.of());
        return result;
    }

    private long count(String sql) { return db.queryForObject(sql, Long.class); }
}
