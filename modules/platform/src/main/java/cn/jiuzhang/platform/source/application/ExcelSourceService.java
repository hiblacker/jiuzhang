package cn.jiuzhang.platform.source.application;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.application.JsonWriter;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class ExcelSourceService {
  private final SourceFileStore files;
  private final SourceFileContent content;
  private final ExcelReader reader;
  private final IdentityService identity;
  private final JsonWriter json;
  public ExcelSourceService(SourceFileStore files, SourceFileContent content, ExcelReader reader, IdentityService identity, JsonWriter json) {
    this.files = files; this.content = content; this.reader = reader; this.identity = identity; this.json = json;
  }
  public Map<String,Object> upload(User user, String name, byte[] bytes, String requestId) {
    IdentityService.require(user, "write");
    if (name == null || name.length() > 255 || name.contains("/") || name.contains("\\")
        || !name.toLowerCase(Locale.ROOT).matches(".+\\.xlsx?"))
      throw new Failure(422, "EXCEL_FILE_INVALID");
    if (bytes.length == 0 || bytes.length > 20971520) throw new Failure(422, "EXCEL_LIMIT");
    var sheets = reader.sheets(bytes);
    String key = "source-files/" + UUID.randomUUID();
    // Record ownership before upload, so even a partial/failed upload can be reclaimed later.
    var file = files.create(user.id(), name, key, bytes.length);
    content.putFile(key, bytes);
    identity.audit(user.id(), "upload", "sourceFile", file.id(), requestId);
    return Map.of("id", file.id(), "fileName", file.name(), "size", Long.toString(file.size()), "sheets", sheets);
  }
  public void validate(User user, Map<String,Object> settings, SourceStore.Source previous) {
    if (!(settings.get("fileId") instanceof String id) || !id.matches("[0-9]+")
        || !(settings.get("sheet") instanceof String sheet) || sheet.isBlank()
        || !(settings.get("headerRow") instanceof Number row) || row.doubleValue() != row.intValue()
        || row.intValue() < 1 || row.intValue() > 1000)
      throw new Failure(422, "EXCEL_SETTINGS_INVALID");
    var file = files.get(id);
    boolean same = previous != null && id.equals(previous.settings().get("fileId"));
    if (!same) own(user, file);
    table(settings);
    settings.put("fileName", file.name());
  }
  public Map<String,Object> preview(User user, String id, String sheet, int headerRow) {
    IdentityService.require(user, "readSensitive");
    own(user, files.get(id));
    var table = table(Map.of("fileId", id, "sheet", sheet, "headerRow", headerRow));
    var rows=table.rows().stream().limit(100).toList();
    if(json.write(rows).getBytes(java.nio.charset.StandardCharsets.UTF_8).length>10*1024*1024)
      throw new Failure(422,"QUERY_RESULT_LIMIT");
    return Map.of("fields", table.columns().stream().map(SourceService::field).toList(),
        "rows", rows, "notes", List.of("EXCEL_CACHED_VALUES", "SOURCE_SAMPLE_LIMIT_100"));
  }
  public Map<String,Object> info(User user,String id) {
    IdentityService.require(user,"write");
    var file=files.get(id);
    // Saved source/version schemas follow the existing shared-workspace read model.
    if(!files.referenced(id))own(user,file);
    return Map.of("id",file.id(),"fileName",file.name(),"size",Long.toString(file.size()),"sheets",reader.sheets(content.readFile(file.key())));
  }
  public ExcelReader.Table table(Map<String,Object> settings) {
    var file = files.get(settings.get("fileId").toString());
    return reader.read(content.readFile(file.key()), settings.get("sheet").toString(), ((Number)settings.get("headerRow")).intValue());
  }
  public void cleanup() {
    for (var file : files.unused()) {
      files.deleteUnused(file.id());
    }
    for (var key : files.pendingDeletes()) { content.delete(key); files.deleted(key); }
  }
  private void own(User user, SourceFileStore.File file) {
    if (!user.role().equals("admin") && !file.ownerId().equals(user.id())) throw new Failure(403, "FORBIDDEN");
  }
}
