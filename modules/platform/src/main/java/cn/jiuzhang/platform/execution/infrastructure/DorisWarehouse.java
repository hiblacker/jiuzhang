package cn.jiuzhang.platform.execution.infrastructure;
import cn.jiuzhang.platform.execution.application.WarehousePort;
import cn.jiuzhang.platform.dataset.domain.DatasetPlan.Field;
import cn.jiuzhang.platform.shared.application.Failure;
import java.sql.*;
import java.math.*;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class DorisWarehouse implements WarehousePort {
 private Connection open()throws SQLException{
  String password=System.getenv("WAREHOUSE_PASSWORD");if(password==null)throw new Failure(503,"WAREHOUSE_NOT_CONFIGURED");
  var p=new Properties();p.setProperty("user",System.getenv().getOrDefault("WAREHOUSE_USER","jiuzhang"));p.setProperty("password",password);p.setProperty("connectTimeout","5000");p.setProperty("socketTimeout","30000");p.setProperty("allowMultiQueries","false");p.setProperty("useServerPrepStmts","false");p.setProperty("rewriteBatchedStatements","true");
  return DriverManager.getConnection(System.getenv().getOrDefault("WAREHOUSE_URL","jdbc:mysql://127.0.0.1:19030/jiuzhang"),p);
 }
 public void create(String physical,List<Field> all){var fields=all.stream().filter(Field::output).toList();String definitions=fields.stream().map(f->q(f.target())+" "+type(f)+(f.nullable()?" NULL":" NOT NULL")).collect(java.util.stream.Collectors.joining(","));execute("CREATE TABLE "+q(physical)+" ("+definitions+") ENGINE=OLAP DUPLICATE KEY("+q(fields.getFirst().target())+") DISTRIBUTED BY HASH("+q(fields.getFirst().target())+") BUCKETS 1 PROPERTIES ('replication_num'='1','light_schema_change'='true')");}
 public void append(String physical,List<Field> all,List<Map<String,Object>> rows){if(rows.isEmpty())return;var fields=all.stream().filter(Field::output).toList();String sql="INSERT INTO "+q(physical)+" ("+columns(fields.stream().map(Field::target).toList())+") VALUES ("+String.join(",",Collections.nCopies(fields.size(),"?"))+")";
  try(var c=open();var s=c.prepareStatement(sql)){s.setQueryTimeout(30);for(var row:rows){for(int i=0;i<fields.size();i++){var f=fields.get(i);Object v=row.get(f.target());if(v==null)s.setNull(i+1,Types.NULL);else if(f.type().equals("integer")){var n=new BigInteger(v.toString());if(n.bitLength()>127)throw new Failure(422,"WAREHOUSE_PRECISION_LIMIT");s.setBigDecimal(i+1,new BigDecimal(n));}else if(f.type().startsWith("decimal"))s.setBigDecimal(i+1,new BigDecimal(v.toString()));else if(f.type().equals("boolean"))s.setBoolean(i+1,(Boolean)v);else s.setString(i+1,v.toString());}s.addBatch();}s.executeBatch();}
  catch(SQLException e){throw failure();}
 }
 public long count(String physical){try(var c=open();var s=c.createStatement()){s.setQueryTimeout(15);try(var r=s.executeQuery("SELECT COUNT(*) FROM "+q(physical))){r.next();return r.getLong(1);}}catch(SQLException e){throw failure();}}
 public void publish(String logical,String physical,List<Field> fields){String select=" AS SELECT "+columns(fields.stream().filter(Field::output).map(Field::target).toList())+" FROM "+q(physical);try(var c=open();var s=c.createStatement()){s.setQueryTimeout(15);if(exists(c,logical))s.execute("ALTER VIEW "+q(logical)+select);else s.execute("CREATE VIEW "+q(logical)+select);}catch(SQLException e){throw failure();}}
 public boolean pointsTo(String logical,String physical){try(var c=open()){if(!exists(c,logical))return false;try(var s=c.createStatement()){s.setQueryTimeout(10);try(var r=s.executeQuery("SHOW CREATE VIEW "+q(logical))){return r.next()&&r.getString(2).contains(q(physical));}}}catch(SQLException e){throw failure();}}
 public void drop(String physical){execute("DROP TABLE IF EXISTS "+q(physical));}
 public List<Map<String,Object>> rows(String table,List<String> fields,int limit,int offset){if(limit<1||limit>10000||offset<0)throw new Failure(422,"QUERY_LIMIT");try(var c=open();var s=c.prepareStatement("SELECT "+columns(fields)+" FROM "+q(table)+" LIMIT ? OFFSET ?")){s.setInt(1,limit);s.setInt(2,offset);s.setQueryTimeout(15);try(var rs=s.executeQuery()){var rows=new ArrayList<Map<String,Object>>();while(rs.next()){var row=new LinkedHashMap<String,Object>();for(int i=0;i<fields.size();i++)row.put(fields.get(i),rs.getString(i+1));rows.add(row);}return rows;}}catch(SQLException e){throw failure();}}
 private boolean exists(Connection c,String name)throws SQLException{try(var s=c.prepareStatement("SELECT COUNT(*) FROM information_schema.views WHERE table_schema=DATABASE() AND table_name=?")){s.setString(1,name);s.setQueryTimeout(10);try(var r=s.executeQuery()){r.next();return r.getInt(1)>0;}}}
 private void execute(String sql){try(var c=open();var s=c.createStatement()){s.setQueryTimeout(30);s.execute(sql);}catch(SQLException e){throw failure();}}
 private String type(Field f){if(f.type().startsWith("decimal("))return f.type().toUpperCase(Locale.ROOT);return switch(f.type()){case "integer"->"LARGEINT";case "decimal"->"DECIMAL(38,9)";case "date"->"DATEV2";case "boolean"->"BOOLEAN";default->"VARCHAR(65533)";};}
 private String columns(List<String> names){return names.stream().map(DorisWarehouse::q).collect(java.util.stream.Collectors.joining(","));}
 public static String q(String name){if(name==null||!name.matches("[a-zA-Z_][a-zA-Z0-9_]{0,99}"))throw new Failure(422,"INVALID_IDENTIFIER");return Character.toString(96)+name+Character.toString(96);}
 private Failure failure(){return new Failure(503,"WAREHOUSE_UNAVAILABLE");}
}
