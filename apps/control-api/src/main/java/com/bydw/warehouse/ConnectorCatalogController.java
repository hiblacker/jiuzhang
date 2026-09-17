package com.bydw.warehouse;

import com.bydw.api.RequestAuthenticationFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Only capabilities backed by the checked-in adapters may be enabled. Templates contain declarations only. */
@RestController
@RequestMapping("/api/v1/warehouse/projects/{project}/connectors")
public class ConnectorCatalogController {
  private final ProductAccessService access;
  public ConnectorCatalogController(ProductAccessService access){this.access=access;}
  @GetMapping public Object list(@PathVariable long project,HttpServletRequest request){
    access.require(project,(String)request.getAttribute(RequestAuthenticationFilter.PRINCIPAL_ATTRIBUTE),"ENGINEER");
    return List.of(
      Map.of("kind","MYSQL_SNAPSHOT","version","1.0.0","protocol",2,"status","APPROVED","name","MySQL 整库快照",
        "capabilities",List.of("只读整库事务快照","元数据发现","显式表范围","原始类型及精度保留"),
        "limitations",List.of("基础表；不把视图当作表抽取","当前态不能补造历史","不包含 CDC"),"template",Map.of()),
      Map.of("kind","FILE_SCAN","version","1.0.0","protocol",2,"status","APPROVED","name","结构化文件目录",
        "capabilities",List.of("CSV","xlsx","JSON","Parquet","固定文件集 / 清单 / 事件交付"),
        "limitations",List.of("已授权目录及相对路径","不包含 OCR 或传输工具","首批交付日历使用 Asia/Shanghai"),
        "template",Map.of("relativeDirectory","","datePartitioned",true,"delivery",Map.of("version",1,"mode","DAILY_SET","readiness","DONE","expectedFiles",List.of("data.csv"),"allowEmpty",false))),
      Map.of("kind","REST_PULL","version","1.0.0","protocol",2,"status","APPROVED","name","REST 拉取",
        "capabilities",List.of("GET","页码 / 偏移 / 游标 / next-link","精确 JSON 原件","共享请求速率"),
        "limitations",List.of("固定允许的主机及路径","不跨目标转发认证","首批交付日历使用 Asia/Shanghai"),
        "template",Map.of("path","/records","pagination",Map.of("mode","page","records_path","data","page_size",100,"max_pages",1000)))) ;
  }
}
