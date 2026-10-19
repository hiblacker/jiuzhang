package cn.jiuzhang.platform.execution.application;
import java.nio.file.Path;
public interface ObjectPort {void put(String key,Path file);void delete(String key);}
