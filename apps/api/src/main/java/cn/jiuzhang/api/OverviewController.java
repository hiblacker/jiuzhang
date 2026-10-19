package cn.jiuzhang.api;

import cn.jiuzhang.platform.overview.application.OverviewService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OverviewController {
    private final OverviewService service;
    public OverviewController(OverviewService service) { this.service = service; }

    @GetMapping("/api/v1/overview")
    Object get(HttpServletRequest request) {
        return HttpSupport.ok(service.get(SessionFilter.session(request).user()), request);
    }
}
