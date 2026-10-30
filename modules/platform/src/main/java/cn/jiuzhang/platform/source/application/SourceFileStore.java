package cn.jiuzhang.platform.source.application;

import java.util.List;

public interface SourceFileStore {
  record File(String id, String ownerId, String name, String key, long size) {}
  File create(String ownerId, String name, String key, long size);
  File get(String id);
  boolean referenced(String id);
  List<File> unused();
  boolean deleteUnused(String id);
  List<String> pendingDeletes();
  void deleted(String key);
}
