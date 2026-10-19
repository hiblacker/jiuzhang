package cn.jiuzhang.platform.dataset.application;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import cn.jiuzhang.platform.source.domain.SourceConnector.Column;
public interface DatasetStore{
 <T>T transaction(Supplier<T> work);
 List<Map<String,Object>> list();Map<String,Object> get(String id,boolean lock);Map<String,Object> save(String id,Map<String,Object> input);void delete(String id);
 List<Map<String,Object>> versions(String id);Map<String,Object> version(String id,int version);List<Column> columns(String id,int version);String table(String id,int version);
 void publish(String id,int number,Map<String,Object> body,String sourceTable,List<Column> columns);
 List<Map<String,Object>> rules(String category);Map<String,Object> rule(String category,String id);Map<String,Object> saveRule(String category,String id,Map<String,Object> body);void deleteRule(String category,String id);
 Map<String,Object> publication(String user,String dataset,String key);void publication(String user,String dataset,String key,String hash,Map<String,Object> body);
}
