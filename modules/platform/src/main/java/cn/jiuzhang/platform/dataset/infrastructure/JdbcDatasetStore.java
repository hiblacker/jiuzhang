package cn.jiuzhang.platform.dataset.infrastructure;
import cn.jiuzhang.platform.dataset.application.DatasetStore;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import cn.jiuzhang.platform.source.domain.SourceConnector.Column;
import com.fasterxml.jackson.core.type.TypeReference;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
@Repository
public class JdbcDatasetStore implements DatasetStore{
 private final JdbcTemplate db;private final TransactionTemplate tx;private final MetadataJson json;
 public JdbcDatasetStore(JdbcTemplate db,TransactionTemplate tx,MetadataJson json){this.db=db;this.tx=tx;this.json=json;}
 public <T>T transaction(Supplier<T> work){return tx.execute(s->work.get());}
 public List<Map<String,Object>> list(){return db.queryForList("SELECT * FROM dataset ORDER BY id DESC").stream().map(this::data).toList();}
 public Map<String,Object> get(String id,boolean lock){var rows=db.queryForList("SELECT * FROM dataset WHERE id=?"+(lock?" FOR UPDATE":""),n(id));if(rows.isEmpty())throw new Failure(404,"NOT_FOUND");return data(rows.getFirst());}
 @SuppressWarnings("unchecked") public Map<String,Object> save(String id,Map<String,Object> input){var d=(Map<String,Object>)input.get("definition");var output=(Map<String,Object>)d.get("output");
  if(id==null)id=db.queryForObject("INSERT INTO dataset(source_id,object_id,name,description,owner_label,tags,definition,target_name) VALUES (?,?,?,?,?,?::jsonb,?::jsonb,?) RETURNING id",Long.class,n(d.get("sourceId").toString()),n(d.get("objectId").toString()),input.get("name"),input.get("description"),input.get("owner"),json.write(input.get("tags")),json.write(d),output.get("table")).toString();
  else db.update("UPDATE dataset SET source_id=?,object_id=?,name=?,description=?,owner_label=?,tags=?::jsonb,definition=?::jsonb,status='draft',updated_at=now() WHERE id=?",n(d.get("sourceId").toString()),n(d.get("objectId").toString()),input.get("name"),input.get("description"),input.get("owner"),json.write(input.get("tags")),json.write(d),n(id));return get(id,false);
 }
 public void delete(String id){db.update("DELETE FROM dataset WHERE id=?",n(id));}
 public List<Map<String,Object>> versions(String id){get(id,false);return db.queryForList("SELECT body FROM dataset_version WHERE dataset_id=? ORDER BY version DESC",n(id)).stream().map(r->json.object(r.get("body"))).toList();}
 public Map<String,Object> version(String id,int v){var rows=db.queryForList("SELECT body FROM dataset_version WHERE dataset_id=? AND version=?",n(id),v);if(rows.isEmpty())throw new Failure(404,"VERSION_NOT_FOUND");return json.object(rows.getFirst().get("body"));}
 public List<Column> columns(String id,int v){return json.read(db.queryForObject("SELECT source_columns::text FROM dataset_version WHERE dataset_id=? AND version=?",String.class,n(id),v),new TypeReference<List<Column>>(){});}
 public String table(String id,int v){return db.queryForObject("SELECT source_table FROM dataset_version WHERE dataset_id=? AND version=?",String.class,n(id),v);}
 public void publish(String id,int v,Map<String,Object> body,String table,List<Column> columns){db.update("INSERT INTO dataset_version(dataset_id,version,body,source_table,source_columns) VALUES (?,?,?::jsonb,?,?::jsonb)",n(id),v,json.write(body),table,json.write(columns));db.update("UPDATE dataset SET published_version=?,status='published',updated_at=now() WHERE id=?",v,n(id));}
 public List<Map<String,Object>> rules(String c){return db.queryForList("SELECT * FROM governance_rule WHERE category=? ORDER BY id DESC",c).stream().map(this::ruleData).toList();}
 public Map<String,Object> rule(String c,String id){var rows=db.queryForList("SELECT * FROM governance_rule WHERE category=? AND id=?",c,n(id));if(rows.isEmpty())throw new Failure(404,"RULE_NOT_FOUND");return ruleData(rows.getFirst());}
 public Map<String,Object> saveRule(String c,String id,Map<String,Object> body){if(id==null)id=db.queryForObject("INSERT INTO governance_rule(category,body) VALUES (?,?::jsonb) RETURNING id",Long.class,c,json.write(body)).toString();else db.update("UPDATE governance_rule SET body=?::jsonb,version=version+1,updated_at=now() WHERE category=? AND id=?",json.write(body),c,n(id));return rule(c,id);}
 public void deleteRule(String c,String id){db.update("DELETE FROM governance_rule WHERE category=? AND id=?",c,n(id));}
 public Map<String,Object> publication(String user,String id,String key){var rows=db.queryForList("SELECT request_hash,body FROM dataset_publication WHERE user_id=? AND dataset_id=? AND idempotency_key=?",n(user),n(id),key);if(rows.isEmpty())return null;return Map.of("hash",rows.getFirst().get("request_hash"),"body",json.object(rows.getFirst().get("body")));}
 public void publication(String user,String id,String key,String hash,Map<String,Object> body){db.update("INSERT INTO dataset_publication(user_id,dataset_id,idempotency_key,request_hash,body) VALUES (?,?,?,?,?::jsonb)",n(user),n(id),key,hash,json.write(body));}
 private Map<String,Object> ruleData(Map<String,Object> r){var m=new LinkedHashMap<>(json.object(r.get("body")));m.put("id",r.get("id").toString());m.put("version",r.get("version"));m.put("updatedAt",((java.sql.Timestamp)r.get("updated_at")).toInstant().toString());return m;}
 private Map<String,Object> data(Map<String,Object> r){var m=new LinkedHashMap<String,Object>();m.put("id",r.get("id").toString());m.put("name",r.get("name"));m.put("description",r.get("description"));m.put("owner",r.get("owner_label"));m.put("tags",json.read(r.get("tags").toString(),new TypeReference<List<String>>(){}));m.put("definition",json.object(r.get("definition")));m.put("status",r.get("status"));m.put("publishedVersion",r.get("published_version"));m.put("updatedAt",((java.sql.Timestamp)r.get("updated_at")).toInstant().toString());m.put("folderId",null);return m;}
 private long n(String id){return IdentityService.numericId(id);}
}
