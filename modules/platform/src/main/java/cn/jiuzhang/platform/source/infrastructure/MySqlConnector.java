package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.source.domain.SourceConnector;
import cn.jiuzhang.platform.shared.application.Failure;
import java.net.InetAddress;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.springframework.stereotype.Component;

@Component
public class MySqlConnector implements SourceConnector {
    private static final Set<String> TYPES=Set.of("tinyint","smallint","mediumint","int","bigint","decimal","numeric","char","varchar","text","date","datetime","timestamp");
    public void test(Connection config){try(var c=open(config)){try(var s=c.createStatement()){s.setQueryTimeout(10);s.execute("SELECT 1");}}catch(SQLException e){throw connectionFailure(e);}}
    public List<ObjectInfo> discover(Connection config){
        try(var c=open(config)){
            var tables=new ArrayList<ObjectInfo>();
            try(var s=c.prepareStatement("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE' ORDER BY table_name LIMIT 201")){
                s.setString(1,config.database());s.setQueryTimeout(15);
                try(var r=s.executeQuery()){while(r.next())tables.add(new ObjectInfo(r.getString(1),List.of()));}
            }
            Failure.require(tables.size()<=200,"SOURCE_CATALOG_LIMIT");
            var result=new ArrayList<ObjectInfo>();for(var table:tables)result.add(new ObjectInfo(table.name(),columns(c,config.database(),table.name())));return result;
        }catch(SQLException e){throw connectionFailure(e);}
    }
    public List<Map<String,Object>> preview(Connection config,String table,int limit){
        Failure.require(limit>=1&&limit<=100,"VALIDATION_ERROR");
        try(var c=open(config)){
            var columns=columns(c,config.database(),table);supported(columns);
            var rows=new ArrayList<Map<String,Object>>();
            try(var s=c.prepareStatement("SELECT "+columnSql(columns.stream().map(Column::name).toList())+" FROM "+quote(table)+" LIMIT ?")){
                s.setInt(1,limit);s.setQueryTimeout(15);try(var r=s.executeQuery()){while(r.next())rows.add(row(r,columns));}
            }return rows;
        }catch(SQLException e){throw connectionFailure(e);}
    }
    public void scan(Connection config,String table,List<Column> expected,List<String> selected,Consumer<Map<String,Object>> consumer,BooleanSupplier canceled){
        Failure.require(!selected.isEmpty()&&selected.size()<=200,"VALIDATION_ERROR");
        try(var c=open(config)){
            c.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ);c.setAutoCommit(false);
            try(var s=c.createStatement()){s.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");}
            try(var s=c.prepareStatement("SELECT engine FROM information_schema.tables WHERE table_schema=? AND table_name=?")) {
                s.setString(1,config.database());s.setString(2,table);s.setQueryTimeout(15);
                try(var r=s.executeQuery()){if(!r.next()||!"InnoDB".equalsIgnoreCase(r.getString(1)))throw new Failure(422,"SOURCE_ENGINE_UNSUPPORTED");}
            }
            // Acquire a transaction metadata lock before comparing definitions; concurrent DDL must wait.
            try(var s=c.createStatement()){s.setQueryTimeout(15);s.executeQuery("SELECT "+columnSql(selected)+" FROM "+quote(table)+" LIMIT 0").close();}
            var actual=columns(c,config.database(),table);var used=actual.stream().filter(x->selected.contains(x.name())).toList();
            Failure.require(expected.stream().filter(x->selected.contains(x.name())).toList().size()==selected.size(),"SCHEMA_CHANGED");
            for(var col:expected)if(selected.contains(col.name())&&!actual.contains(col))throw new Failure(409,"SCHEMA_CHANGED");
            supported(used);
            try(var s=c.prepareStatement("SELECT "+columnSql(selected)+" FROM "+quote(table),ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)){
                s.setFetchSize(500);s.setQueryTimeout(300);
                var cancelPoll=java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
                cancelPoll.scheduleAtFixedRate(()->{try{if(canceled.getAsBoolean())s.cancel();}catch(Exception ignored){}},1,1,java.util.concurrent.TimeUnit.SECONDS);
                try(var r=s.executeQuery()){
                    long count=0;long deadline=System.nanoTime()+java.time.Duration.ofMinutes(10).toNanos();
                    var ordered=selected.stream().map(n->used.stream().filter(x->x.name().equals(n)).findFirst().orElseThrow()).toList();
                    while(r.next()){
                        if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");
                        if(++count>1000000||System.nanoTime()>deadline)throw new Failure(422,"SOURCE_SCAN_LIMIT");
                        consumer.accept(row(r,ordered));
                    }
                }finally{cancelPoll.shutdownNow();}
            }c.rollback();
        }catch(SQLException e){if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");if("42S22".equals(e.getSQLState())||"42S02".equals(e.getSQLState()))throw new Failure(409,"SCHEMA_CHANGED");throw connectionFailure(e);}
    }
    private java.sql.Connection open(Connection v)throws SQLException{
        Failure.require(v.host()!=null&&v.host().matches("[a-zA-Z0-9.-]{1,253}")&&v.port()>0&&v.port()<=65535,"VALIDATION_ERROR");
        Failure.require(v.database()!=null&&v.database().matches("[a-zA-Z0-9_]{1,64}"),"VALIDATION_ERROR");
        try{
            InetAddress[] addresses=InetAddress.getAllByName(v.host());
            if(addresses.length==0)throw new Failure(422,"SOURCE_CONNECTION_FAILED");
            String pinned=addresses[0].getHostAddress();
            if(pinned.contains(":"))throw new Failure(422,"SOURCE_HOST_DENIED");
            for(var a:addresses)if(a.isAnyLocalAddress()||a.isMulticastAddress()||a.isLinkLocalAddress())throw new Failure(403,"SOURCE_HOST_DENIED");
            var p=new Properties();p.setProperty("user",v.username());p.setProperty("password",v.password());
            p.setProperty("connectTimeout","5000");p.setProperty("socketTimeout","30000");p.setProperty("useCursorFetch","true");p.setProperty("useServerPrepStmts","true");
            p.setProperty("connectionTimeZone","UTC");p.setProperty("forceConnectionTimeZoneToSession","true");
            // Keep TLS encryption while intentionally skipping server certificate and hostname validation.
            p.setProperty("sslMode",v.tls()?"REQUIRED":"DISABLED");
            p.setProperty("allowPublicKeyRetrieval","false");p.setProperty("allowMultiQueries","false");
            if(!v.tls()) {
                if(!addresses[0].isLoopbackAddress())throw new Failure(422,"SOURCE_TLS_REQUIRED");
                String key=System.getenv().getOrDefault("JIUZHANG_MYSQL_PUBLIC_KEY",".local/mysql-public-key.pem");
                if(!java.nio.file.Files.isRegularFile(java.nio.file.Path.of(key)))throw new Failure(422,"SOURCE_KEY_REQUIRED");
                p.setProperty("serverRSAPublicKeyFile",java.nio.file.Path.of(key).toAbsolutePath().toString());
            }
            var c=DriverManager.getConnection("jdbc:mysql://"+(v.tls()?v.host():pinned)+":"+v.port()+"/"+v.database(),p);
            c.setReadOnly(true);return c;
        }catch(java.net.UnknownHostException e){throw new Failure(422,"SOURCE_CONNECTION_FAILED");}
    }
    private List<Column> columns(java.sql.Connection c,String database,String table)throws SQLException{
        var columns=new ArrayList<Column>();
        try(var s=c.prepareStatement("SELECT column_name,column_type,numeric_precision,numeric_scale,character_maximum_length,is_nullable FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position")){
            s.setString(1,database);s.setString(2,table);s.setQueryTimeout(15);
            try(var r=s.executeQuery()){while(r.next())columns.add(new Column(r.getString(1),r.getString(2),r.getLong(3),r.getInt(4),r.getLong(5),r.getString(6).equals("YES")));}
        }if(columns.isEmpty())throw new Failure(404,"SOURCE_TABLE_MISSING");Failure.require(columns.size()<=200,"SOURCE_CATALOG_LIMIT");return columns;
    }
    private void supported(List<Column> columns){for(var c:columns){String base=c.type().toLowerCase(java.util.Locale.ROOT).split("[ (]")[0];if(!TYPES.contains(base)||c.length()>1048576)throw new Failure(422,"SOURCE_TYPE_UNSUPPORTED");}}
    private Map<String,Object> row(ResultSet r,List<Column> columns)throws SQLException{
        var row=new LinkedHashMap<String,Object>();for(int i=0;i<columns.size();i++){String value=r.getString(i+1);if(value!=null&&value.length()>1048576)throw new Failure(422,"SOURCE_VALUE_LIMIT");row.put(columns.get(i).name(),value);}return row;
    }
    private static String columnSql(List<String> columns){return columns.stream().map(MySqlConnector::quote).collect(java.util.stream.Collectors.joining(","));}
    private static String quote(String name){Failure.require(name!=null&&!name.isEmpty()&&name.length()<=64&&name.indexOf(0)<0,"VALIDATION_ERROR");String q=Character.toString(96);return q+name.replace(q,q+q)+q;}
    private Failure connectionFailure(SQLException e){return new Failure(422,"SOURCE_CONNECTION_FAILED");}
}
