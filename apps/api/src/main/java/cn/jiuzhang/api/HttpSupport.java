package cn.jiuzhang.api;

import cn.jiuzhang.platform.shared.application.Failure;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public final class HttpSupport {
    private HttpSupport() {}
    public static String requestId(HttpServletRequest request) {
        Object id = request.getAttribute("requestId");
        if (id == null) { id = UUID.randomUUID().toString(); request.setAttribute("requestId", id); }
        return id.toString();
    }
    public static Map<String,Object> ok(Object data, HttpServletRequest request) {
        return Map.of("data", data, "meta", Map.of("requestId", requestId(request)));
    }
    public static Map<String,Object> page(java.util.List<?> data, HttpServletRequest request) {
        int page = boundedInt(request.getParameter("page"), 1, 1, 1000000);
        int size = boundedInt(request.getParameter("pageSize"), 20, 1, 100);
        long start = (long)(page-1)*size;
        var rows = start >= data.size() ? java.util.List.of() : data.subList((int)start, Math.min((int)start+size,data.size()));
        return Map.of("data", rows, "meta", Map.of("requestId", requestId(request),"page",page,"pageSize",size,"total",data.size()));
    }
    public static int boundedInt(String value, int fallback, int min, int max) {
        try { int n = value == null ? fallback : Integer.parseInt(value); if(n < min || n > max) throw new NumberFormatException(); return n; }
        catch (NumberFormatException e) { throw new Failure(422,"VALIDATION_ERROR"); }
    }
    public static String string(Map<String,Object> input,String key,boolean required) {
        Object value = input.get(key);
        if (value == null && !required && !input.containsKey(key)) return null;
        if (!(value instanceof String)) throw new Failure(422,"VALIDATION_ERROR");
        return (String)value;
    }
    public static void fields(Map<String,Object> input, String... allowed) {
        if (!java.util.Set.of(allowed).containsAll(input.keySet())) throw new Failure(422,"VALIDATION_ERROR");
    }
    public static Map<String,Object> error(String code,String requestId) {
        return Map.of("error",Map.of("code",code,"message",code,"requestId",requestId,"details",java.util.List.of()));
    }
}
