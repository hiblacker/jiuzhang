import cn.jiuzhang.platform.source.domain.SourceConnector;
import cn.jiuzhang.platform.source.infrastructure.OceanBaseConnector;
import cn.jiuzhang.platform.shared.application.Failure;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.sql.*;
import java.util.*;

/** Read with the supplied account; optional writer owns only uniquely named synthetic tables. */
class OceanBaseAcceptance {
  static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
  static String env(String name,String fallback){return System.getenv().getOrDefault("OCEANBASE_"+name,fallback);}
  static void failure(Runnable operation,String code){try{operation.run();throw new AssertionError("Expected "+code);}catch(Failure error){require(error.code.equals(code),"Unexpected failure code "+error.code);}}
  public static void main(String[] args)throws Exception {
    try { verify(); }
    catch(Exception error){throw new AssertionError("OceanBase acceptance failed: "+error.getClass().getSimpleName()+(error instanceof Failure f?" / "+f.code:""));}
  }
  static void verify()throws Exception {
    var connector=new OceanBaseConnector(300);
    var config=new SourceConnector.Connection(env("HOST","127.0.0.1"),Integer.parseInt(env("PORT","2881")),env("DATABASE","demo_retail"),Boolean.parseBoolean(env("TLS","true")),env("USER",""),env("PASSWORD",""));
    connector.test(config);
    var session=connector.query(config,"SELECT VERSION() AS engine, @@ob_read_consistency AS consistency, @@ob_query_timeout AS query_timeout, @@ob_trx_timeout AS trx_timeout",1).rows().getFirst();
    require("STRONG".equals(session.get("consistency")),"Session is not STRONG");
    require("300000000".equals(session.get("query_timeout")),"Session query timeout was not raised");
    String table=env("TEST_TABLE","orders");require(table.matches("[A-Za-z0-9_]{1,64}"),"Invalid test table");
    var found=connector.discover(config).stream().filter(x->x.name().equals(table)).findFirst().orElseThrow();
    require(!connector.preview(config,table,10).isEmpty(),"Preview is empty");
    var selected=found.columns().stream().map(SourceConnector.Column::name).toList();
    long expected=Long.parseLong(connector.query(config,"SELECT COUNT(*) AS total FROM `"+table+"`",1).rows().getFirst().get("total").toString());
    var rows=new ArrayList<Map<String,Object>>();connector.scan(config,table,found.columns(),selected,rows::add,()->false);
    require(rows.size()==expected,"Table scan row count differs");
    String sql="SELECT id, amount FROM `"+table+"`";
    var query=connector.query(config,sql,100);
    var sqlRows=new ArrayList<Map<String,Object>>();
    connector.scanSql(config,sql,query.columns(),List.of("id","amount"),1000000,sqlRows::add,()->false);
    require(sqlRows.size()==expected,"SQL scan row count differs");
    boolean multiplePages=false;
    if(System.getenv("OCEANBASE_FIXTURE_USER")!=null) {
      var properties=new Properties();properties.setProperty("user",env("FIXTURE_USER",""));properties.setProperty("password",env("FIXTURE_PASSWORD",""));
      properties.setProperty("sslMode",config.tls()?"VERIFY_IDENTITY":"DISABLED");properties.setProperty("allowPublicKeyRetrieval","false");
      String fixture="ob_accept_"+UUID.randomUUID().toString().replace("-","").substring(0,10);
      try(var writer=DriverManager.getConnection("jdbc:mysql://"+config.host()+":"+config.port()+"/"+config.database(),properties);var statement=writer.createStatement()) {
        statement.execute("CREATE TABLE "+fixture+" (tenant_key INT NOT NULL,id BIGINT NOT NULL,amount DECIMAL(20,4) NOT NULL,label VARCHAR(20),PRIMARY KEY(tenant_key,id))");
        try {
          try(var insert=writer.prepareStatement("INSERT INTO "+fixture+" VALUES(?,?,?,?)")) {
            for(int i=1;i<=1201;i++){insert.setInt(1,i%3);insert.setLong(2,9007199254740993L+i);insert.setBigDecimal(3,new java.math.BigDecimal("12345.6700"));insert.setString(4,i==1?null:"before");insert.addBatch();}
            insert.executeBatch();
          }
          var columns=connector.discover(config).stream().filter(x->x.name().equals(fixture)).findFirst().orElseThrow().columns();
          rows.clear();
          connector.scan(config,fixture,columns,List.of("id","amount","label"),row->{
            rows.add(row);
            if(rows.size()==1)try {
              statement.executeUpdate("UPDATE "+fixture+" SET label='after' WHERE id=9007199254742194");
              statement.executeUpdate("INSERT INTO "+fixture+" VALUES(0,9007199254742195,0.0000,'after')");
            }catch(SQLException error){throw new AssertionError("Synthetic concurrent update failed");}
          },()->false);
          require(rows.size()==1201&&rows.stream().noneMatch(row->"after".equals(row.get("label"))),"Keyset pages did not share one snapshot");
          require(rows.stream().anyMatch(row->row.get("label")==null),"Null lost");
          require(rows.stream().allMatch(row->"12345.6700".equals(row.get("amount"))),"Decimal precision lost");
          require(rows.stream().map(row->row.get("id")).distinct().count()==1201,"Duplicate keyset rows");
          rows.clear();connector.scan(config,fixture,columns,List.of("id","amount","label"),rows::add,()->false);
          require(rows.size()==1202&&rows.stream().filter(row->"after".equals(row.get("label"))).count()==2,"Next scan did not observe committed changes");
          failure(()->connector.scan(config,fixture,columns,List.of("id"),2,row->{},()->false),"SOURCE_SCAN_LIMIT");
          String noKey=fixture+"_no_pk";
          statement.execute("CREATE TABLE "+noKey+" (id BIGINT,amount DECIMAL(10,2))");
          try {
            statement.execute("INSERT INTO "+noKey+" VALUES(1,1.25)");
            var noKeyColumns=connector.discover(config).stream().filter(x->x.name().equals(noKey)).findFirst().orElseThrow().columns();
            require(connector.preview(config,noKey,1).size()==1,"No-key table preview failed");
            failure(()->connector.scan(config,noKey,noKeyColumns,List.of("id"),row->{},()->false),"SOURCE_PRIMARY_KEY_REQUIRED");
            require(connector.query(config,"SELECT id FROM "+noKey,1).rows().size()==1,"No-key SQL alternative failed");
          } finally {statement.execute("DROP TABLE "+noKey);}
          var canceled=new java.util.concurrent.atomic.AtomicBoolean();
          failure(()->connector.scan(config,fixture,columns,List.of("id"),row->canceled.set(true),canceled::get),"RUN_CANCELED");
          multiplePages=true;
        }
        finally {statement.execute("DROP TABLE "+fixture);}
      }
    }
    var report=new LinkedHashMap<String,Object>();report.put("session",session);report.put("tableRows",expected);report.put("multipleKeysetPages",multiplePages);
    new ObjectMapper().writeValue(Path.of(".local/oceanbase-connector-test.json").toFile(),report);
    System.out.println("PASS real OceanBase discover/preview/query/table+SQL scan, STRONG/session timeout; multiple keyset pages="+multiplePages);
  }
}
