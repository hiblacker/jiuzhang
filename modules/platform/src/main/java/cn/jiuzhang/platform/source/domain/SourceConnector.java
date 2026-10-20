package cn.jiuzhang.platform.source.domain;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public interface SourceConnector {
    record Connection(String host,int port,String database,boolean tls,String username,String password) {
        @Override public String toString() { return "Connection[REDACTED]"; }
    }
    record Column(String name,String type,long precision,int scale,long length,boolean nullable,String description) {}
    record ObjectInfo(String name,List<Column> columns) {}
    List<ObjectInfo> discover(Connection connection);
    void test(Connection connection);
    List<Map<String,Object>> preview(Connection connection,String table,int limit);
    void scan(Connection connection,String table,List<Column> expected,List<String> selected,
              Consumer<Map<String,Object>> consumer,java.util.function.BooleanSupplier canceled);
}
