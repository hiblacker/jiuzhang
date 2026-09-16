package com.bydw.warehouse;

import com.bydw.api.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SystemCatalogService {
  private final JdbcTemplate jdbc;
  private final ProductAccessService access;
  public SystemCatalogService(JdbcTemplate jdbc,ProductAccessService access){this.jdbc=jdbc;this.access=access;}
  @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
  public Object list(long project,String actor,String q,String environment,String lifecycle,int limit,int offset) {
    access.require(project,actor,"VIEWER");page(q,limit,offset);
    if(environment.length()>40||lifecycle.length()>30)bad("INVALID_FILTER");
    String predicate="""
        FROM warehouse.business_system s JOIN warehouse.system_project p ON p.system_id=s.id
        WHERE p.project_id=? AND strpos(lower(s.name||' '||s.code||' '||s.organization||' '||s.business_owner||' '||s.technical_owner),lower(?))>0
        AND (?='' OR s.lifecycle=?) AND (?='' OR EXISTS(SELECT 1 FROM warehouse.system_instance i
          JOIN warehouse.instance_project ip ON ip.instance_id=i.id WHERE i.system_id=s.id AND ip.project_id=? AND i.environment=?))
        """;
    var args=new Object[]{project,q,lifecycle,lifecycle,environment,project,environment};
    long total=jdbc.queryForObject("SELECT count(*) "+predicate,Long.class,args);
    // Counts reflect only instances visible in the selected project.
    String sql="SELECT s.*, (SELECT count(*) FROM warehouse.system_instance i JOIN warehouse.instance_project ip ON ip.instance_id=i.id WHERE i.system_id=s.id AND ip.project_id=?) AS instance_count ";
    var values=new java.util.ArrayList<Object>();values.add(project);values.addAll(List.of(args));values.add(limit);values.add(offset);
    return Map.of("items",jdbc.queryForList(sql+predicate+" ORDER BY s.id LIMIT ? OFFSET ?",values.toArray()),"total",total,"limit",limit,"offset",offset,"scope","CURRENT_PROJECT");
  }
  public Map<String,Object> requireSystem(long project,long system,String actor,String role) {
    access.require(project,actor,role);
    var rows=jdbc.queryForList("SELECT s.* FROM warehouse.business_system s JOIN warehouse.system_project p ON p.system_id=s.id WHERE s.id=? AND p.project_id=?",system,project);
    if(rows.isEmpty())denied();return rows.getFirst();
  }
  public Map<String,Object> requireInstance(long project,long instance,String actor,String role) {
    access.require(project,actor,role);
    var rows=jdbc.queryForList("""
        SELECT i.* FROM warehouse.system_instance i JOIN warehouse.instance_project ip ON ip.instance_id=i.id
        JOIN warehouse.system_project sp ON sp.system_id=i.system_id AND sp.project_id=ip.project_id
        WHERE i.id=? AND ip.project_id=?
        """,instance,project);
    if(rows.isEmpty())denied();return rows.getFirst();
  }
  public Object detail(long project,long system,String actor) {
    var row=requireSystem(project,system,actor,"VIEWER");
    return Map.of("system",row,"instances",jdbc.queryForList("SELECT i.* FROM warehouse.system_instance i JOIN warehouse.instance_project p ON p.instance_id=i.id WHERE i.system_id=? AND p.project_id=? ORDER BY i.id",system,project),"scope","CURRENT_PROJECT");
  }
  @Transactional public Object create(long project,JsonNode body,String actor) {
    access.require(project,actor,"OWNER");String code=code(body,"code");
    var row=jdbc.queryForMap("""
        INSERT INTO warehouse.business_system(code,name,domain,organization,business_owner,technical_owner,description,managing_project_id)
        VALUES (?,?,?,?,?,?,?,?) RETURNING *
        """,code,text(body,"name",100,true),text(body,"domain",100,false),text(body,"organization",100,false),text(body,"businessOwner",100,true),text(body,"technicalOwner",100,true),text(body,"description",2000,false),project);
    jdbc.update("INSERT INTO warehouse.system_project(system_id,project_id) VALUES (?,?)",row.get("id"),project);
    audit(actor,"SYSTEM_CREATE",row.get("id"),Map.of("projectId",project));return row;
  }
  @Transactional public Object update(long project,long system,JsonNode body,String actor) {
    var old=requireSystem(project,system,actor,"OWNER");manage(old,project,actor);
    long expected=body.path("expectedVersion").asLong(-1);
    var rows=jdbc.queryForList("""
        UPDATE warehouse.business_system SET name=?,domain=?,organization=?,business_owner=?,technical_owner=?,description=?,revision=revision+1,updated_at=clock_timestamp()
        WHERE id=? AND revision=? AND lifecycle<>'RETIRED' RETURNING *
        """,text(body,"name",100,true),text(body,"domain",100,false),text(body,"organization",100,false),text(body,"businessOwner",100,true),text(body,"technicalOwner",100,true),text(body,"description",2000,false),system,expected);
    if(rows.isEmpty())conflict("SYSTEM_VERSION_CHANGED");
    audit(actor,"SYSTEM_UPDATE",system,Map.of("previousVersion",expected));return rows.getFirst();
  }
  @Transactional public Object instance(long project,long system,JsonNode body,String actor) {
    var parent=requireSystem(project,system,actor,"OWNER");manage(parent,project,actor);
    if(parent.get("lifecycle").equals("RETIRED"))conflict("SYSTEM_RETIRED");
    var row=jdbc.queryForMap("INSERT INTO warehouse.system_instance(system_id,code,name,environment,purpose) VALUES (?,?,?,?,?) RETURNING *",system,code(body,"code"),text(body,"name",100,true),text(body,"environment",40,true),text(body,"purpose",1000,false));
    jdbc.update("INSERT INTO warehouse.instance_project(instance_id,project_id) VALUES (?,?)",row.get("id"),project);
    audit(actor,"SYSTEM_INSTANCE_CREATE",row.get("id"),Map.of("systemId",system));return row;
  }
  @Transactional public Object share(long project,long system,JsonNode body,String actor) {
    access.requireAdmin(actor);requireSystem(project,system,actor,"OWNER");long target=body.path("projectId").asLong(-1);access.require(target,actor,"OWNER");
    jdbc.update("INSERT INTO warehouse.system_project(system_id,project_id) VALUES (?,?) ON CONFLICT DO NOTHING",system,target);
    for(JsonNode id:body.path("instanceIds")) {
      if(!id.canConvertToLong()||jdbc.queryForObject("SELECT count(*) FROM warehouse.system_instance WHERE id=? AND system_id=?",Long.class,id.asLong(),system)!=1)bad("INSTANCE_NOT_IN_SYSTEM");
      jdbc.update("INSERT INTO warehouse.instance_project(instance_id,project_id) VALUES (?,?) ON CONFLICT DO NOTHING",id.asLong(),target);
    }
    audit(actor,"SYSTEM_SHARE",system,Map.of("projectId",target));return Map.of("shared",true);
  }
  private void manage(Map<String,Object> system,long project,String actor) {
    if(!access.admin(actor)&&((Number)system.get("managing_project_id")).longValue()!=project)denied();
  }
  public void audit(String actor,String action,Object id,Map<String,Object> detail){
    try{jdbc.update("INSERT INTO control.audit_log(principal,action,resource,result,details) VALUES (?,?,?,'SUCCESS',?::jsonb)",actor,action,"system/"+id,new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(detail));}
    catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException(e);}
  }
  public static String code(JsonNode b,String field){String value=text(b,field,100,true);if(!value.matches("[a-z][a-z0-9._-]{1,99}"))bad("INVALID_CODE");return value;}
  public static String text(JsonNode b,String field,int max,boolean required){JsonNode v=b.get(field);if(v!=null&&!v.isTextual())bad("INVALID_FIELD");String s=v==null?"":v.asText().trim();if(s.length()>max||(required&&s.isBlank()))bad("INVALID_FIELD");return s;}
  public static void page(String q,int limit,int offset){if(q.length()>100||limit<1||limit>200||offset<0||offset>1000000)bad("INVALID_PAGE");}
  public static void bad(String code){throw new ApiException(HttpStatus.BAD_REQUEST,code,"请检查输入字段");}
  public static void conflict(String code){throw new ApiException(HttpStatus.CONFLICT,code,"记录已变化，请刷新后重试");}
  public static void denied(){throw new ApiException(HttpStatus.FORBIDDEN,"SYSTEM_ACCESS_DENIED","无权访问此系统或实例");}
}
