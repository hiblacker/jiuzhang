package com.bydw.warehouse;

import com.bydw.api.ApiException;
import com.bydw.api.RequestAuthenticationFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/warehouse/catalog")
public class CatalogPageController {
  private final JdbcTemplate jdbc;
  private final ProductAccessService access;
  public CatalogPageController(JdbcTemplate jdbc,ProductAccessService access) {this.jdbc=jdbc;this.access=access;}
  @GetMapping("/projects") @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
  public Object projects(@RequestParam(defaultValue="") String q,@RequestParam(defaultValue="50") int limit,
      @RequestParam(defaultValue="0") int offset,HttpServletRequest request) {
    String actor=actor(request);
    String sql=access.admin(actor)?"SELECT p.*, 'OWNER' AS role FROM warehouse.project p"
        :"SELECT p.*,m.role FROM warehouse.project p JOIN warehouse.project_member m ON m.project_id=p.id JOIN warehouse.identity i ON i.id=m.identity_id WHERE i.enabled AND i.id=?";
    return page(sql,access.admin(actor)?List.of():List.of(actor),"name||' '||code",q,limit,offset);
  }
  @GetMapping("/projects/{project}/{kind}") @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
  public Object objects(@PathVariable long project,@PathVariable String kind,@RequestParam(defaultValue="") String q,
      @RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset,
      @RequestParam(defaultValue="")String systemCode,@RequestParam(defaultValue="")String instanceCode,
      @RequestParam(defaultValue="")String connectionCode,@RequestParam(defaultValue="")String sourceCode,
      @RequestParam(defaultValue="")String state,HttpServletRequest request) {
    access.require(project,actor(request),"VIEWER");
    String sql=switch(kind) {
      case "sources" -> "SELECT s.id,s.code,s.code AS name,s.source_type,s.state,s.created_at FROM control.source_connection s JOIN warehouse.project_source p ON p.source_id=s.id WHERE p.project_id=?";
      case "datasets", "models" -> "SELECT d.*,d.code AS source_code FROM warehouse.dataset d WHERE d.project_id=?";
      case "assets" -> """
          WITH project_scope AS (SELECT ?::bigint AS id)
          SELECT 'mysql:'||o.id AS id,s.code AS source_code,so.object_name AS name,'TABLE' AS kind,
            o.state,o.row_count,o.byte_count,r.id AS run_id,r.scheduled_window_start AS data_window,r.finished_at AS received_at,
            (r.state='COMPLETE' AND o.state='RAW_COMMITTED') AS available
          FROM lake.object_run o JOIN lake.system_run r ON r.id=o.system_run_id JOIN lake.source_object so ON so.id=o.source_object_id
          JOIN control.source_connection s ON s.id=r.source_id JOIN warehouse.project_source ps ON ps.source_id=s.id
          WHERE ps.project_id=(SELECT id FROM project_scope)
          UNION ALL
          SELECT 'external:'||a.id,s.code,a.object_key,a.kind,a.state,a.row_count,a.byte_count,a.execution_id,
            a.business_date::timestamp AT TIME ZONE 'Asia/Shanghai',a.created_at,(a.state='PARSED' AND e.state='COMPLETE')
          FROM warehouse.external_asset a JOIN control.source_connection s ON s.id=a.source_id
          JOIN warehouse.project_source ps ON ps.source_id=s.id JOIN lake.execution_attempt e ON e.id=a.execution_id
          WHERE ps.project_id=(SELECT id FROM project_scope)
          """;
      case "connections" -> """
          SELECT c.id,c.name,c.code,c.instance_id,c.lifecycle,c.revision,c.active_version,r.kind FROM warehouse.ingest_connection c
          JOIN warehouse.connection_project cp ON cp.connection_id=c.id AND cp.enabled JOIN warehouse.ingest_resource r ON r.id=c.resource_id
          JOIN warehouse.resource_project rp ON rp.resource_id=r.id AND rp.project_id=cp.project_id AND rp.enabled
          JOIN warehouse.instance_project ip ON ip.instance_id=c.instance_id AND ip.project_id=cp.project_id
          JOIN warehouse.system_instance i ON i.id=c.instance_id JOIN warehouse.system_project sp ON sp.system_id=i.system_id AND sp.project_id=cp.project_id
          WHERE cp.project_id=? AND r.enabled
          """;
      case "channels" -> """
          SELECT ch.source_id AS id,ch.name,s.code,ch.lifecycle,ch.revision,ch.active_version,c.instance_id,c.id AS connection_id
          FROM warehouse.ingest_channel ch JOIN warehouse.project_source ps ON ps.source_id=ch.source_id
          JOIN control.source_connection s ON s.id=ch.source_id JOIN warehouse.ingest_connection c ON c.id=ch.connection_id
          JOIN warehouse.connection_project cp ON cp.connection_id=c.id AND cp.project_id=ps.project_id AND cp.enabled
          JOIN warehouse.resource_project rp ON rp.resource_id=c.resource_id AND rp.project_id=ps.project_id AND rp.enabled
          JOIN warehouse.instance_project ip ON ip.instance_id=c.instance_id AND ip.project_id=ps.project_id
          JOIN warehouse.system_instance i ON i.id=c.instance_id JOIN warehouse.system_project sp ON sp.system_id=i.system_id AND sp.project_id=ps.project_id
          WHERE ps.project_id=?
          """;
      case "runs" -> """
          SELECT a.id,s.code AS name,s.code AS source_code,a.state,a.error_code,a.created_at,a.started_at,a.finished_at,
            w.business_date,w.id AS window_id,p.id AS plan_id
          FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id
          JOIN lake.ingestion_plan p ON p.id=w.plan_id JOIN control.source_connection s ON s.id=p.source_id
          JOIN warehouse.project_source ps ON ps.source_id=s.id WHERE ps.project_id=?
          """;
      default -> throw new ApiException(HttpStatus.NOT_FOUND,"CATALOG_NOT_FOUND","目录不存在");
    };
    if(List.of("connections","channels","models").contains(kind))access.require(project,actor(request),"ENGINEER");
    var arguments=new ArrayList<Object>();arguments.add(project);
    if(!systemCode.isEmpty()||!instanceCode.isEmpty()||!connectionCode.isEmpty()||!sourceCode.isEmpty()||!state.isEmpty()){
      if(!kind.equals("runs")||List.of(systemCode,instanceCode,connectionCode,sourceCode).stream().anyMatch(code->code.length()>100||!code.isEmpty()&&!code.matches("[a-z][a-z0-9._-]{1,99}"))
          ||!state.isEmpty()&&!List.of("QUEUED","RUNNING","COMPLETE","FAILED","INCOMPLETE","CANCELLED").contains(state))throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_RUN_FILTER","执行筛选条件无效");
      sql="SELECT run.* FROM ("+sql+") run WHERE (?='' OR run.source_code=?) AND (?='' OR run.state=?)";
      arguments.addAll(List.of(sourceCode,sourceCode,state,state));
      if(!systemCode.isEmpty()||!instanceCode.isEmpty()||!connectionCode.isEmpty()){
        sql+="""
             AND EXISTS(SELECT 1 FROM control.source_connection s JOIN warehouse.ingest_channel ch ON ch.source_id=s.id
              JOIN warehouse.ingest_connection c ON c.id=ch.connection_id
              JOIN warehouse.connection_project cp ON cp.connection_id=c.id AND cp.enabled
              JOIN warehouse.resource_project rp ON rp.resource_id=c.resource_id AND rp.project_id=cp.project_id AND rp.enabled
              JOIN warehouse.system_instance i ON i.id=c.instance_id
              JOIN warehouse.instance_project ip ON ip.instance_id=i.id AND ip.project_id=cp.project_id
              JOIN warehouse.business_system bs ON bs.id=i.system_id
              JOIN warehouse.system_project sp ON sp.system_id=bs.id AND sp.project_id=cp.project_id
              WHERE s.code=run.source_code AND cp.project_id=? AND (?='' OR bs.code=?) AND (?='' OR i.code=?) AND (?='' OR c.code=?))
            """;
        arguments.addAll(List.of(project,systemCode,systemCode,instanceCode,instanceCode,connectionCode,connectionCode));
      }
    }
    return page(sql,arguments,kind.equals("assets")?"name||' '||source_code":"name",q,limit,offset);
  }
  private Object page(String sql,List<Object> initial,String field,String q,int limit,int offset) {
    if(q.length()>100||limit<1||limit>200||offset<0||offset>1000000) throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_PAGE","分页参数无效");
    // sql and field are server constants; all caller values remain bind parameters.
    String filtered=" FROM ("+sql+") entries WHERE strpos(lower("+field+"),lower(?))>0";
    var args=new ArrayList<Object>(initial);args.add(q);
    Long total=jdbc.queryForObject("SELECT count(*)"+filtered,Long.class,args.toArray());
    args.add(limit);args.add(offset);
    return Map.of("items",jdbc.queryForList("SELECT *"+filtered+" ORDER BY id LIMIT ? OFFSET ?",args.toArray()),"total",total,"limit",limit,"offset",offset);
  }
  private String actor(HttpServletRequest request) {return (String)request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE);}
}
