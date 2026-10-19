package cn.jiuzhang.platform.identity.application;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/** Identity persistence port; SQL and transaction mechanisms belong to the adapter. */
public interface IdentityStore {
    record Account(IdentityService.User user, String passwordHash) {}
    <T> T transaction(Supplier<T> work);
    void lockAccounts();
    long accountCount();
    long enabledAdminCount();
    Account byUsername(String username);
    Account byId(String id, boolean lock);
    Account create(String username,String name,String hash,String role,boolean enabled);
    Account update(String id,String name,String role,boolean enabled,String hash);
    List<IdentityService.User> users();
    boolean throttled(String subject);
    void failedLogin(String subject);
    void loginSucceeded(String subject,String oldHash,String tokenHash,String userId,String csrf);
    IdentityService.Login authenticate(String tokenHash);
    void deleteSession(String hash);
    void deleteUserSessions(String userId);
    void audit(String actor,String action,String resource,String id,String requestId);
    List<Map<String,Object>> auditEvents();
}
