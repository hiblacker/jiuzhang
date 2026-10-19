package cn.jiuzhang.platform.execution.application;
import cn.jiuzhang.platform.dataset.domain.DatasetPlan.Field;
import java.util.List;
import java.util.Map;
public interface WarehousePort {
 void create(String physical,List<Field> fields);
 void append(String physical,List<Field> fields,List<Map<String,Object>> rows);
 long count(String physical);
 void publish(String logical,String physical,List<Field> fields);
 boolean pointsTo(String logical,String physical);
 void drop(String physical);
 List<Map<String,Object>> rows(String table,List<String> columns,int limit,int offset);
}
