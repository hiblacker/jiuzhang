package cn.jiuzhang.platform.source.application;

import cn.jiuzhang.platform.source.domain.SourceConnector.Column;
import java.util.List;
import java.util.Map;

public interface ExcelReader {
  record Table(List<Column> columns, List<Map<String, Object>> rows) {}
  List<String> sheets(byte[] file);
  Table read(byte[] file, String sheet, int headerRow);
}
