package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.source.domain.SourceConnector;
import cn.jiuzhang.platform.shared.application.Failure;
import java.net.InetAddress;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
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
    public QueryResult query(Connection config,String sql,int limit){
        Failure.require(limit>=1&&limit<=1000,"QUERY_LIMIT");
        String statement=ReadOnlySql.validate(sql);
        try(var c=open(config)){
            beginReadOnly(c);
            try(var s=c.prepareStatement(statement,ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)){
            s.setMaxRows(limit);s.setFetchSize(Math.min(limit,500));s.setQueryTimeout(30);
            try(var r=s.executeQuery()){
                var fields=resultColumns(r.getMetaData());var rows=new ArrayList<Map<String,Object>>();long bytes=0;
                while(r.next()){
                    var row=resultRow(r,fields);bytes+=row.entrySet().stream().mapToLong(entry->
                        entry.getKey().getBytes(java.nio.charset.StandardCharsets.UTF_8).length+
                        (entry.getValue()==null?0:entry.getValue().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length)).sum();
                    if(bytes>10L*1024*1024)throw new Failure(422,"QUERY_RESULT_LIMIT");
                    rows.add(row);
                }
                c.rollback();return new QueryResult(fields,rows);
            }
            }
        }catch(SQLException e){throw queryFailure(e);}
    }
    public QueryResult queryTable(Connection config,String table,List<Column> expected,List<String> selected,int limit){
        Failure.require(limit>=1&&limit<=1000&&!selected.isEmpty()&&selected.size()<=200,"QUERY_LIMIT");
        try(var c=open(config)){
            c.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ);c.setAutoCommit(false);
            try(var s=c.createStatement()){s.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");}
            var actual=columns(c,config.database(),table);
            if(expected.size()!=actual.size())throw new Failure(409,"SCHEMA_CHANGED");
            for(int i=0;i<expected.size();i++)if(!sameDefinition(expected.get(i),actual.get(i)))throw new Failure(409,"SCHEMA_CHANGED");
            var used=actual.stream().filter(x->selected.contains(x.name())).toList();
            if(used.size()!=selected.size())throw new Failure(409,"SCHEMA_CHANGED");
            supported(used);
            String sql="SELECT "+columnSql(selected)+" FROM "+quote(table)+" LIMIT ?";
            try(var s=c.prepareStatement(sql,ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)){
                s.setInt(1,limit);s.setFetchSize(Math.min(limit,500));s.setQueryTimeout(30);
                try(var r=s.executeQuery()){
                    var rows=new ArrayList<Map<String,Object>>();long bytes=0;
                    while(r.next()){
                        var row=row(r,selected.stream().map(n->used.stream().filter(x->x.name().equals(n)).findFirst().orElseThrow()).toList());
                        bytes+=row.entrySet().stream().mapToLong(entry->entry.getKey().length()+(entry.getValue()==null?0:entry.getValue().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length)).sum();
                        if(bytes>10L*1024*1024)throw new Failure(422,"QUERY_RESULT_LIMIT");
                        rows.add(row);
                    }
                    c.rollback();return new QueryResult(used,rows);
                }
            }
        }catch(SQLException e){if("42S22".equals(e.getSQLState())||"42S02".equals(e.getSQLState()))throw new Failure(409,"SCHEMA_CHANGED");throw queryFailure(e);}
    }
    public void scanSql(Connection config,String sql,List<Column> expected,List<String> selected,long maxRows,
            java.util.function.Consumer<Map<String,Object>> consumer,BooleanSupplier canceled){
        Failure.require(maxRows>=1&&maxRows<=1000000&&!selected.isEmpty()&&selected.size()<=200,"VALIDATION_ERROR");
        String statement=ReadOnlySql.validate(sql);
        try(var c=open(config)){
            c.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ);c.setAutoCommit(false);
            try(var s=c.createStatement()){s.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");}
            try(var s=c.prepareStatement(statement,ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)){
                s.setFetchSize(500);s.setQueryTimeout(300);s.setMaxRows((int)maxRows+1);
                var cancelPoll=java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
                cancelPoll.scheduleAtFixedRate(()->{try{if(canceled.getAsBoolean())s.cancel();}catch(Exception ignored){}},1,1,java.util.concurrent.TimeUnit.SECONDS);
                try(var r=s.executeQuery()){
                    var actual=resultColumns(r.getMetaData());
                    if(expected.size()!=actual.size())throw new Failure(409,"SCHEMA_CHANGED");
                    for(int i=0;i<expected.size();i++)if(!sameDefinition(expected.get(i),actual.get(i)))throw new Failure(409,"SCHEMA_CHANGED");
                    var selectedSet=Set.copyOf(selected);
                    if(!actual.stream().map(Column::name).collect(java.util.stream.Collectors.toSet()).containsAll(selectedSet))throw new Failure(409,"SCHEMA_CHANGED");
                    long count=0;long deadline=System.nanoTime()+java.time.Duration.ofMinutes(10).toNanos();
                    while(r.next()){
                        if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");
                        if(++count>maxRows||System.nanoTime()>deadline)throw new Failure(422,"SOURCE_SCAN_LIMIT");
                        consumer.accept(resultRow(r,actual,selectedSet));
                    }
                }finally{cancelPoll.shutdownNow();}
            }c.rollback();
        }catch(SQLException e){if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");throw queryFailure(e);}
    }
    public void scan(Connection config,String table,List<Column> expected,List<String> selected,Consumer<Map<String,Object>> consumer,BooleanSupplier canceled){
        scan(config,table,expected,selected,1000000,consumer,canceled);
    }
    public void scan(Connection config,String table,List<Column> expected,List<String> selected,long maxRows,Consumer<Map<String,Object>> consumer,BooleanSupplier canceled){
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
            for(var col:expected){
                if(!selected.contains(col.name()))continue;
                var current=actual.stream().filter(x->x.name().equals(col.name())).findFirst().orElse(null);
                if(current==null||!sameDefinition(col,current))throw new Failure(409,"SCHEMA_CHANGED");
            }
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
                        if(++count>maxRows||System.nanoTime()>deadline)throw new Failure(422,"SOURCE_SCAN_LIMIT");
                        consumer.accept(row(r,ordered));
                    }
                }finally{cancelPoll.shutdownNow();}
            }c.rollback();
        }catch(SQLException e){if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");if("42S22".equals(e.getSQLState())||"42S02".equals(e.getSQLState()))throw new Failure(409,"SCHEMA_CHANGED");throw connectionFailure(e);}
    }
    private List<Column> resultColumns(ResultSetMetaData metadata)throws SQLException{
        var columns=new ArrayList<Column>();var names=new java.util.HashSet<String>();
        for(int i=1;i<=metadata.getColumnCount();i++){
            String name=metadata.getColumnLabel(i);if(name==null||name.isBlank())name=metadata.getColumnName(i);
            if(name==null||name.isBlank()||name.length()>256||!names.add(name.toLowerCase(java.util.Locale.ROOT)))throw new Failure(422,"SQL_COLUMNS_INVALID");
            int nullable=metadata.isNullable(i);
            String type=metadata.getColumnTypeName(i).toLowerCase(java.util.Locale.ROOT);
            if(Set.of("decimal","numeric").contains(type)&&metadata.getPrecision(i)>0)
                type="decimal("+metadata.getPrecision(i)+","+metadata.getScale(i)+")";
            columns.add(new Column(name,type,metadata.getPrecision(i),metadata.getScale(i),metadata.getColumnDisplaySize(i),nullable!=ResultSetMetaData.columnNoNulls,""));
        }
        if(columns.isEmpty()||columns.size()>200)throw new Failure(422,"SOURCE_CATALOG_LIMIT");return List.copyOf(columns);
    }
    private Map<String,Object> resultRow(ResultSet result,List<Column> columns)throws SQLException{return resultRow(result,columns,columns.stream().map(Column::name).collect(java.util.stream.Collectors.toSet()));}
    private Map<String,Object> resultRow(ResultSet result,List<Column> columns,Set<String> selected)throws SQLException{
        var row=new LinkedHashMap<String,Object>();for(int i=0;i<columns.size();i++){var column=columns.get(i);if(!selected.contains(column.name()))continue;String value=result.getString(i+1);if(value!=null&&value.length()>1048576)throw new Failure(422,"SOURCE_VALUE_LIMIT");row.put(column.name(),value);}return row;
    }
    private Failure queryFailure(SQLException e){
        if(e.getSQLState()!=null&&e.getSQLState().startsWith("42"))return new Failure(422,"SQL_EXECUTION_FAILED");
        if("HYT00".equals(e.getSQLState())||"HYT01".equals(e.getSQLState())||"S1T00".equals(e.getSQLState())||e.getErrorCode()==3024)return new Failure(422,"DATASET_SQL_TIMEOUT");
        return connectionFailure(e);
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
            p.setProperty("characterEncoding","UTF-8");
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
        try(var s=c.prepareStatement("SELECT column_name,column_type,numeric_precision,numeric_scale,character_maximum_length,is_nullable,column_comment FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position")){
            s.setString(1,database);s.setString(2,table);s.setQueryTimeout(15);
            try(var r=s.executeQuery()){while(r.next())columns.add(new Column(r.getString(1),r.getString(2),r.getLong(3),r.getInt(4),r.getLong(5),r.getString(6).equals("YES"),r.getString(7)));}
        }if(columns.isEmpty())throw new Failure(404,"SOURCE_TABLE_MISSING");Failure.require(columns.size()<=200,"SOURCE_CATALOG_LIMIT");return columns;
    }
    private void beginReadOnly(java.sql.Connection connection)throws SQLException{
        connection.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ);
        connection.setAutoCommit(false);
        try(var statement=connection.createStatement()){statement.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");}
    }
    static boolean sameDefinition(Column expected,Column actual){
        return expected.name().equals(actual.name())&&expected.type().equals(actual.type())
                &&expected.precision()==actual.precision()&&expected.scale()==actual.scale()
                &&expected.length()==actual.length()&&expected.nullable()==actual.nullable();
    }
    private void supported(List<Column> columns){for(var c:columns){String base=c.type().toLowerCase(java.util.Locale.ROOT).split("[ (]")[0];if(!TYPES.contains(base)||c.length()>1048576)throw new Failure(422,"SOURCE_TYPE_UNSUPPORTED");}}
    private Map<String,Object> row(ResultSet r,List<Column> columns)throws SQLException{
        var row=new LinkedHashMap<String,Object>();for(int i=0;i<columns.size();i++){String value=r.getString(i+1);if(value!=null&&value.length()>1048576)throw new Failure(422,"SOURCE_VALUE_LIMIT");row.put(columns.get(i).name(),value);}return row;
    }
    private static String columnSql(List<String> columns){return columns.stream().map(MySqlConnector::quote).collect(java.util.stream.Collectors.joining(","));}
    private static String quote(String name){Failure.require(name!=null&&!name.isEmpty()&&name.length()<=64&&name.indexOf(0)<0,"VALIDATION_ERROR");String q=Character.toString(96);return q+name.replace(q,q+q)+q;}
    private Failure connectionFailure(SQLException e){return new Failure(422,"SOURCE_CONNECTION_FAILED");}
}
