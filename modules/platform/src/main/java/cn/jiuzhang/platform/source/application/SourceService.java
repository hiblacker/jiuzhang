package cn.jiuzhang.platform.source.application;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import cn.jiuzhang.platform.shared.application.Failure;
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
    public SourceService(SourceStore store,SecretVault vault,SourceConnector connector,IdentityService identity){this.store=store;this.vault=vault;this.connector=connector;this.identity=identity;}
    public List<SourceStore.Source> list(User user){IdentityService.require(user,"read");return store.list();}
    public SourceStore.Source get(User user,String id){IdentityService.require(user,"read");return store.get(id);}
    public SourceStore.Source save(User user,String id,Draft draft,String requestId){
        IdentityService.require(user,"write");validate(draft);
        return store.transaction(()->{
            SourceStore.Source old=id==null?null:store.get(id);
            if(old==null&&draft.credentials()==null)throw new Failure(422,"SOURCE_CREDENTIALS_REQUIRED");
            String username=draft.credentials()==null?old.username():draft.credentials().username();
            var saved=old==null?store.create(draft.name(),draft.description(),draft.owner(),draft.tags(),draft.settings(),username,user.id()):
                store.update(id,draft.name(),draft.description(),draft.owner(),draft.tags(),draft.settings(),username);
            if(draft.credentials()!=null)store.secret(saved.id(),vault.seal(saved.id(),draft.credentials().password()));
            identity.audit(user.id(),old==null?"post":"patch","source",saved.id(),requestId);
            return saved;
        });
    }
    public Map<String,Object> test(User user,Draft draft,String credentialSourceId,String requestId){
        IdentityService.require(user,"write");validate(draft);
        Credentials credentials=draft.credentials();
        if(credentials==null&&credentialSourceId!=null){var saved=store.get(credentialSourceId);credentials=new Credentials(saved.username(),vault.open(saved.id(),store.secret(saved.id())));}
        if(credentials==null)throw new Failure(422,"SOURCE_CREDENTIALS_REQUIRED");
        long start=System.nanoTime();connector.test(connection(draft.settings(),credentials));
        return Map.of("success",true,"message","SOURCE_CONNECTION_OK","latencyMs",(System.nanoTime()-start)/1000000);
    }
    public Map<String,Object> testSaved(User user,String id,String requestId){
        IdentityService.require(user,"write");var source=store.get(id);
        long start=System.nanoTime();
        try{connector.test(connection(id));store.status(id,"connected",source.objectCount());}
        catch(Failure e){store.status(id,"offline",source.objectCount());throw e;}
        identity.audit(user.id(),"test","source",id,requestId);
        return Map.of("success",true,"message","SOURCE_CONNECTION_OK","latencyMs",(System.nanoTime()-start)/1000000);
    }
    public List<SourceStore.SourceObject> discover(User user,String id){
        IdentityService.require(user,"read");var source=store.get(id);
        try{
            var found=connector.discover(connection(id));
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
        var rows=connector.preview(connection(id),object.name(),100);
        return Map.of("fields",object.columns().stream().map(SourceService::field).toList(),"rows",rows,"notes",List.of("MySQL · LIMIT 100 · UTC · Decimal/BIGINT are strings"));
    }
    public Connection connection(String id){var source=store.get(id);return connection(source.settings(),new Credentials(source.username(),vault.open(id,store.secret(id))));}
    public void delete(User user,String id,String requestId){IdentityService.require(user,"write");store.transaction(()->{store.get(id);store.delete(id);identity.audit(user.id(),"delete","source",id,requestId);return null;});}
    public static Map<String,Object> field(SourceConnector.Column c){
        var f=new LinkedHashMap<String,Object>();f.put("name",c.name());f.put("target",c.name());f.put("type",c.type());f.put("nullable",c.nullable());f.put("output",true);f.put("sensitive",false);f.put("maskPolicyId","");f.put("description",c.description()==null?"":c.description());return f;
    }
    private Connection connection(Map<String,Object>s,Credentials v){return new Connection((String)s.get("host"),((Number)s.get("port")).intValue(),(String)s.get("database"),(Boolean)s.get("tls"),v.username(),v.password());}
    private void validate(Draft d){
        if(!"MySQL".equals(d.type()))throw new Failure(422,"SOURCE_TYPE_UNSUPPORTED");
        Failure.require(d.name()!=null&&!d.name().isBlank()&&d.name().length()<=120,"VALIDATION_ERROR");
        Failure.require(d.description()!=null&&d.description().length()<=2000&&d.owner()!=null&&!d.owner().isBlank()&&d.owner().length()<=120,"VALIDATION_ERROR");
        Failure.require(d.tags()!=null&&d.tags().size()<=20&&d.tags().stream().allMatch(x->x!=null&&x.length()<=60),"VALIDATION_ERROR");
        var s=d.settings();Failure.require(s!=null&&s.get("host") instanceof String&&s.get("database") instanceof String&&s.get("port") instanceof Number&&s.get("tls") instanceof Boolean,"VALIDATION_ERROR");
        Failure.require(((String)s.get("host")).matches("[a-zA-Z0-9.-]{1,253}")&&((String)s.get("database")).matches("[a-zA-Z0-9_]{1,64}"),"VALIDATION_ERROR");
        double port=((Number)s.get("port")).doubleValue();Failure.require(port==Math.rint(port)&&port>=1&&port<=65535,"VALIDATION_ERROR");
        if(d.credentials()!=null)Failure.require(d.credentials().username()!=null&&!d.credentials().username().isBlank()&&d.credentials().username().length()<=120&&d.credentials().password()!=null&&!d.credentials().password().isEmpty()&&d.credentials().password().length()<=4096,"VALIDATION_ERROR");
    }
}
