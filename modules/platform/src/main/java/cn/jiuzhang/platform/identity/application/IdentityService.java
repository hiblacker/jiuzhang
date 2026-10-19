package cn.jiuzhang.platform.identity.application;

import cn.jiuzhang.platform.shared.application.Failure;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class IdentityService {
    public record User(String id, String username, String name, String role, boolean enabled, Instant updatedAt) {
        public List<String> permissions() {
            return switch (role) {
                case "admin" -> List.of("read", "write", "system", "readSensitive");
                case "developer" -> List.of("read", "write");
                default -> List.of("read");
            };
        }
    }
    public record Login(User user, String token, String csrfToken) {}
    private final IdentityStore store;
    private final Argon2PasswordEncoder passwords = new Argon2PasswordEncoder(16, 32, 1, 19456, 2);
    private final SecureRandom random = new SecureRandom();
    private final String dummy = passwords.encode("timing-defense-not-an-account");

    public IdentityService(IdentityStore store) { this.store = store; }

    public void bootstrap(String username, String password) {
        store.transaction(() -> {
            store.lockAccounts();
            if (store.accountCount() == 0) {
                validUsername(username); validPassword(password);
                store.create(username, username, passwords.encode(password), "admin", true);
            }
            return null;
        });
    }

    public Login login(String username, String password, String remote, String oldToken, String requestId) {
        Failure.require(username != null && !username.isEmpty() && username.length() <= 80 && password != null && password.length() <= 256, "VALIDATION_ERROR");
        String subject = hash(remote + ":" + username);
        if (store.throttled(subject)) throw new Failure(429, "LOGIN_THROTTLED");
        var account = store.byUsername(username);
        boolean matches = passwords.matches(password, account == null ? dummy : account.passwordHash());
        if (!matches || account == null || !account.user().enabled()) {
            store.failedLogin(subject);
            throw new Failure(401, "INVALID_CREDENTIALS");
        }
        String token = token(), csrf = token();
        User user = store.transaction(() -> {
            var latest = store.byId(account.user().id(), true);
            if (!latest.user().enabled() || !latest.passwordHash().equals(account.passwordHash()))
                throw new Failure(401, "INVALID_CREDENTIALS");
            store.loginSucceeded(subject, hash(oldToken == null ? "" : oldToken), hash(token), latest.user().id(), csrf);
            audit(latest.user().id(), "login", "account", latest.user().id(), requestId);
            return latest.user();
        });
        return new Login(user, token, csrf);
    }

    public Login authenticate(String token) {
        if (token == null || token.length() != 43) throw new Failure(401, "UNAUTHENTICATED");
        var session = store.authenticate(hash(token));
        return new Login(session.user(), token, session.csrfToken());
    }

    public void logout(Login login, String requestId) {
        store.transaction(() -> {
            store.deleteSession(hash(login.token()));
            audit(login.user().id(), "logout", "account", login.user().id(), requestId);
            return null;
        });
    }

    public void changePassword(Login login, String current, String next, String requestId) {
        validPassword(next);
        Failure.require(current != null && current.length() <= 256, "VALIDATION_ERROR");
        store.transaction(() -> {
            var actual = store.byId(login.user().id(), true);
            if (!passwords.matches(current, actual.passwordHash())) throw new Failure(401, "INVALID_CREDENTIALS");
            store.update(actual.user().id(), actual.user().name(), actual.user().role(), actual.user().enabled(), passwords.encode(next));
            store.deleteUserSessions(login.user().id());
            audit(login.user().id(), "password_change", "account", login.user().id(), requestId);
            return null;
        });
    }

    public List<User> users(User actor) { require(actor, "system"); return store.users(); }

    public User saveUser(User actor, String id, String username, String name, String password, String role, Boolean enabled, String requestId) {
        require(actor, "system");
        return store.transaction(() -> {
            store.lockAccounts();
            if (id == null) {
                validUsername(username); validPassword(password);
                Failure.require(name != null && !name.isBlank() && name.length() <= 120, "VALIDATION_ERROR");
                validRole(role); Failure.require(enabled != null, "VALIDATION_ERROR");
                var created = store.create(username, name, passwords.encode(password), role, enabled).user();
                audit(actor.id(), "post", "account", created.id(), requestId);
                return created;
            }
            User old = store.byId(id, true).user();
            String finalRole = role == null ? old.role() : role;
            boolean finalEnabled = enabled == null ? old.enabled() : enabled;
            validRole(finalRole);
            if (old.role().equals("admin") && old.enabled() && (!finalRole.equals("admin") || !finalEnabled) && store.enabledAdminCount() <= 1)
                throw new Failure(409, "LAST_ADMIN");
            if (username != null && !username.equals(old.username())) throw new Failure(422, "VALIDATION_ERROR");
            String finalName = name == null ? old.name() : name;
            Failure.require(!finalName.isBlank() && finalName.length() <= 120, "VALIDATION_ERROR");
            if (password != null) validPassword(password);
            var updated = store.update(id, finalName, finalRole, finalEnabled, password == null ? null : passwords.encode(password)).user();
            if (!finalEnabled || !finalRole.equals(old.role()) || password != null) store.deleteUserSessions(id);
            audit(actor.id(), "patch", "account", id, requestId);
            return updated;
        });
    }

    public List<Map<String,Object>> auditEvents(User actor) { require(actor, "system"); return store.auditEvents(); }
    public void audit(String actor, String action, String resource, String id, String requestId) { store.audit(actor, action, resource, id, requestId); }
    public static void require(User actor, String permission) { if (!actor.permissions().contains(permission)) throw new Failure(403, "FORBIDDEN"); }
    public static long numericId(String id) {
        try { long n = Long.parseLong(id); if (n <= 0) throw new NumberFormatException(); return n; }
        catch (RuntimeException e) { throw new Failure(422, "VALIDATION_ERROR"); }
    }
    public static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private String token() { byte[] bytes = new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private void validPassword(String p) { Failure.require(p != null && p.length() >= 12 && p.length() <= 256, "VALIDATION_ERROR"); }
    private void validUsername(String u) { Failure.require(u != null && u.matches("[a-zA-Z0-9_.-]{3,80}"), "VALIDATION_ERROR"); }
    private void validRole(String r) { Failure.require(r != null && List.of("admin", "developer", "viewer").contains(r), "VALIDATION_ERROR"); }
}
