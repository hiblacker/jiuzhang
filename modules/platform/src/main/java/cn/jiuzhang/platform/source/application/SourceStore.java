package cn.jiuzhang.platform.source.application;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import cn.jiuzhang.platform.source.domain.SourceConnector.Column;

public interface SourceStore {
    record Source(String id,String name,String description,String owner,List<String> tags,Map<String,Object> settings,
                  String username,String status,int objectCount,Instant updatedAt) {}
    record SourceObject(String id,String sourceId,String name,List<Column> columns) {}
    <T> T transaction(Supplier<T> work);
    List<Source> list();
    Source get(String id);
    Source create(String name,String description,String owner,List<String> tags,Map<String,Object> settings,String username,String creator);
    Source update(String id,String name,String description,String owner,List<String> tags,Map<String,Object> settings,String username);
    void secret(String id,String encrypted);
    String secret(String id);
    void status(String id,String status,int objects);
    List<SourceObject> objects(String sourceId);
    void object(String sourceId,String name,List<Column> columns);
    void delete(String id);
}
