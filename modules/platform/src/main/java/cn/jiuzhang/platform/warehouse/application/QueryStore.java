package cn.jiuzhang.platform.warehouse.application;

import java.util.*;
import java.util.function.Supplier;

public interface QueryStore {
  <T> T transaction(Supplier<T> work);

  String nextId(String resource);

  Map<String, Object> get(String resource, String id, String user);

  List<Map<String, Object>> list(String resource, String user);

  void save(
      String resource,
      String id,
      String user,
      String dataset,
      String run,
      String query,
      Map<String, Object> body);

  Map<String, Object> receipt(String user, String resource, String key, String hash);

  void receipt(String user, String resource, String key, String hash, String id);

  void lock(String user, String resource, String key);

  int cleanupExpiredExports();
}
