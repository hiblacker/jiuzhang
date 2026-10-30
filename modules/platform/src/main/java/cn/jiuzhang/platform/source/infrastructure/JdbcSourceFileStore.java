package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.application.SourceFileStore;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcSourceFileStore implements SourceFileStore {
  private final JdbcTemplate db;
  public JdbcSourceFileStore(JdbcTemplate db) { this.db = db; }
  public File create(String owner, String name, String key, long size) {
    return get(db.queryForObject("INSERT INTO source_file(owner_id,file_name,object_key,byte_size) VALUES (?,?,?,?) RETURNING id",
        Long.class, IdentityService.numericId(owner), name, key, size).toString());
  }
  public File get(String id) {
    var rows = db.queryForList("SELECT * FROM source_file WHERE id=?", IdentityService.numericId(id));
    if (rows.isEmpty()) throw new Failure(404, "SOURCE_FILE_NOT_FOUND");
    return file(rows.getFirst());
  }
  public List<File> unused() {
    return db.queryForList("SELECT f.* FROM source_file f WHERE created_at<now()-interval '24 hours'"
        + " AND NOT EXISTS (SELECT 1 FROM source_connection s WHERE s.file_id=f.id)"
        + " AND NOT EXISTS (SELECT 1 FROM dataset_version v WHERE v.source_file_id=f.id) LIMIT 20")
        .stream().map(this::file).toList();
  }
  public boolean referenced(String id) {
    long value=IdentityService.numericId(id);
    return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS (SELECT 1 FROM source_connection WHERE file_id=?) OR EXISTS (SELECT 1 FROM dataset_version WHERE source_file_id=?)",Boolean.class,value,value));
  }
  public boolean deleteUnused(String id) {
    return db.update("WITH removed AS (DELETE FROM source_file f WHERE id=? AND NOT EXISTS (SELECT 1 FROM source_connection s WHERE s.file_id=f.id)"
        + " AND NOT EXISTS (SELECT 1 FROM dataset_version v WHERE v.source_file_id=f.id) RETURNING object_key)"
        + " INSERT INTO source_file_cleanup(object_key) SELECT object_key FROM removed ON CONFLICT DO NOTHING", IdentityService.numericId(id)) == 1;
  }
  public List<String> pendingDeletes() { return db.queryForList("SELECT object_key FROM source_file_cleanup ORDER BY created_at LIMIT 20",String.class); }
  public void deleted(String key) { db.update("DELETE FROM source_file_cleanup WHERE object_key=?",key); }
  private File file(Map<String, Object> row) {
    return new File(row.get("id").toString(), row.get("owner_id").toString(), row.get("file_name").toString(),
        row.get("object_key").toString(), ((Number) row.get("byte_size")).longValue());
  }
}
