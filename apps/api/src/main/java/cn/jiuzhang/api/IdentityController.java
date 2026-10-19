package cn.jiuzhang.api;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.Map;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class IdentityController {
    private final IdentityService identity;
    public IdentityController(IdentityService identity) { this.identity=identity; }
    private Map<String,Object> sessionData(IdentityService.Login login) {
        return Map.of("role",login.user().role(),"permissions",login.user().permissions(),"user",login.user(),"csrfToken",login.csrfToken());
    }
    @PostMapping("/auth/login") Object login(@RequestBody Map<String,Object> input,HttpServletRequest request,HttpServletResponse response) {
        HttpSupport.fields(input,"username","password");
        var login=identity.login(HttpSupport.string(input,"username",true),HttpSupport.string(input,"password",true),request.getRemoteAddr(),SessionFilter.cookie(request),HttpSupport.requestId(request));
        cookie(response,login.token(),false); return HttpSupport.ok(sessionData(login),request);
    }
    @GetMapping("/session") Object session(HttpServletRequest request) { return HttpSupport.ok(sessionData(SessionFilter.session(request)),request); }
    @PostMapping("/auth/logout") Object logout(HttpServletRequest request,HttpServletResponse response) {
        identity.logout(SessionFilter.session(request),HttpSupport.requestId(request)); cookie(response,"",true); return HttpSupport.ok(Map.of("message","OK"),request);
    }
    @PostMapping("/auth/password") Object password(@RequestBody Map<String,Object> input,HttpServletRequest request,HttpServletResponse response) {
        HttpSupport.fields(input,"currentPassword","newPassword");
        identity.changePassword(SessionFilter.session(request),HttpSupport.string(input,"currentPassword",true),HttpSupport.string(input,"newPassword",true),HttpSupport.requestId(request));
        cookie(response,"",true); return HttpSupport.ok(Map.of("message","OK"),request);
    }
    @GetMapping("/system/users") Object users(HttpServletRequest request) { return HttpSupport.page(identity.users(SessionFilter.session(request).user()),request); }
    @PostMapping("/system/users") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    Object create(@RequestBody Map<String,Object> input,HttpServletRequest request) { return save(null,input,request); }
    @PatchMapping("/system/users/{id}") Object patch(@PathVariable String id,@RequestBody Map<String,Object> input,HttpServletRequest request) { return save(id,input,request); }
    private Object save(String id,Map<String,Object> input,HttpServletRequest request) {
        IdentityService.require(SessionFilter.session(request).user(),"system");
        HttpSupport.fields(input,"username","name","password","role","enabled");
        Object enabled=input.get("enabled");
        if(input.containsKey("enabled") && !(enabled instanceof Boolean)) throw new Failure(422,"VALIDATION_ERROR");
        var user=identity.saveUser(SessionFilter.session(request).user(),id,HttpSupport.string(input,"username",id==null),
            HttpSupport.string(input,"name",id==null),HttpSupport.string(input,"password",id==null),HttpSupport.string(input,"role",id==null),(Boolean)enabled,HttpSupport.requestId(request));
        return HttpSupport.ok(user,request);
    }
    @GetMapping("/system/audit") Object audit(HttpServletRequest request) { return HttpSupport.page(identity.auditEvents(SessionFilter.session(request).user()),request); }
    @GetMapping("/system/roles") Object roles(HttpServletRequest request) {
        IdentityService.require(SessionFilter.session(request).user(),"system");
        return HttpSupport.ok(java.util.List.of(role("admin",java.util.List.of("read","write","system","readSensitive")),role("developer",java.util.List.of("read","write")),role("viewer",java.util.List.of("read"))),request);
    }
    private Map<String,Object> role(String id,java.util.List<String> permissions) { return Map.of("id",id,"name",id,"permissions",permissions); }
    @GetMapping("/system/settings") Object settings(HttpServletRequest request) { return HttpSupport.ok(Map.of("timezone","Asia/Shanghai","notifications",false),request); }
    private void cookie(HttpServletResponse response,String token,boolean expired) {
        boolean secure=Boolean.parseBoolean(System.getenv().getOrDefault("JIUZHANG_COOKIE_SECURE","false"));
        response.addHeader("Set-Cookie",ResponseCookie.from(SessionFilter.COOKIE,token).path("/api/v1").httpOnly(true).secure(secure).sameSite("Strict").maxAge(expired?Duration.ZERO:Duration.ofHours(8)).build().toString());
    }
    @Component static class Bootstrap implements ApplicationRunner {
        private final IdentityService identity; Bootstrap(IdentityService identity) { this.identity=identity; }
        public void run(ApplicationArguments args) { identity.bootstrap(System.getenv("JIUZHANG_BOOTSTRAP_USER"),System.getenv("JIUZHANG_BOOTSTRAP_PASSWORD")); }
    }
}
