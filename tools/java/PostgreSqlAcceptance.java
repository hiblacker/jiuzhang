import cn.jiuzhang.platform.source.domain.SourceConnector;
import cn.jiuzhang.platform.source.infrastructure.PostgreSqlConnector;
import cn.jiuzhang.platform.shared.application.Failure;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Real isolated PostgreSQL fixture. The administrator mutates only synthetic test objects. */
class PostgreSqlAcceptance {
    static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
    static String env(String name,String fallback){return System.getenv().getOrDefault("POSTGRESQL_SOURCE_"+name,fallback);}
    static void failure(Runnable action,String code){try{action.run();throw new AssertionError("Expected "+code);}catch(Failure error){require(error.code.equals(code),"Expected "+code+", got "+error.code);}}
    static SourceConnector.Connection config(boolean tls,String host,String password){return new SourceConnector.Connection(host,Integer.parseInt(env("PORT","15433")),env("DATABASE","demo_retail"),tls,env("USER","jiuzhang_reader"),password,env("SCHEMA","Retail"));}
    static String scalar(Connection connection,String sql)throws SQLException{try(var statement=connection.createStatement();var result=statement.executeQuery(sql)){result.next();return result.getString(1);}}
    public static void main(String[] args)throws Exception {
        try{verify();}catch(Exception error){throw new AssertionError("PostgreSQL acceptance failed: "+error.getClass().getSimpleName()+(error instanceof Failure f?" / "+f.code:""));}
    }
    static void verify()throws Exception {
        String ca=System.getenv().getOrDefault("JIUZHANG_POSTGRESQL_SSL_ROOT_CERT",".local/postgresql-source/ca.crt");
        var connector=new PostgreSqlConnector(300,ca);
        var config=config(true,env("HOST","localhost"),env("PASSWORD",""));
        connector.test(config);
        var session=connector.query(config,"SELECT version() AS engine,current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,current_setting('TimeZone') AS timezone,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl",1).rows().getFirst();
        require("on".equals(session.get("read_only"))&&"repeatable read".equals(session.get("isolation")),"Source transaction is not read-only repeatable read");
        require("UTC".equals(session.get("timezone"))&&Boolean.TRUE.equals(session.get("ssl")),"Source UTC/TLS not active");
        failure(()->connector.test(config(true,"127.0.0.1",env("PASSWORD",""))),"SOURCE_CONNECTION_FAILED");
        failure(()->new PostgreSqlConnector(300,".local/postgresql-source/wrong-ca.crt").test(config),"SOURCE_CONNECTION_FAILED");
        failure(()->connector.test(config(true,env("HOST","localhost"),"incorrect-test-password")),"SOURCE_CONNECTION_FAILED");
        connector.test(config(false,"127.0.0.1",env("PASSWORD","")));
        var missing=new SourceConnector.Connection(config.host(),config.port(),config.database(),true,config.username(),config.password(),"missing_schema");
        failure(()->connector.test(missing),"SOURCE_SCHEMA_DENIED");
        var found=connector.discover(config).stream().filter(x->x.name().equals("Orders")).findFirst().orElseThrow();
        require(found.columns().stream().anyMatch(c->c.name().equals("amount")&&c.type().equals("decimal(20,4)")&&c.description().equals("Synthetic exact decimal")),"Catalog precision/comment lost");
        var selected=found.columns().stream().map(SourceConnector.Column::name).toList();
        var rows=new ArrayList<Map<String,Object>>();
        require(connector.preview(config,"Orders",10).size()==10,"Preview failed");
        require(connector.query(config,"SELECT id FROM orders",1).rows().getFirst().get("id").equals("-1"),"Unquoted PostgreSQL case folding changed");
        require(connector.query(config,"SELECT id FROM public.\"Orders\"",1).rows().getFirst().get("id").equals("-2"),"Explicit schema name changed");
        var publicConfig=new SourceConnector.Connection(config.host(),config.port(),config.database(),true,config.username(),config.password());
        require(connector.discover(publicConfig).stream().anyMatch(x->x.name().equals("Orders")),"Default public schema failed");
        connector.scan(config,"Orders",found.columns(),selected,rows::add,()->false);
        require(rows.size()==1201&&rows.stream().map(row->row.get("id")).distinct().count()==1201,"Three cursor batches lost or duplicated rows");
        require(rows.stream().allMatch(row->"12345.6700".equals(row.get("amount"))),"Exact decimal lost");
        require(rows.stream().anyMatch(row->row.get("label")==null)&&rows.stream().allMatch(row->row.get("active") instanceof Boolean),"Null/boolean lost");
        require(rows.stream().allMatch(row->"2026-11-02 01:30".equals(row.get("happened_at"))&&"2026-11-02 09:30:00.123456".equals(row.get("local_at"))),"Timestamp timezone semantics changed");
        require(rows.stream().allMatch(row->row.get("document") instanceof String&&row.get("entity_uuid") instanceof String),"JSON/UUID not strings");
        var noKey=connector.discover(config).stream().filter(x->x.name().equals("no_key")).findFirst().orElseThrow();
        rows.clear();connector.scan(config,"no_key",noKey.columns(),List.of("id","amount"),rows::add,()->false);require(rows.size()==1201,"No-primary-key scan failed");
        failure(()->connector.scan(config,"Orders",found.columns(),List.of("id"),2,row->{},()->false),"SOURCE_SCAN_LIMIT");
        var canceled=new AtomicBoolean();
        failure(()->connector.scan(config,"Orders",found.columns(),List.of("id"),row->canceled.set(true),canceled::get),"RUN_CANCELED");
        String sql="SELECT id,amount,active FROM \"Retail\".\"Orders\"";
        var query=connector.query(config,sql,10);rows.clear();connector.scanSql(config,sql,query.columns(),List.of("id","amount","active"),1_000_000,rows::add,()->false);require(rows.size()==1201,"SQL scan failed");
        failure(()->connector.query(config,"SELECT 1::numeric(40,4) AS amount",1),"SOURCE_COLUMN_TYPE_UNSUPPORTED");
        failure(()->connector.query(config,"SELECT 1::numeric AS amount",1),"SOURCE_COLUMN_TYPE_UNSUPPORTED");
        var writerProperties=new Properties();writerProperties.setProperty("user","postgres");writerProperties.setProperty("password",env("ADMIN_PASSWORD",""));writerProperties.setProperty("sslmode","disable");
        try(var writer=DriverManager.getConnection("jdbc:postgresql://127.0.0.1:"+config.port()+"/"+config.database(),writerProperties);var statement=writer.createStatement()) {
            rows.clear();
            try {
                connector.scan(config,"Orders",found.columns(),selected,row->{
                    rows.add(row);
                    if(rows.size()==1)try {
                        statement.execute("UPDATE \"Retail\".\"Orders\" SET label='after' WHERE id=9007199254742194");
                        statement.execute("INSERT INTO \"Retail\".\"Orders\" SELECT 9007199254742195,amount,active,'after',happened_at,local_at,event_date,document,entity_uuid FROM \"Retail\".\"Orders\" LIMIT 1");
                        statement.execute("SET lock_timeout='200ms'");
                        try{statement.execute("ALTER TABLE \"Retail\".\"Orders\" ADD COLUMN must_not_appear int");throw new AssertionError("Concurrent DDL did not wait for scan");}
                        catch(SQLException expected){require("55P03".equals(expected.getSQLState()),"Unexpected DDL failure");}
                        finally{statement.execute("SET lock_timeout=0");}
                    }catch(SQLException error){throw new AssertionError("Synthetic concurrent mutation failed");}
                },()->false);
                require(rows.size()==1201&&rows.stream().noneMatch(row->"after".equals(row.get("label"))),"Cursor batches mixed snapshots");
                rows.clear();connector.scan(config,"Orders",found.columns(),selected,rows::add,()->false);
                require(rows.size()==1202&&rows.stream().filter(row->"after".equals(row.get("label"))).count()==2,"Next transaction missed committed changes");
            }finally{statement.execute("DELETE FROM \"Retail\".\"Orders\" WHERE id=9007199254742195");statement.execute("UPDATE \"Retail\".\"Orders\" SET label='before' WHERE id=9007199254742194");}
            String fixture="accept_"+UUID.randomUUID().toString().replace("-","").substring(0,10);
            String table="\"Retail\"."+fixture;
            statement.execute("CREATE TABLE "+table+"(id integer, payload integer[])");
            try {
                statement.execute("INSERT INTO "+table+" VALUES(1,ARRAY[1,2])");statement.execute("GRANT SELECT ON "+table+" TO jiuzhang_reader");
                var columns=connector.discover(config).stream().filter(x->x.name().equals(fixture)).findFirst().orElseThrow().columns();
                failure(()->connector.preview(config,fixture,10),"SOURCE_COLUMN_TYPE_UNSUPPORTED");
                require(connector.query(config,"SELECT payload::text AS value FROM "+table,1).rows().getFirst().get("value").equals("{1,2}"),"Explicit unsupported-type cast failed");
                statement.execute("ALTER TABLE "+table+" ALTER COLUMN id TYPE text USING id::text");
                failure(()->connector.scan(config,fixture,columns,List.of("id"),row->{},()->false),"SCHEMA_CHANGED");
                String function="\"Retail\"."+fixture+"_write";
                statement.execute("CREATE FUNCTION "+function+"() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN INSERT INTO "+table+" VALUES('unsafe',NULL); RETURN 1; END $$");
                try {
                    failure(()->connector.query(config,"SELECT "+function+"() AS value",1),"SQL_EXECUTION_FAILED");
                    require("1".equals(scalar(writer,"SELECT count(*) FROM "+table)),"Read-only transaction allowed a function to write");
                }finally{statement.execute("DROP FUNCTION "+function+"()");}
                String blocked="SELECT id FROM "+table;
                var blockedColumns=connector.query(config,blocked,1).columns();
                writer.setAutoCommit(false);statement.execute("LOCK TABLE "+table+" IN ACCESS EXCLUSIVE MODE");
                try {
                    long start=System.nanoTime();
                    failure(()->new PostgreSqlConnector(1,ca).query(config,blocked,1),"DATASET_SQL_TIMEOUT");
                    require(System.nanoTime()-start<TimeUnit.SECONDS.toNanos(5),"Query timeout did not bound lock wait");
                    var stop=new AtomicBoolean();var executor=Executors.newSingleThreadExecutor();
                    try {
                        var pending=executor.submit(()->failure(()->connector.scanSql(config,blocked,blockedColumns,List.of("id"),100,row->{},stop::get),"RUN_CANCELED"));
                        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);boolean waiting=false;
                        while(System.nanoTime()<deadline) {
                            statement.execute("SELECT pg_stat_clear_snapshot()");
                            waiting=Integer.parseInt(scalar(writer,"SELECT count(*) FROM pg_stat_activity WHERE application_name='jiuzhang-source' AND wait_event_type='Lock' AND query LIKE '%"+fixture+"%'"))>0;
                            if(pending.isDone())pending.get();
                            if(waiting)break;Thread.sleep(20);
                        }
                        require(waiting,"Cancellation query never reached PostgreSQL lock wait");stop.set(true);pending.get(5,TimeUnit.SECONDS);
                    }finally{executor.shutdownNow();}
                }finally{writer.rollback();writer.setAutoCommit(true);}
            }finally{statement.execute("DROP TABLE "+table);}
        }
        var report=new LinkedHashMap<String,Object>();report.put("status","passed");report.put("session",session);report.put("rows",1201);report.put("cursorBatches",3);report.put("noPrimaryKey",true);report.put("snapshotAndDdl",true);report.put("timeoutAndCancellation",true);report.put("tlsIdentityAndNegativeCases",true);
        new ObjectMapper().writeValue(Path.of(".local/postgresql-connector-test.json").toFile(),report);
        System.out.println("PASS real PostgreSQL 17.6: schema/case, 1201 cursor rows/no PK, exact types/UTC, snapshot/DDL, timeout/cancel, TLS/CA/hostname failures");
    }
}
