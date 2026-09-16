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
    return page(sql,access.admin(actor)?List.of():List.of(actor),"name",q,limit,offset);
  }
  @GetMapping("/projects/{project}/{kind}") @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
  public Object objects(@PathVariable long project,@PathVariable String kind,@RequestParam(defaultValue="") String q,
      @RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset,HttpServletRequest request) {
    access.require(project,actor(request),"VIEWER");
    String sql=switch(kind) {
      case "sources" -> "SELECT s.id,s.code,s.code AS name,s.source_type,s.state,s.created_at FROM control.source_connection s JOIN warehouse.project_source p ON p.source_id=s.id WHERE p.project_id=?";
      case "datasets" -> "SELECT d.*,d.code AS source_code FROM warehouse.dataset d WHERE d.project_id=?";
      case "runs" -> """
          SELECT a.id,s.code AS name,s.code AS source_code,a.state,a.error_code,a.created_at,a.started_at,a.finished_at,
            w.business_date,w.id AS window_id,p.id AS plan_id
          FROM lake.execution_attempt a JOIN lake.execution_window w ON w.id=a.window_id
          JOIN lake.ingestion_plan p ON p.id=w.plan_id JOIN control.source_connection s ON s.id=p.source_id
          JOIN warehouse.project_source ps ON ps.source_id=s.id WHERE ps.project_id=?
          """;
      default -> throw new ApiException(HttpStatus.NOT_FOUND,"CATALOG_NOT_FOUND","目录不存在");
    };
    return page(sql,List.of(project),"name",q,limit,offset);
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
