package cn.jiuzhang.platform.shared.application;

/** Encodes metadata and bounded row batches without exposing serializer implementations. */
public interface JsonWriter {
  String write(Object value);
}
