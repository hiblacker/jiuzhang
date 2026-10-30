package cn.jiuzhang.api;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.application.ExcelSourceService;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/sources/excel-files")
public class ExcelSourceController {
  private final ExcelSourceService service;
  public ExcelSourceController(ExcelSourceService service) { this.service = service; }
  @PostMapping(consumes = "multipart/form-data")
  @ResponseStatus(HttpStatus.CREATED)
  Object upload(@RequestParam("file") MultipartFile file, HttpServletRequest request) throws IOException {
    var user = SessionFilter.session(request).user();
    IdentityService.require(user, "write");
    if (file.getSize() == 0 || file.getSize() > 20971520) throw new Failure(422, "EXCEL_LIMIT");
    return HttpSupport.ok(service.upload(user, file.getOriginalFilename(), file.getBytes(), HttpSupport.requestId(request)), request);
  }
  @PostMapping("/{id}/preview")
  Object preview(@PathVariable String id, @RequestBody Map<String,Object> input, HttpServletRequest request) {
    HttpSupport.fields(input, "sheet", "headerRow");
    if (!(input.get("headerRow") instanceof Number row) || row.doubleValue() != row.intValue())
      throw new Failure(422, "EXCEL_HEADER_INVALID");
    return HttpSupport.ok(service.preview(SessionFilter.session(request).user(), id,
        HttpSupport.string(input, "sheet", true), row.intValue()), request);
  }
  @GetMapping("/{id}")
  Object info(@PathVariable String id,HttpServletRequest request) {
    return HttpSupport.ok(service.info(SessionFilter.session(request).user(),id),request);
  }
}
