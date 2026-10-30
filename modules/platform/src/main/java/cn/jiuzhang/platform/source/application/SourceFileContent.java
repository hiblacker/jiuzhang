package cn.jiuzhang.platform.source.application;

/** Private immutable source files; implementations must enforce the read size limit. */
public interface SourceFileContent {
  void putFile(String key, byte[] content);
  byte[] readFile(String key);
  void delete(String key);
}
