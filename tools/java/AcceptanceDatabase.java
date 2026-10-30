import cn.jiuzhang.platform.task.domain.ScheduleCalculator;
import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.sql.*;
import java.time.Instant;
import java.util.*;

/** Local acceptance control channel. Credentials stay in the environment, never in requests. */
class AcceptanceDatabase {
  static Object value(Object v) {
    if(v instanceof Timestamp t)return t.toInstant().toString();
    if(v instanceof java.math.BigDecimal n)return n.toPlainString();
    if(v instanceof Long n)return n.toString();
    if(v==null||v instanceof String||v instanceof Number||v instanceof Boolean)return v;
    return v.toString();
  }
  public static void main(String[] args) throws Exception {
    var json=new ObjectMapper();
    var properties=new Properties();
    String url=System.getenv().getOrDefault("METADATA_URL","jdbc:postgresql://127.0.0.1:15432/jiuzhang");
    properties.setProperty("user",System.getenv().getOrDefault("METADATA_USER","jiuzhang"));
    properties.setProperty("password",System.getenv("METADATA_PASSWORD"));
    properties.setProperty("ApplicationName","jiuzhang-acceptance-control");
    properties.setProperty("connectTimeout","10");
    try(var connection=DriverManager.getConnection(url,properties);
        var input=new BufferedReader(new InputStreamReader(System.in,java.nio.charset.StandardCharsets.UTF_8))) {
      System.out.println("{\"ready\":true}");System.out.flush();
      String line;
      while((line=input.readLine())!=null) {
        try {
          JsonNode request=json.readTree(line);
          if("next".equals(request.path("operation").asText())) {
            Map<String,Object> schedule=json.convertValue(request.get("schedule"),new com.fasterxml.jackson.core.type.TypeReference<Map<String,Object>>(){});
            var next=ScheduleCalculator.next(schedule,Instant.parse(request.get("after").asText()));
            System.out.println(json.writeValueAsString(Map.of("next",next.toString())));System.out.flush();continue;
          }
          try(var statement=connection.prepareStatement(request.get("sql").asText())) {
            statement.setQueryTimeout(30);
            var params=request.path("params");
            for(int i=0;i<params.size();i++) {
              var p=params.get(i);
              if(p.isNull())statement.setObject(i+1,null);
              else if(p.isIntegralNumber())statement.setLong(i+1,p.asLong());
              else if(p.isBoolean())statement.setBoolean(i+1,p.asBoolean());
              else statement.setString(i+1,p.asText());
            }
            var results=new ArrayList<Map<String,Object>>();
            boolean rows=statement.execute();int updates=0;
            while(true) {
              if(rows)try(var result=statement.getResultSet()) {
                var columns=new ArrayList<String>();var data=new ArrayList<Map<String,Object>>();
                int width=result.getMetaData().getColumnCount();
                for(int i=1;i<=width;i++)columns.add(result.getMetaData().getColumnLabel(i));
                while(result.next()) {var row=new LinkedHashMap<String,Object>();for(int i=1;i<=width;i++)row.put(columns.get(i-1),value(result.getObject(i)));data.add(row);}
                results.add(Map.of("columns",columns,"rows",data));
              } else {int count=statement.getUpdateCount();if(count==-1)break;updates+=count;}
              rows=statement.getMoreResults();
            }
            System.out.println(json.writeValueAsString(Map.of("results",results,"updates",updates)));
          }
        } catch(Exception error) {
          System.out.println(json.writeValueAsString(Map.of("error",error.getClass().getSimpleName(),"sqlState",error instanceof SQLException sql?Objects.toString(sql.getSQLState(),""):"")));
        }
        System.out.flush();
      }
    }
  }
}
