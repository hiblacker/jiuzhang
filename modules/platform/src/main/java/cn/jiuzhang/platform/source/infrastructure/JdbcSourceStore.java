package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.source.application.SourceStore;
import cn.jiuzhang.platform.source.domain.SourceConnector.Column;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.identity.application.IdentityService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class JdbcSourceStore implements SourceStore {
    private final JdbcTemplate db;private final TransactionTemplate tx;private final ObjectMapper json;
    public JdbcSourceStore(JdbcTemplate db,TransactionTemplate tx,ObjectMapper json){this.db=db;this.tx=tx;this.json=json;}
    public <T>T transaction(Supplier<T> work){return tx.execute(s->work.get());}
    public List<Source> list(){return db.queryForList("SELECT * FROM source_connection ORDER BY id DESC").stream().map(this::source).toList();}
    public Source get(String id){var rows=db.queryForList("SELECT * FROM source_connection WHERE id=?",IdentityService.numericId(id));if(rows.isEmpty())throw new Failure(404,"NOT_FOUND");return source(rows.getFirst());}
    public Source create(String name,String description,String owner,List<String> tags,Map<String,Object> settings,String username,String creator){
        var id=db.queryForObject("INSERT INTO source_connection(name,description,owner_label,tags,settings,connection_username,created_by) VALUES (?,?,?,?::jsonb,?::jsonb,?,?) RETURNING id",Long.class,name,description,owner,write(tags),write(settings),username,IdentityService.numericId(creator));return get(id.toString());
    }
    public Source update(String id,String name,String description,String owner,List<String> tags,Map<String,Object> settings,String username){
        db.update("UPDATE source_connection SET name=?,description=?,owner_label=?,tags=?::jsonb,settings=?::jsonb,connection_username=?,status='offline',updated_at=now() WHERE id=?",name,description,owner,write(tags),write(settings),username,IdentityService.numericId(id));return get(id);
    }
    public void secret(String id,String encrypted){db.update("INSERT INTO source_secret(source_id,ciphertext) VALUES (?,?) ON CONFLICT(source_id) DO UPDATE SET ciphertext=excluded.ciphertext",IdentityService.numericId(id),encrypted);}
    public String secret(String id){return db.queryForObject("SELECT ciphertext FROM source_secret WHERE source_id=?",String.class,IdentityService.numericId(id));}
    public void status(String id,String status,int objects){db.update("UPDATE source_connection SET status=?,object_count=?,updated_at=now() WHERE id=?",status,objects,IdentityService.numericId(id));}
    public List<SourceObject> objects(String id){return db.queryForList("SELECT * FROM source_object WHERE source_id=? ORDER BY name",IdentityService.numericId(id)).stream().map(r->new SourceObject(r.get("id").toString(),id,(String)r.get("name"),read(r.get("schema_contract").toString(),new TypeReference<List<Column>>(){}))).toList();}
    public void object(String id,String name,List<Column> columns){db.update("INSERT INTO source_object(source_id,name,schema_contract) VALUES (?,?,?::jsonb) ON CONFLICT(source_id,name) DO UPDATE SET schema_contract=excluded.schema_contract,discovered_at=now()",IdentityService.numericId(id),name,write(columns));}
    public void delete(String id){db.update("DELETE FROM source_connection WHERE id=?",IdentityService.numericId(id));}
    private Source source(Map<String,Object> r){return new Source(r.get("id").toString(),(String)r.get("name"),(String)r.get("description"),(String)r.get("owner_label"),read(r.get("tags").toString(),new TypeReference<List<String>>(){}),read(r.get("settings").toString(),new TypeReference<Map<String,Object>>(){}),(String)r.get("connection_username"),(String)r.get("status"),(Integer)r.get("object_count"),((java.sql.Timestamp)r.get("updated_at")).toInstant());}
    private String write(Object value){try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException("Metadata serialization failed");}}
    private <T>T read(String value,TypeReference<T> type){try{return json.readValue(value,type);}catch(Exception e){throw new IllegalStateException("Metadata decoding failed");}}
}
