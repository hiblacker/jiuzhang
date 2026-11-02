package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import java.net.InetAddress;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** PostgreSQL source I/O uses its own connection and never the platform metadata transaction. */
@Component
public final class PostgreSqlConnector implements SourceConnector {
    private final int queryTimeoutSeconds;
    private final String rootCertificate;
    private static final Set<String> TYPES=Set.of("smallint","integer","bigint","boolean","char","varchar","text","date","timestamp","timestamp with time zone","uuid","json","jsonb");

    public PostgreSqlConnector(@Value("${JIUZHANG_POSTGRESQL_QUERY_TIMEOUT_SECONDS:300}") int timeout,
                              @Value("${JIUZHANG_POSTGRESQL_SSL_ROOT_CERT:}") String rootCertificate) {
        if(timeout<1||timeout>600)throw new IllegalArgumentException("PostgreSQL query timeout must be 1-600 seconds");
        this.queryTimeoutSeconds=timeout;this.rootCertificate=rootCertificate;
    }
    @Override public String type(){return "PostgreSQL";}

    @Override public void test(Connection config) {
        try(var connection=open(config);var statement=connection.prepareStatement("SELECT has_schema_privilege(current_user,?,'USAGE')")) {
            statement.setString(1,schema(config));statement.setQueryTimeout(10);
            try(var result=statement.executeQuery()){if(!result.next()||!result.getBoolean(1))throw new Failure(422,"SOURCE_SCHEMA_DENIED");}
        }catch(SQLException error){throw failure(error,false);}
    }

    @Override public List<ObjectInfo> discover(Connection config) {
        try(var connection=open(config)) {
            begin(connection);
            var names=new ArrayList<String>();
            try(var statement=connection.prepareStatement("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE' ORDER BY table_name LIMIT 201")) {
                statement.setString(1,schema(config));statement.setQueryTimeout(15);
                try(var result=statement.executeQuery()){while(result.next())names.add(result.getString(1));}
            }
            Failure.require(names.size()<=200,"SOURCE_CATALOG_LIMIT");
            var objects=new ArrayList<ObjectInfo>();
            for(String name:names)objects.add(new ObjectInfo(name,columns(connection,config,name)));
            connection.rollback();return List.copyOf(objects);
        }catch(SQLException error){throw failure(error,false);}
    }

    @Override public List<Map<String,Object>> preview(Connection config,String table,int limit) {
        Failure.require(limit>=1&&limit<=100,"QUERY_LIMIT");
        try(var connection=open(config)) {
            begin(connection);var columns=columns(connection,config,table);supported(columns);
            try(var statement=connection.prepareStatement("SELECT * FROM "+qualified(config,table)+" LIMIT ?",ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)) {
                statement.setInt(1,limit);statement.setFetchSize(Math.min(limit,500));statement.setQueryTimeout(15);
                try(var result=statement.executeQuery()){var rows=readRows(result,columns,limit);connection.rollback();return rows;}
            }
        }catch(SQLException error){throw failure(error,false);}
    }

    @Override public QueryResult query(Connection config,String sql,int limit) {
        Failure.require(limit>=1&&limit<=1000,"QUERY_LIMIT");String validated=ReadOnlySql.validate(sql);
        try(var connection=open(config)) {
            begin(connection);
            try(var statement=connection.prepareStatement(validated,ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)) {
                statement.setMaxRows(limit);statement.setFetchSize(Math.min(limit,500));statement.setQueryTimeout(Math.min(30,queryTimeoutSeconds));
                try(var result=statement.executeQuery()) {
                    var columns=resultColumns(result.getMetaData());supported(columns);
                    var rows=readRows(result,columns,limit);connection.rollback();return new QueryResult(columns,rows);
                }
            }
        }catch(SQLException error){throw failure(error,false);}
    }

    @Override public QueryResult queryTable(Connection config,String table,List<Column> expected,List<String> selected,int limit) {
        Failure.require(limit>=1&&limit<=1000,"QUERY_LIMIT");validateSelection(selected);
        try(var connection=open(config)) {
            begin(connection);var actual=columns(connection,config,table);verify(expected,actual,expected.stream().map(Column::name).toList());
            var used=select(actual,selected);supported(used);
            try(var statement=connection.prepareStatement("SELECT "+projection(selected)+" FROM "+qualified(config,table)+" LIMIT ?",ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)) {
                statement.setInt(1,limit);statement.setFetchSize(Math.min(limit,500));statement.setQueryTimeout(Math.min(30,queryTimeoutSeconds));
                try(var result=statement.executeQuery()){var rows=readRows(result,used,limit);connection.rollback();return new QueryResult(used,rows);}
            }
        }catch(SQLException error){throw failure(error,true);}
    }

    @Override public void scan(Connection config,String table,List<Column> expected,List<String> selected,Consumer<Map<String,Object>> consumer,BooleanSupplier canceled) {
        scan(config,table,expected,selected,1_000_000,consumer,canceled);
    }

    @Override public void scan(Connection config,String table,List<Column> expected,List<String> selected,long maxRows,Consumer<Map<String,Object>> consumer,BooleanSupplier canceled) {
        validateSelection(selected);validateBudget(maxRows);
        try(var connection=open(config)) {
            begin(connection);
            // The metadata SELECT acquires ACCESS SHARE until rollback, so concurrent DDL cannot
            // change the table after validation. Ordinary concurrent writes remain possible.
            var actual=columns(connection,config,table);verify(expected,actual,selected);
            var used=select(actual,selected);supported(used);
            stream(connection,"SELECT "+projection(selected)+" FROM "+qualified(config,table),used,selected,maxRows,consumer,canceled);
            connection.rollback();
        }catch(SQLException error){if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");throw failure(error,true);}
    }

    @Override public void scanSql(Connection config,String sql,List<Column> expected,List<String> selected,long maxRows,Consumer<Map<String,Object>> consumer,BooleanSupplier canceled) {
        validateSelection(selected);validateBudget(maxRows);String validated=ReadOnlySql.validate(sql);
        try(var connection=open(config)) {
            begin(connection);stream(connection,validated,expected,selected,maxRows,consumer,canceled);connection.rollback();
        }catch(SQLException error){if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");throw failure(error,true);}
    }

    private void stream(java.sql.Connection connection,String sql,List<Column> expected,List<String> selected,long maxRows,Consumer<Map<String,Object>> consumer,BooleanSupplier canceled)throws SQLException {
        if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");
        try(var statement=connection.prepareStatement(sql,ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)) {
            statement.setFetchSize(500);statement.setMaxRows((int)maxRows+1);statement.setQueryTimeout(queryTimeoutSeconds);
            var cancelPoll=java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
            cancelPoll.scheduleAtFixedRate(()->{try{if(canceled.getAsBoolean())statement.cancel();}catch(SQLException ignored){}},1,1,java.util.concurrent.TimeUnit.SECONDS);
            try(var result=statement.executeQuery()) {
                var actual=resultColumns(result.getMetaData());verify(expected,actual,selected);supported(select(actual,selected));
                long count=0;long deadline=System.nanoTime()+java.time.Duration.ofMinutes(10).toNanos();
                while(result.next()) {
                    if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");
                    if(++count>maxRows||System.nanoTime()>deadline)throw new Failure(422,"SOURCE_SCAN_LIMIT");
                    consumer.accept(row(result,actual,Set.copyOf(selected)));
                }
            }finally{cancelPoll.shutdownNow();}
        }
    }

    private List<Map<String,Object>> readRows(ResultSet result,List<Column> columns,int limit)throws SQLException {
        var rows=new ArrayList<Map<String,Object>>();long bytes=0;var selected=Set.copyOf(columns.stream().map(Column::name).toList());
        while(rows.size()<limit&&result.next()) {
            var row=row(result,columns,selected);
            for(var entry:row.entrySet())bytes+=entry.getKey().getBytes(StandardCharsets.UTF_8).length+(entry.getValue()==null?0:entry.getValue().toString().getBytes(StandardCharsets.UTF_8).length);
            if(bytes>10L*1024*1024)throw new Failure(422,"QUERY_RESULT_LIMIT");rows.add(row);
        }
        return rows;
    }

    private Map<String,Object> row(ResultSet result,List<Column> columns,Set<String> selected)throws SQLException {
        var row=new LinkedHashMap<String,Object>();
        for(int i=0;i<columns.size();i++) {
            var column=columns.get(i);if(!selected.contains(column.name()))continue;
            String text=result.getString(i+1);Object value=text;
            if(text!=null) {
                if(text.length()>1_048_576)throw new Failure(422,"SOURCE_VALUE_LIMIT");
                value=switch(column.type()) {
                    case "boolean" -> result.getBoolean(i+1);
                    case "date" -> {
                        if(text.contains("infinity"))throw new Failure(422,"SOURCE_COLUMN_TYPE_UNSUPPORTED");
                        yield result.getObject(i+1,java.time.LocalDate.class).toString();
                    }
                    case "timestamp" -> {
                        if(text.contains("infinity"))throw new Failure(422,"SOURCE_COLUMN_TYPE_UNSUPPORTED");
                        yield result.getObject(i+1,java.time.LocalDateTime.class).toString().replace('T',' ');
                    }
                    case "timestamp with time zone" -> {
                        if(text.contains("infinity"))throw new Failure(422,"SOURCE_COLUMN_TYPE_UNSUPPORTED");
                        yield result.getObject(i+1,java.time.OffsetDateTime.class).withOffsetSameInstant(java.time.ZoneOffset.UTC).toLocalDateTime().toString().replace('T',' ');
                    }
                    default -> column.type().startsWith("decimal(")?result.getBigDecimal(i+1).toPlainString():text;
                };
            }
            row.put(column.name(),value);
        }
        return row;
    }

    private List<Column> columns(java.sql.Connection connection,Connection config,String table)throws SQLException {
        List<Column> fields;
        try(var statement=connection.prepareStatement("SELECT * FROM "+qualified(config,table)+" LIMIT 0")) {
            statement.setQueryTimeout(15);try(var result=statement.executeQuery()){fields=resultColumns(result.getMetaData());}
        }
        var descriptions=new LinkedHashMap<String,String>();
        try(var statement=connection.prepareStatement("SELECT a.attname,pg_catalog.col_description(c.oid,a.attnum) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname=? AND c.relname=? AND a.attnum>0 AND NOT a.attisdropped")) {
            statement.setString(1,schema(config));statement.setString(2,table);statement.setQueryTimeout(15);
            try(var result=statement.executeQuery()){while(result.next())descriptions.put(result.getString(1),result.getString(2));}
        }
        return fields.stream().map(c->new Column(c.name(),c.type(),c.precision(),c.scale(),c.length(),c.nullable(),descriptions.getOrDefault(c.name(),""))).toList();
    }

    private List<Column> resultColumns(ResultSetMetaData metadata)throws SQLException {
        Failure.require(metadata.getColumnCount()>0&&metadata.getColumnCount()<=200,"SOURCE_CATALOG_LIMIT");
        var columns=new ArrayList<Column>();var names=new java.util.HashSet<String>();
        for(int i=1;i<=metadata.getColumnCount();i++) {
            String name=metadata.getColumnLabel(i);Failure.require(name!=null&&!name.isBlank()&&name.length()<=256&&names.add(name.toLowerCase(Locale.ROOT)),"SQL_COLUMNS_INVALID");
            String nativeType=metadata.getColumnTypeName(i).toLowerCase(Locale.ROOT);
            String type=switch(nativeType){case "int2"->"smallint";case "int4"->"integer";case "int8"->"bigint";case "bool"->"boolean";case "bpchar"->"char";case "timestamptz"->"timestamp with time zone";default->nativeType;};
            long precision=0,length=0;int scale=0;
            if(nativeType.equals("numeric")||nativeType.equals("decimal")) {
                precision=metadata.getPrecision(i);scale=metadata.getScale(i);type="numeric";
                if(precision>0&&precision<=38&&scale>=0&&scale<=precision)type="decimal("+precision+","+scale+")";
            }else if(type.equals("varchar")||type.equals("char"))length=metadata.getPrecision(i);
            else if(type.startsWith("timestamp"))scale=metadata.getScale(i);
            columns.add(new Column(name,type,precision,scale,length,metadata.isNullable(i)!=ResultSetMetaData.columnNoNulls,""));
        }
        return List.copyOf(columns);
    }

    private void supported(List<Column> columns) {
        for(var column:columns)if(!TYPES.contains(column.type())&&!column.type().matches("decimal\\([1-9][0-9]?,[0-9]{1,2}\\)"))throw new Failure(422,"SOURCE_COLUMN_TYPE_UNSUPPORTED");
    }
    private List<Column> select(List<Column> columns,List<String> selected) {
        return selected.stream().map(name->columns.stream().filter(c->c.name().equals(name)).findFirst().orElseThrow(()->new Failure(409,"SCHEMA_CHANGED"))).toList();
    }
    private void verify(List<Column> expected,List<Column> actual,List<String> selected) {
        for(String name:selected) {
            var old=select(expected,List.of(name)).getFirst();var current=select(actual,List.of(name)).getFirst();
            if(!JdbcSourceConnector.sameDefinition(old,current))throw new Failure(409,"SCHEMA_CHANGED");
        }
    }
    private void validateSelection(List<String> selected){Failure.require(selected!=null&&!selected.isEmpty()&&selected.size()<=200&&Set.copyOf(selected).size()==selected.size(),"VALIDATION_ERROR");}
    private void validateBudget(long maxRows){Failure.require(maxRows>=1&&maxRows<=1_000_000,"VALIDATION_ERROR");}
    static String quote(String identifier) {
        Failure.require(identifier!=null&&!identifier.isBlank()&&identifier.indexOf(0)<0&&identifier.getBytes(StandardCharsets.UTF_8).length<=63,"VALIDATION_ERROR");
        return "\""+identifier.replace("\"","\"\"")+"\"";
    }
    private static String schema(Connection config){return config.schema()==null||config.schema().isBlank()?"public":config.schema();}
    private String qualified(Connection config,String table){return quote(schema(config))+"."+quote(table);}
    private String projection(List<String> columns){return columns.stream().map(PostgreSqlConnector::quote).collect(java.util.stream.Collectors.joining(","));}
    private void begin(java.sql.Connection connection)throws SQLException {
        connection.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ);connection.setReadOnly(true);connection.setAutoCommit(false);
    }

    Properties properties(Connection config,boolean loopback) {
        if(!config.tls()&&!loopback)throw new Failure(422,"SOURCE_TLS_REQUIRED");
        var properties=new Properties();properties.setProperty("user",config.username());properties.setProperty("password",config.password());
        properties.setProperty("sslmode",config.tls()?"verify-full":"disable");
        if(config.tls()&&!rootCertificate.isBlank())properties.setProperty("sslrootcert",rootCertificate);
        properties.setProperty("connectTimeout","5");properties.setProperty("loginTimeout","5");
        properties.setProperty("socketTimeout",Integer.toString(Math.max(330,queryTimeoutSeconds+5)));
        properties.setProperty("cancelSignalTimeout","5");properties.setProperty("readOnlyMode","always");
        properties.setProperty("ApplicationName","jiuzhang-source");
        properties.setProperty("options","-c timezone=UTC -c default_transaction_read_only=on");
        return properties;
    }
    private java.sql.Connection open(Connection config)throws SQLException {
        Failure.require(config.host()!=null&&config.host().matches("[a-zA-Z0-9.-]{1,253}")&&config.port()>0&&config.port()<=65535,"VALIDATION_ERROR");quote(config.database());quote(schema(config));
        try {
            var addresses=InetAddress.getAllByName(config.host());if(addresses.length==0)throw new Failure(422,"SOURCE_CONNECTION_FAILED");
            for(var address:addresses)if(address.isAnyLocalAddress()||address.isMulticastAddress()||address.isLinkLocalAddress())throw new Failure(403,"SOURCE_HOST_DENIED");
            var properties=properties(config,java.util.Arrays.stream(addresses).allMatch(InetAddress::isLoopbackAddress));
            String pinned=java.util.Arrays.stream(addresses).filter(a->a instanceof java.net.Inet4Address).findFirst().orElseThrow(()->new Failure(403,"SOURCE_HOST_DENIED")).getHostAddress();
            String host=config.tls()?config.host():pinned;
            String database=URLEncoder.encode(config.database(),StandardCharsets.UTF_8).replace("+","%20");
            var connection=DriverManager.getConnection("jdbc:postgresql://"+host+":"+config.port()+"/"+database,properties);
            try(var statement=connection.prepareStatement("SELECT pg_catalog.set_config('TimeZone','UTC',false),pg_catalog.set_config('search_path',?,false)")) {
                statement.setString(1,"pg_catalog,"+quote(schema(config))+",pg_temp");statement.setQueryTimeout(10);statement.execute();
                return connection;
            }catch(SQLException|RuntimeException error){try{connection.close();}catch(SQLException ignored){}throw error;}
        }catch(java.net.UnknownHostException error){throw new Failure(422,"SOURCE_CONNECTION_FAILED");}
    }
    private Failure failure(SQLException error,boolean schemaCheck) {
        String state=error.getSQLState();
        if(schemaCheck&&Set.of("42P01","42703").contains(state==null?"":state))return new Failure(409,"SCHEMA_CHANGED");
        if("57014".equals(state)||"55P03".equals(state)||error instanceof java.sql.SQLTimeoutException)return new Failure(422,"DATASET_SQL_TIMEOUT");
        if("3F000".equals(state))return new Failure(422,"SOURCE_SCHEMA_DENIED");
        if(state!=null&&(state.startsWith("42")||state.startsWith("22")||state.equals("25006")))return new Failure(422,"SQL_EXECUTION_FAILED");
        return new Failure(422,"SOURCE_CONNECTION_FAILED");
    }
}
