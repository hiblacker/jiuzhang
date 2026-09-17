package com.bydw.api;

import com.bydw.warehouse.ProductAccessService;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BrowserAccountService implements UserDetailsService {
  private final JdbcTemplate jdbc;
  private final ProductAccessService access;
  private final PasswordEncoder encoder;
  public BrowserAccountService(JdbcTemplate jdbc, ProductAccessService access, PasswordEncoder encoder) {
    this.jdbc = jdbc; this.access = access; this.encoder = encoder;
  }
  public static class BrowserUser extends User {
    private final long epoch;
    BrowserUser(String id, String hash, boolean enabled, boolean unlocked, long epoch) {
      super(id, hash, enabled, true, true, unlocked, List.of()); this.epoch = epoch;
    }
    public long epoch() { return epoch; }
  }
  @Override public UserDetails loadUserByUsername(String id) {
    if (id == null || id.length() > 100) throw new UsernameNotFoundException("LOGIN_FAILED");
    var rows = jdbc.queryForList("""
        SELECT a.*, i.enabled, (locked_until IS NULL OR locked_until <= clock_timestamp()) AS unlocked
        FROM warehouse.browser_account a JOIN warehouse.identity i ON i.id = a.identity_id WHERE i.id = ?
        """, id);
    if (rows.isEmpty() || rows.getFirst().get("password_hash") == null) throw new UsernameNotFoundException("LOGIN_FAILED");
    var row = rows.getFirst();
    return new BrowserUser(id, row.get("password_hash").toString(), (boolean) row.get("enabled"),
        (boolean) row.get("unlocked"), ((Number) row.get("credential_epoch")).longValue());
  }
  public String sessionActor(Object principal) {
    if (!(principal instanceof BrowserUser user)) return null;
    var rows = jdbc.queryForList("""
        SELECT a.platform_admin FROM warehouse.browser_account a JOIN warehouse.identity i ON i.id=a.identity_id
        WHERE i.id=? AND i.enabled AND a.credential_epoch=? AND a.password_hash IS NOT NULL
        """, user.getUsername(), user.epoch());
    return rows.isEmpty() ? null : user.getUsername();
  }
  public void loginSucceeded(String id) {
    jdbc.update("UPDATE warehouse.browser_account SET failed_logins=0, locked_until=NULL WHERE identity_id=?", id);
    audit(id, "BROWSER_LOGIN", id);
  }
  public void loginFailed(String id) {
    if (id == null || id.length() > 100) return;
    jdbc.update("""
        UPDATE warehouse.browser_account SET failed_logins=CASE WHEN locked_until <= clock_timestamp() THEN 1 ELSE failed_logins+1 END,
          locked_until=CASE WHEN locked_until <= clock_timestamp() THEN NULL
            WHEN failed_logins >= 4 THEN clock_timestamp()+interval '5 minutes' ELSE locked_until END WHERE identity_id=?
        """, id);
  }
  @Transactional
  public Map<String,Object> invite(String id, String displayName, Long project, String role, boolean admin, String actor) {
    if (project == null || admin) access.requireAdmin(actor); else access.require(project, actor, "OWNER");
    if (id == null || !id.matches("[a-z][a-z0-9_-]{2,63}") || id.startsWith("local-")
        || displayName == null || displayName.isBlank() || displayName.length()>100
        || (project != null && !List.of("OWNER","ENGINEER","VIEWER").contains(role == null ? "" : role))) bad("INVALID_INVITATION");
    if (project != null) access.require(project, actor, "OWNER");
    // Inviting an existing identity must never become a password-reset capability for a project owner.
    if (jdbc.queryForObject("SELECT count(*) FROM warehouse.identity WHERE id=?", Long.class, id)>0) conflict("IDENTITY_EXISTS");
    jdbc.update("INSERT INTO warehouse.identity(id,token_sha256) VALUES (?,?)", id, ProductAccessService.hash(random()));
    jdbc.update("INSERT INTO warehouse.browser_account(identity_id,display_name,platform_admin) VALUES (?,?,?)",id,displayName,admin);
    if (project != null) jdbc.update("INSERT INTO warehouse.project_member(project_id,identity_id,role) VALUES (?,?,?)",project,id,role);
    return invitation(id, actor);
  }
  @Transactional
  public Map<String,Object> reset(String id, String actor) {
    access.requireAdmin(actor);
    if (jdbc.update("UPDATE warehouse.browser_account SET password_hash=NULL,credential_epoch=credential_epoch+1 WHERE identity_id=?",id)!=1) bad("ACCOUNT_NOT_FOUND");
    jdbc.update("UPDATE warehouse.account_invitation SET consumed_at=clock_timestamp() WHERE identity_id=? AND consumed_at IS NULL",id);
    return invitation(id,actor);
  }
  private Map<String,Object> invitation(String id,String actor) {
    String token=random();
    jdbc.update("INSERT INTO warehouse.account_invitation(token_sha256,identity_id,expires_at,created_by) VALUES (?,?,clock_timestamp()+interval '24 hours',?)",ProductAccessService.hash(token),id,actor);
    audit(actor,"ACCOUNT_INVITE",id);
    return Map.of("identity",id,"invitation",token,"expiresInSeconds",86400);
  }
  @Transactional
  public void activate(String token,String password) {
    if (token == null || token.length()!=43 || password==null || password.length()<12 || password.getBytes(StandardCharsets.UTF_8).length>72) bad("INVALID_ACCOUNT_ACTIVATION");
    var rows=jdbc.queryForList("""
        SELECT t.identity_id FROM warehouse.account_invitation t JOIN warehouse.identity i ON i.id=t.identity_id
        WHERE t.token_sha256=? AND t.consumed_at IS NULL AND t.expires_at>clock_timestamp() AND i.enabled FOR UPDATE OF t
        """,ProductAccessService.hash(token));
    if(rows.isEmpty()) bad("INVITATION_EXPIRED");
    String id=rows.getFirst().get("identity_id").toString();
    jdbc.update("UPDATE warehouse.browser_account SET password_hash=?,credential_epoch=credential_epoch+1,failed_logins=0,locked_until=NULL,updated_at=clock_timestamp() WHERE identity_id=?",encoder.encode(password),id);
    jdbc.update("UPDATE warehouse.account_invitation SET consumed_at=clock_timestamp() WHERE identity_id=? AND consumed_at IS NULL",id);
    audit(id,"ACCOUNT_ACTIVATE",id);
  }
  @Transactional public void revokeSessions(String id,String actor) {
    if (!id.equals(actor)) access.requireAdmin(actor);
    jdbc.update("UPDATE warehouse.browser_account SET credential_epoch=credential_epoch+1 WHERE identity_id=?",id);
    audit(actor,"SESSION_REVOKE",id);
  }
  private static String random() {byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);}
  private void audit(String actor,String action,String resource) {jdbc.update("INSERT INTO control.audit_log(principal,action,resource,result,details) VALUES (?,?,?,'SUCCESS','{}'::jsonb)",actor,action,resource);}
  private static void bad(String code) {throw new ApiException(HttpStatus.BAD_REQUEST,code,"账号请求无效");}
  private static void conflict(String code) {throw new ApiException(HttpStatus.CONFLICT,code,"账号已存在，请直接管理项目成员");}
}
