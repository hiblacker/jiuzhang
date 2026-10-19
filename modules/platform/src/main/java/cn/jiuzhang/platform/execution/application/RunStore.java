package cn.jiuzhang.platform.execution.application;
import java.util.*;
import java.util.function.Supplier;
public interface RunStore{
 <T>T transaction(Supplier<T> work);
 void lockDataset(String dataset);
 Map<String,Object> get(String id,boolean lock);
 List<Map<String,Object>> list();
 Map<String,Object> existing(String user,String dataset,String key);
 Map<String,Object> create(String dataset,int version,String user,String key,String hash,boolean allow,String retryOf);
 void cancel(String id);
 Map<String,Object> claim();
 boolean heartbeat(String id,String token);
 boolean canceled(String id,String token);
 void transition(String id,String token,String status,long count,List<Map<String,Object>> quality);
 void stage(String id,String token,String physical,List<Map<String,Object>> fields,long count,String rawKey);
 void finish(String id,String token,String status,String code);
 void commit(String id,String token);
 Map<String,Object> current(String dataset);
 List<Map<String,Object>> targets();
 Map<String,Object> snapshot(String run);
 List<Map<String,Object>> history(String dataset);
 void deleted(String run);
}
