package cn.jiuzhang.api;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class SessionFilter extends OncePerRequestFilter {
    public static final String COOKIE = "JZ_SESSION";
    private final IdentityService identity;
    private final ObjectMapper json;
    public SessionFilter(IdentityService identity,ObjectMapper json) { this.identity=identity; this.json=json; }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) { return !request.getRequestURI().startsWith("/api/v1/"); }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        String requestId=HttpSupport.requestId(request);
        response.setHeader("X-Request-ID",requestId); response.setHeader("Cache-Control","no-store");
        response.setHeader("X-Content-Type-Options","nosniff");
        try {
            boolean write=!List.of("GET","HEAD","OPTIONS").contains(request.getMethod());
            if(write) validateOrigin(request);
            if(request.getRequestURI().equals("/api/v1/auth/login") && request.getMethod().equals("POST")) { chain.doFilter(request,response); return; }
            var session=identity.authenticate(cookie(request)); request.setAttribute("identity",session);
            if(write) {
                String csrf=request.getHeader("X-CSRF-Token");
                if(csrf==null || !MessageDigest.isEqual(csrf.getBytes(StandardCharsets.UTF_8),session.csrfToken().getBytes(StandardCharsets.UTF_8))) throw new Failure(403,"CSRF_REJECTED");
            }
            chain.doFilter(request,response);
        } catch(Failure error) {
            response.setStatus(error.status); response.setContentType("application/json;charset=UTF-8");
            json.writeValue(response.getOutputStream(),HttpSupport.error(error.code,requestId));
        }
    }
    private void validateOrigin(HttpServletRequest request) {
        String origin=request.getHeader("Origin"), site=request.getHeader("Sec-Fetch-Site");
        if("cross-site".equals(site)) throw new Failure(403,"CSRF_REJECTED");
        if(origin==null) return;
        try {
            URI url=URI.create(origin);
            String allowed=System.getenv().getOrDefault("JIUZHANG_BROWSER_ORIGIN","http://localhost:5175");
            String host=request.getScheme()+"://"+request.getHeader("Host");
            if(!origin.equals(allowed) && !origin.equals(host)) throw new Failure(403,"CSRF_REJECTED");
            if(url.getUserInfo()!=null) throw new Failure(403,"CSRF_REJECTED");
        } catch(IllegalArgumentException e) { throw new Failure(403,"CSRF_REJECTED"); }
    }
    public static String cookie(HttpServletRequest request) {
        if(request.getCookies()!=null) for(Cookie cookie:request.getCookies()) if(cookie.getName().equals(COOKIE)) return cookie.getValue();
        return null;
    }
    public static IdentityService.Login session(HttpServletRequest request) {
        var login=(IdentityService.Login)request.getAttribute("identity");
        if(login==null) throw new Failure(401,"UNAUTHENTICATED"); return login;
    }
}
