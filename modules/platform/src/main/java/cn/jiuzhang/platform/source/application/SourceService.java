package cn.jiuzhang.platform.source.application;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.application.JsonWriter;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import cn.jiuzhang.platform.source.domain.SourceConnector.Connection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class SourceService {
    public record Credentials(String username,String password) {
        @Override public String toString(){return "Credentials[REDACTED]";}
    }
    public record Draft(String name,String description,String owner,List<String> tags,String type,
                        Map<String,Object> settings,Credentials credentials) {
        @Override public String toString(){return "SourceDraft[REDACTED]";}
    }
    private final SourceStore store;private final SecretVault vault;private final SourceConnector connector;
    private final IdentityService identity;
    private final ExcelSourceService excel;
    private final JsonWriter json;
    public SourceService(SourceStore store,SecretVault vault,SourceConnector connector,IdentityService identity,ExcelSourceService excel,JsonWriter json){this.store=store;this.vault=vault;this.connector=connector;this.identity=identity;this.excel=excel;this.json=json;}
    public List<SourceStore.Source> list(User user){IdentityService.require(user,"read");return store.list();}
    public SourceStore.Source get(User user,String id){IdentityService.require(user,"read");return store.get(id);}
    public SourceStore.Source save(User user,String id,Draft draft,String requestId){
        IdentityService.require(user,"write");
        var previous=id==null?null:store.get(id);
        if(previous!=null&&!previous.type().equals(draft.type()))throw new Failure(409,"SOURCE_TYPE_IMMUTABLE");
        validate(draft);
        if(draft.type().equals("Excel"))excel.validate(user,draft.settings(),previous);
        return store.transaction(()->{
            SourceStore.Source old=id==null?null:store.get(id);
            if(draft.type().equals("MySQL")&&old==null&&draft.credentials()==null)throw new Failure(422,"SOURCE_CREDENTIALS_REQUIRED");
            String username=draft.type().equals("Excel")?"":draft.credentials()==null?old.username():draft.credentials().username();
            var saved=old==null?store.create(draft.name(),draft.description(),draft.owner(),draft.tags(),draft.type(),draft.settings(),username,user.id()):
                store.update(id,draft.name(),draft.description(),draft.owner(),draft.tags(),draft.type(),draft.settings(),username);
            if(draft.credentials()!=null)store.secret(saved.id(),vault.seal(saved.id(),draft.credentials().password()));
            identity.audit(user.id(),old==null?"post":"patch","source",saved.id(),requestId);
            return saved;
        });
    }
    public Map<String,Object> test(User user,Draft draft,String credentialSourceId,String requestId){
        IdentityService.require(user,"write");validate(draft);
        if(draft.type().equals("Excel")){excel.validate(user,draft.settings(),credentialSourceId==null?null:store.get(credentialSourceId));return Map.of("success",true,"message","SOURCE_FILE_OK","latencyMs",0);}
        Credentials credentials=draft.credentials();
        if(credentials==null&&credentialSourceId!=null){var saved=store.get(credentialSourceId);credentials=new Credentials(saved.username(),vault.open(saved.id(),store.secret(saved.id())));}
        if(credentials==null)throw new Failure(422,"SOURCE_CREDENTIALS_REQUIRED");
        long start=System.nanoTime();connector.test(connection(draft.settings(),credentials));
        return Map.of("success",true,"message","SOURCE_CONNECTION_OK","latencyMs",(System.nanoTime()-start)/1000000);
    }
    public Map<String,Object> testSaved(User user,String id,String requestId){
        IdentityService.require(user,"write");var source=store.get(id);
        long start=System.nanoTime();
        try{if(source.type().equals("Excel"))excel.table(source.settings());else connector.test(connection(id));store.status(id,"connected",source.objectCount());}
        catch(Failure e){store.status(id,"offline",source.objectCount());throw e;}
        identity.audit(user.id(),"test","source",id,requestId);
        return Map.of("success",true,"message","SOURCE_CONNECTION_OK","latencyMs",(System.nanoTime()-start)/1000000);
    }
    public List<SourceStore.SourceObject> discover(User user,String id){
        IdentityService.require(user,"read");var source=store.get(id);
        try{
            var found=source.type().equals("Excel")?List.of(new SourceConnector.ObjectInfo(source.settings().get("sheet").toString(),excel.table(source.settings()).columns())):connector.discover(connection(id));
            store.transaction(()->{for(var item:found)store.object(id,item.name(),item.columns());store.status(id,"connected",found.size());return null;});
            var names=found.stream().map(SourceConnector.ObjectInfo::name).collect(java.util.stream.Collectors.toSet());
            return store.objects(id).stream().filter(x->names.contains(x.name())).toList();
        }catch(Failure e){store.status(id,"offline",source.objectCount());throw e;}
    }
    public SourceStore.SourceObject object(User user,String sourceId,String objectId){
        return discover(user,sourceId).stream().filter(x->x.id().equals(objectId)).findFirst().orElseThrow(()->new Failure(404,"SOURCE_TABLE_MISSING"));
    }
    public Map<String,Object> preview(User user,String id,String objectId){
        IdentityService.require(user,"readSensitive");var object=object(user,id,objectId);
        var rows=queryTable(id,object.name(),object.columns(),object.columns().stream().map(SourceConnector.Column::name).toList(),100,()->false);
        if(json.write(rows).getBytes(java.nio.charset.StandardCharsets.UTF_8).length>10*1024*1024)throw new Failure(422,"QUERY_RESULT_LIMIT");
        return Map.of("fields",object.columns().stream().map(SourceService::field).toList(),"rows",rows,"notes",List.of("SOURCE_SAMPLE_LIMIT_100"));
    }
    public SourceConnector.QueryResult previewSql(User user,String id,String sql){
        IdentityService.require(user,"readSensitive");requireSql(id);return connector.query(connection(id),sql,100);
    }
    public SourceConnector.QueryResult querySql(User user,String id,String sql,int limit){
        IdentityService.require(user,"readSensitive");requireSql(id);return connector.query(connection(id),sql,limit);
    }
    public void scanSql(String id,String sql,List<SourceConnector.Column> expected,List<String> selected,long maxRows,
                        java.util.function.Consumer<Map<String,Object>> consumer,java.util.function.BooleanSupplier canceled){
        requireSql(id);connector.scanSql(connection(id),sql,expected,selected,maxRows,consumer,canceled);
    }
    public List<Map<String,Object>> queryTable(String sourceId,String table,List<SourceConnector.Column> expected,
                                               List<String> selected,long limit,
                                               java.util.function.BooleanSupplier canceled){
        return queryTable(sourceId,table,expected,selected,limit,canceled,null);
    }
    public Connection connection(String id){var source=store.get(id);return connection(source.settings(),new Credentials(source.username(),vault.open(id,store.secret(id))));}
    public SourceStore.SourceObject publicationObject(User user,SourceStore.Source source,String objectId){
        IdentityService.require(user,"read");
        if(!source.type().equals("Excel"))return object(user,source.id(),objectId);
        String sheet=source.settings().get("sheet").toString();
        var object=store.objects(source.id()).stream().filter(item->item.id().equals(objectId)&&item.name().equals(sheet)).findFirst().orElseThrow(()->new Failure(404,"SOURCE_TABLE_MISSING"));
        return new SourceStore.SourceObject(object.id(),source.id(),sheet,excel.table(source.settings()).columns());
    }
    public List<Map<String,Object>> queryTable(String id,String table,List<SourceConnector.Column> expected,List<String> selected,long limit,java.util.function.BooleanSupplier canceled,Map<String,Object> fileSnapshot){
        if(fileSnapshot==null&&!store.get(id).type().equals("Excel"))return connector.queryTable(connection(id),table,expected,selected,(int)limit).rows();
        var result=excel.table(fileSnapshot==null?store.get(id).settings():fileSnapshot);
        verifyExcelSchema(expected,result.columns(),selected);
        return result.rows().stream().limit(limit).map(row->{var values=new LinkedHashMap<String,Object>();selected.forEach(key->values.put(key,row.get(key)));return (Map<String,Object>)values;}).toList();
    }
    public void scan(String id,String table,List<SourceConnector.Column> expected,List<String> selected,java.util.function.Consumer<Map<String,Object>> consumer,java.util.function.BooleanSupplier canceled,Map<String,Object> fileSnapshot){
        if(fileSnapshot==null&&!store.get(id).type().equals("Excel")){connector.scan(connection(id),table,expected,selected,consumer,canceled);return;}
        for(var row:queryTable(id,table,expected,selected,100_000,canceled,fileSnapshot)){if(canceled.getAsBoolean())throw new Failure(409,"RUN_CANCELED");consumer.accept(row);}
    }
    private void requireSql(String id){if(!store.get(id).type().equals("MySQL"))throw new Failure(422,"SOURCE_SQL_UNSUPPORTED");}
    private void verifyExcelSchema(List<SourceConnector.Column> expected,List<SourceConnector.Column> actual,List<String> selected){for(String name:selected){var old=expected.stream().filter(c->c.name().equals(name)).findFirst();var current=actual.stream().filter(c->c.name().equals(name)).findFirst();if(old.isEmpty()||current.isEmpty()||!old.get().equals(current.get()))throw new Failure(409,"SCHEMA_CHANGED");}}
    public void delete(User user,String id,String requestId){IdentityService.require(user,"write");store.transaction(()->{store.get(id);store.delete(id);identity.audit(user.id(),"delete","source",id,requestId);return null;});}
    public static Map<String,Object> field(SourceConnector.Column c){
        var f=new LinkedHashMap<String,Object>();f.put("name",c.name());f.put("target",c.name().matches("[a-zA-Z_][a-zA-Z0-9_]{0,63}")?c.name():"field_"+IdentityService.hash(c.name()).substring(0,16));f.put("type",c.type());f.put("nullable",c.nullable());f.put("output",true);f.put("sensitive",false);f.put("maskPolicyId","");f.put("description",c.description()==null?"":c.description());return f;
    }
    private Connection connection(Map<String,Object>s,Credentials v){return new Connection((String)s.get("host"),((Number)s.get("port")).intValue(),(String)s.get("database"),(Boolean)s.get("tls"),v.username(),v.password());}
    private void validate(Draft d){
        if(!java.util.Set.of("MySQL","Excel").contains(d.type()))throw new Failure(422,"SOURCE_TYPE_UNSUPPORTED");
        Failure.require(d.name()!=null&&!d.name().isBlank()&&d.name().length()<=120,"VALIDATION_ERROR");
        Failure.require(d.description()!=null&&d.description().length()<=2000&&d.owner()!=null&&!d.owner().isBlank()&&d.owner().length()<=120,"VALIDATION_ERROR");
        Failure.require(d.tags()!=null&&d.tags().size()<=20&&d.tags().stream().allMatch(x->x!=null&&x.length()<=60),"VALIDATION_ERROR");
        if(d.type().equals("Excel")){Failure.require(d.settings()!=null&&d.credentials()==null,"EXCEL_SETTINGS_INVALID");return;}
        var s=d.settings();Failure.require(s!=null&&s.get("host") instanceof String&&s.get("database") instanceof String&&s.get("port") instanceof Number&&s.get("tls") instanceof Boolean,"VALIDATION_ERROR");
        Failure.require(((String)s.get("host")).matches("[a-zA-Z0-9.-]{1,253}")&&((String)s.get("database")).matches("[a-zA-Z0-9_]{1,64}"),"VALIDATION_ERROR");
        double port=((Number)s.get("port")).doubleValue();Failure.require(port==Math.rint(port)&&port>=1&&port<=65535,"VALIDATION_ERROR");
        if(d.credentials()!=null)Failure.require(d.credentials().username()!=null&&!d.credentials().username().isBlank()&&d.credentials().username().length()<=120&&d.credentials().password()!=null&&!d.credentials().password().isEmpty()&&d.credentials().password().length()<=4096,"VALIDATION_ERROR");
    }
}
