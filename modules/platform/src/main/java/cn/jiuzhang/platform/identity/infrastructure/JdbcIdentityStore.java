package cn.jiuzhang.platform.identity.infrastructure;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityStore;
import cn.jiuzhang.platform.shared.application.Failure;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class JdbcIdentityStore implements IdentityStore {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    public JdbcIdentityStore(JdbcTemplate db,TransactionTemplate tx) { this.db=db;this.tx=tx; }
    public <T> T transaction(Supplier<T> work) { return tx.execute(s -> work.get()); }
    public void lockAccounts() { db.execute("SELECT pg_advisory_xact_lock(723341)"); }
    public long accountCount() { return db.queryForObject("SELECT count(*) FROM account",Long.class); }
    public long enabledAdminCount() { return db.queryForObject("SELECT count(*) FROM account WHERE role='admin' AND enabled",Long.class); }
    public Account byUsername(String username) { return find("SELECT * FROM account WHERE username=?",username); }
    public Account byId(String id,boolean lock) {
        var a=find("SELECT * FROM account WHERE id=?"+(lock?" FOR UPDATE":""),IdentityService.numericId(id));
        if(a==null)throw new Failure(404,"NOT_FOUND");return a;
    }
    private Account find(String sql,Object... args) {
        var rows=db.queryForList(sql,args);if(rows.isEmpty())return null;var r=rows.getFirst();
        return new Account(user(r),(String)r.get("password_hash"));
    }
    public Account create(String username,String name,String hash,String role,boolean enabled) {
        Long id=db.queryForObject("INSERT INTO account(username,display_name,password_hash,role,enabled) VALUES (?,?,?,?,?) RETURNING id",Long.class,username,name,hash,role,enabled);
        return byId(id.toString(),false);
    }
    public Account update(String id,String name,String role,boolean enabled,String hash) {
        db.update("UPDATE account SET display_name=?,role=?,enabled=?,password_hash=coalesce(?,password_hash),updated_at=now() WHERE id=?",name,role,enabled,hash,IdentityService.numericId(id));
        return byId(id,false);
    }
    public List<IdentityService.User> users() { return db.queryForList("SELECT * FROM account ORDER BY id").stream().map(this::user).toList(); }
    public boolean throttled(String subject) { return db.queryForObject("SELECT count(*) FROM login_throttle WHERE subject_hash=? AND blocked_until>now()",Long.class,subject)>0; }
    public void failedLogin(String subject) {
        db.update("INSERT INTO login_throttle(subject_hash,failures,blocked_until,window_start) VALUES (?,1,now(),now()) ON CONFLICT(subject_hash) DO UPDATE SET failures=CASE WHEN login_throttle.window_start < now()-interval '15 minutes' THEN 1 ELSE login_throttle.failures+1 END, window_start=CASE WHEN login_throttle.window_start < now()-interval '15 minutes' THEN now() ELSE login_throttle.window_start END, blocked_until=CASE WHEN login_throttle.failures>=4 AND login_throttle.window_start>=now()-interval '15 minutes' THEN now()+interval '15 minutes' ELSE now() END",subject);
    }
    public void loginSucceeded(String subject,String oldHash,String tokenHash,String userId,String csrf) {
        db.update("DELETE FROM account_session WHERE token_hash=? OR expires_at<now() OR last_seen<now()-interval '30 minutes'",oldHash);
        db.update("DELETE FROM login_throttle WHERE subject_hash=? OR window_start<now()-interval '1 day'",subject);
        db.update("INSERT INTO account_session(token_hash,user_id,csrf_hash,csrf_token,expires_at,last_seen) VALUES (?,?,?,?,now()+interval '8 hours',now())",tokenHash,IdentityService.numericId(userId),IdentityService.hash(csrf),csrf);
    }
    public IdentityService.Login authenticate(String hash) {
        var rows=db.queryForList("UPDATE account_session s SET last_seen=now() FROM account a WHERE s.user_id=a.id AND s.token_hash=? AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes' AND a.enabled RETURNING a.*,s.csrf_token",hash);
        if(rows.isEmpty())throw new Failure(401,"UNAUTHENTICATED");return new IdentityService.Login(user(rows.getFirst()),"",(String)rows.getFirst().get("csrf_token"));
    }
    public void deleteSession(String hash) { db.update("DELETE FROM account_session WHERE token_hash=?",hash); }
    public void deleteUserSessions(String id) { db.update("DELETE FROM account_session WHERE user_id=?",IdentityService.numericId(id)); }
    public void audit(String actor,String action,String resource,String id,String requestId) { db.update("INSERT INTO audit_event(actor_id,action,resource_type,resource_id,request_id) VALUES (?,?,?,?,?)",IdentityService.numericId(actor),action,resource,id,requestId); }
    public List<Map<String,Object>> auditEvents() {
        return db.queryForList("SELECT e.id::text AS id,coalesce(a.display_name,'system') AS actor,e.action,e.resource_type AS resource,e.resource_id AS \"resourceId\",e.created_at AS at,'' AS detail FROM audit_event e LEFT JOIN account a ON e.actor_id=a.id ORDER BY e.id DESC LIMIT 500");
    }
    private IdentityService.User user(Map<String,Object> r) { return new IdentityService.User(r.get("id").toString(),(String)r.get("username"),(String)r.get("display_name"),(String)r.get("role"),(boolean)r.get("enabled"),((java.sql.Timestamp)r.get("updated_at")).toInstant()); }
}
