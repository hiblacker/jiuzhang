import cn.jiuzhang.platform.execution.infrastructure.JdbcRunStore;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import cn.jiuzhang.platform.task.infrastructure.JdbcTaskStore;
import cn.jiuzhang.worker.ScheduleDispatcher;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;

/** Real PostgreSQL regression: no engine/source I/O and no changes to the running stack. */
class SchedulingAtomicAcceptance {
  static final MetadataJson JSON = new MetadataJson(new ObjectMapper());
  static Map<String,Object> schedule(int minutes) {
    return Map.of("mode","interval","cron","* * * * *","intervalMinutes",minutes,
        "timezone","Asia/Shanghai","retries",0,"timeoutSeconds",30,"concurrency",1,"dependencies",List.of());
  }
  static void require(boolean value,String message) { if(!value)throw new AssertionError(message); }
  public static void main(String[] args) throws Exception {
    String configured=System.getenv().getOrDefault("METADATA_URL","jdbc:postgresql://127.0.0.1:15432/jiuzhang");
    String user=System.getenv().getOrDefault("METADATA_USER","jiuzhang"), password=System.getenv("METADATA_PASSWORD");
    String base=configured.split("\\?",2)[0], query=configured.contains("?")?configured.substring(configured.indexOf('?')):"";
    String database="jz_schedule_"+UUID.randomUUID().toString().replace("-","").substring(0,12);
    String url=base.substring(0,base.lastIndexOf('/')+1)+database+query;
    var failures=new ArrayList<String>();
    try(var admin=DriverManager.getConnection(configured,user,password);var statement=admin.createStatement()) {
      statement.execute("CREATE DATABASE "+database);
      try {
        Flyway.configure().dataSource(url,user,password).locations("classpath:db/migration").load().migrate();
        var dataSource=new DriverManagerDataSource(url,user,password);
        var db=new JdbcTemplate(dataSource);
        var tx=new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        var tasks=new JdbcTaskStore(db,tx,JSON);
        var runs=new JdbcRunStore(db,tx,JSON);
        var dispatcher=new ScheduleDispatcher(tasks,runs);
        db.update("INSERT INTO account(username,display_name,password_hash,role) VALUES('schedule_probe','synthetic','not-a-login-hash','admin')");
        db.update("INSERT INTO source_connection(name,owner_label,created_by,settings,connection_username) VALUES('synthetic','test',1,'{}','reader')");
        db.update("INSERT INTO source_object(source_id,name,schema_contract) VALUES(1,'synthetic','[]')");
        var definition=Map.of("deliveryMode","warehouse","schedule",schedule(1));
        db.update("INSERT INTO dataset(source_id,object_id,name,owner_label,definition,target_name,published_version) VALUES(1,1,'schedule_probe','test',?::jsonb,'schedule_probe',1)",JSON.write(definition));
        db.update("INSERT INTO dataset_version(dataset_id,version,body,source_table,source_columns) VALUES(1,1,?::jsonb,'synthetic','[]')",JSON.write(Map.of("definition",definition)));
        Instant due=db.queryForObject("SELECT clock_timestamp()-interval '1 second'",Timestamp.class).toInstant();
        db.update("INSERT INTO dataset_schedule(dataset_id,owner_id,name,schedule,next_run_at) VALUES(1,1,'schedule_probe',?::jsonb,?)",JSON.write(schedule(1)),Timestamp.from(due));
        db.execute("CREATE FUNCTION reject_schedule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled enqueue failure'; END $$");
        db.execute("CREATE TRIGGER reject_schedule BEFORE INSERT ON dataset_run FOR EACH ROW EXECUTE FUNCTION reject_schedule()");
        dispatcher.dispatch();
        Instant after=db.queryForObject("SELECT next_run_at FROM dataset_schedule WHERE dataset_id=1",Timestamp.class).toInstant();
        require(db.queryForObject("SELECT count(*) FROM dataset_run",Integer.class)==0,"failure trigger did not reject the run");
        if(!after.equals(due))failures.add("ATOMICITY: enqueue failure consumed slot "+due+" (next="+after+")");
        db.execute("DROP TRIGGER reject_schedule ON dataset_run; DROP FUNCTION reject_schedule()");
        db.update("UPDATE dataset_schedule SET schedule=?::jsonb,next_run_at=? WHERE dataset_id=1",JSON.write(schedule(2)),Timestamp.from(due.plusSeconds(120)));
        // A user changes the plan after an admission failure: the old due slot must be closed
        // explicitly even though its claim transaction was rolled back.
        db.update("UPDATE dataset_schedule SET schedule=?::jsonb,next_run_at=? WHERE dataset_id=1",JSON.write(schedule(1)),Timestamp.from(due));
        tasks.save("1","1",Map.of("schedule",schedule(2)));
        require("skipped:SCHEDULE_CHANGED".equals(db.queryForObject("SELECT state||':'||reason FROM dataset_schedule_slot WHERE dataset_id=1 AND scheduled_at=?",String.class,Timestamp.from(due))),"changed plan silently lost its due slot");
        // Failure after INSERT must roll back the run as well as the time and outcome record.
        tasks.save("1","1",Map.of("schedule",schedule(1)));
        Instant second=db.queryForObject("SELECT clock_timestamp()-interval '1 second'",Timestamp.class).toInstant();
        db.update("UPDATE dataset_schedule SET next_run_at=? WHERE dataset_id=1",Timestamp.from(second));
        db.execute("CREATE FUNCTION reject_cursor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.next_run_at IS DISTINCT FROM OLD.next_run_at THEN RETURN NULL; END IF; RETURN NEW; END $$");
        db.execute("CREATE TRIGGER reject_cursor BEFORE UPDATE ON dataset_schedule FOR EACH ROW EXECUTE FUNCTION reject_cursor()");
        dispatcher.dispatch();
        require(db.queryForObject("SELECT count(*) FROM dataset_run",Integer.class)==0,"cursor CAS failure committed an orphan run");
        require(db.queryForObject("SELECT next_run_at FROM dataset_schedule",Timestamp.class).toInstant().equals(second),"cursor CAS failure consumed the slot");
        require(db.queryForObject("SELECT count(*) FROM dataset_schedule_slot WHERE scheduled_at=?",Integer.class,Timestamp.from(second))==0,"cursor CAS failure committed a partial outcome");
        db.execute("DROP TRIGGER reject_cursor ON dataset_schedule; DROP FUNCTION reject_cursor()");
        var manual=tx.execute(status->runs.create("1",1,"1","manual-probe","0".repeat(64),false,null,schedule(1)));
        dispatcher.dispatch();
        require("pending".equals(db.queryForObject("SELECT state FROM dataset_schedule_slot WHERE scheduled_at=?",String.class,Timestamp.from(second))),"active run did not retain its pending slot");
        db.update("INSERT INTO dataset_version(dataset_id,version,body,source_table,source_columns) VALUES(1,2,?::jsonb,'synthetic','[]')",JSON.write(Map.of("definition",definition)));
        db.update("UPDATE dataset SET published_version=2 WHERE id=1");
        db.update("UPDATE dataset_run SET status='succeeded',finished_at=now() WHERE id=?",Long.parseLong(manual.get("id").toString()));
        dispatcher.dispatch();
        require(db.queryForObject("SELECT dataset_version FROM dataset_run WHERE scheduled_at=?",Integer.class,Timestamp.from(second))==1,"publication changed a previously claimed slot version");
        db.update("UPDATE dataset_schedule SET next_run_at=? WHERE dataset_id=1",Timestamp.from(second));
        dispatcher.dispatch();
        require(db.queryForObject("SELECT count(*) FROM dataset_run WHERE scheduled_at=?",Integer.class,Timestamp.from(second))==1,"replayed slot created duplicate runs");
        // Close another waiting slot by pause, retaining the reason instead of a failed CAS.
        Instant waiting=db.queryForObject("SELECT clock_timestamp()-interval '1 second'",Timestamp.class).toInstant();
        db.update("UPDATE dataset_schedule SET next_run_at=? WHERE dataset_id=1",Timestamp.from(waiting));
        dispatcher.dispatch();
        tasks.setEnabled("1",false);
        require("skipped:PAUSED".equals(db.queryForObject("SELECT state||':'||reason FROM dataset_schedule_slot WHERE scheduled_at=?",String.class,Timestamp.from(waiting))),"pause silently lost a waiting slot");
        tasks.setEnabled("1",true);
        Instant expired=db.queryForObject("SELECT clock_timestamp()-interval '185 seconds'",Timestamp.class).toInstant();
        db.update("UPDATE dataset_schedule SET next_run_at=? WHERE dataset_id=1",Timestamp.from(expired));
        dispatcher.dispatch();
        require("skipped:EXPIRED".equals(db.queryForObject("SELECT state||':'||reason FROM dataset_schedule_slot WHERE scheduled_at=?",String.class,Timestamp.from(expired))),"expired slot was not recorded");
        require(db.queryForObject("SELECT next_run_at FROM dataset_schedule",Timestamp.class).toInstant().equals(expired.plusSeconds(240)),"skipped range drifted off its interval phase");
        if(!failures.isEmpty())throw new AssertionError(String.join("\n",failures));
        System.out.println("PASS real PostgreSQL: admission/cursor rollback, plan-change/pause outcomes, frozen version, replay deduplication and bounded expired-range skip");
      } finally {statement.execute("DROP DATABASE "+database);}
    }
  }
}
