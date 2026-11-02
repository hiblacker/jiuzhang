import java.sql.*;
import java.util.UUID;
import org.flywaydb.core.Flyway;

/** Validate the configured PostgreSQL endpoint, including an existing V009 installation. */
class MigrationAcceptance {
  static final String USER = System.getenv().getOrDefault("METADATA_USER", "jiuzhang");
  static final String PASSWORD = System.getenv("METADATA_PASSWORD");
  static String scalar(Connection c, String sql) throws SQLException {
    try (var statement=c.createStatement(); var result=statement.executeQuery(sql)) { result.next(); return result.getString(1); }
  }
  static void execute(Connection c,String sql) throws SQLException {
    try(var statement=c.createStatement()) { statement.execute(sql); }
  }
  static void require(boolean condition,String message) { if(!condition) throw new AssertionError(message); }
  static Flyway migration(String url,String target) {
    var config=Flyway.configure().dataSource(url,USER,PASSWORD).locations("classpath:db/migration");
    if(target!=null)config.target(target);
    return config.load();
  }
  public static void main(String[] args) throws Exception {
    String configured=System.getenv().getOrDefault("METADATA_URL","jdbc:postgresql://127.0.0.1:15432/jiuzhang");
    String base=configured.split("\\?",2)[0];
    String query=configured.contains("?")?configured.substring(configured.indexOf('?')):"";
    String prefix=base.substring(0,base.lastIndexOf('/')+1);
    try(var admin=DriverManager.getConnection(configured,USER,PASSWORD)) {
      for(String previous:new String[]{null,"9","11","12","13","14"}) {
        boolean upgrade=previous!=null;
        String database="jz_migration_"+UUID.randomUUID().toString().replace("-","").substring(0,12);
        String url=prefix+database+query;
        execute(admin,"CREATE DATABASE "+database);
        try {
          if(upgrade) {
            migration(url,previous).migrate();
            try(var c=DriverManager.getConnection(url,USER,PASSWORD)) {
              execute(c,"INSERT INTO account(username,display_name,password_hash,role) VALUES('upgrade_probe','synthetic','not-a-login-hash','viewer')");
              execute(c,"INSERT INTO source_connection(name,owner_label,created_by,settings,connection_username) SELECT 'upgrade_mysql','test',id,'{}','reader' FROM account WHERE username='upgrade_probe'");
              execute(c,"INSERT INTO source_secret(source_id,ciphertext) SELECT id,'synthetic-ciphertext' FROM source_connection");
              if(Integer.parseInt(previous)>=11) {
                execute(c,"INSERT INTO source_object(source_id,name,schema_contract) VALUES(1,'legacy','[]')");
                execute(c,"INSERT INTO dataset(source_id,object_id,name,owner_label,definition,target_name,published_version) VALUES(1,1,'legacy','test','{}','legacy',1)");
                execute(c,"INSERT INTO dataset_version(dataset_id,version,body,source_table,source_columns) VALUES(1,1,'{}','legacy','[]')");
                execute(c,"INSERT INTO dataset_run(dataset_id,dataset_version,requested_by,idempotency_key,request_hash,trigger,schedule_snapshot) VALUES(1,1,1,'legacy-scheduled','synthetic','schedule','{}')");
                if((Integer.parseInt(previous)>=12)) {
                  execute(c,"INSERT INTO dataset_schedule(dataset_id,owner_id,name,schedule,next_run_at) VALUES(1,1,'legacy','{}',clock_timestamp())");
                  execute(c,"INSERT INTO dataset_schedule_slot(dataset_id,scheduled_at,revision,dataset_version,requested_by,schedule_snapshot,expires_at,state,reason,attempts) VALUES(1,clock_timestamp(),1,1,1,'{}',clock_timestamp()+interval '1 minute','pending','DATASET_RUN_ACTIVE',7)");
                }
              }
            }
          }
          migration(url,null).migrate();
          try(var c=DriverManager.getConnection(url,USER,PASSWORD)) {
            require(scalar(c,"SELECT count(*) FROM flyway_schema_history WHERE success").equals("15"),"Expected V001-V015");
            require(scalar(c,"SELECT count(*) FROM pg_constraint WHERE conrelid='dataset_schedule_slot'::regclass AND contype='f' AND confdeltype='c'").equals("2"),"Expected two ownership cascade foreign keys");
            require(scalar(c,"SELECT count(*) FROM pg_indexes WHERE tablename='dataset_schedule_slot' AND indexname='dataset_schedule_slot_retention_idx' AND indexdef LIKE '%(state, advanced_to)%'").equals("1"),"Missing terminal retention index");
            if(upgrade) {
              require(scalar(c,"SELECT source_type||':'||connection_username FROM source_connection WHERE name='upgrade_mysql'").equals("MySQL:reader"),"Upgrade changed MySQL source");
              require(scalar(c,"SELECT ciphertext FROM source_secret").equals("synthetic-ciphertext"),"Upgrade changed credentials");
              if(Integer.parseInt(previous)>=11) {
                require(scalar(c,"SELECT count(*) FROM dataset_run WHERE trigger='schedule' AND scheduled_at IS NULL").equals("1"),"Upgrade changed legacy scheduled runs");
                execute(c,"UPDATE dataset_run SET status='succeeded',finished_at=now()");
              }
              if(Integer.parseInt(previous)>=12)
                require(scalar(c,"SELECT state||':'||reason||':'||attempts FROM dataset_schedule_slot").equals("pending:DATASET_RUN_ACTIVE:7"),"Upgrade changed an existing pending slot");
            }
            if(upgrade) {
              execute(c,"INSERT INTO source_connection(name,owner_label,created_by,settings,connection_username,source_type) SELECT 'upgrade_ob','test',id,'{}','reader@tenant#cluster','OceanBase' FROM account LIMIT 1");
              require(scalar(c,"SELECT source_type||':'||connection_username FROM source_connection WHERE name='upgrade_ob'").equals("OceanBase:reader@tenant#cluster"),"OceanBase type/account was not preserved");
            }
            if(upgrade) {
              execute(c,"INSERT INTO source_connection(name,owner_label,created_by,settings,connection_username,source_type) SELECT 'upgrade_pg','test',id,'{\"schema\":\"Retail\"}','reader','PostgreSQL' FROM account LIMIT 1");
              require(scalar(c,"SELECT source_type||':'||(settings->>'schema') FROM source_connection WHERE name='upgrade_pg'").equals("PostgreSQL:Retail"),"PostgreSQL schema/type was not preserved");
            }
            String before=scalar(c,"SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace");
            migration(url,null).migrate();
            require(scalar(c,"SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace").equals(before),"Repeated migration changed constraints");
          }
        } finally { execute(admin,"DROP DATABASE "+database); }
      }
    }
    System.out.println("PASS PostgreSQL empty V001-V015, V009/V011/V012/V013/V014 upgrades preserving MySQL/secrets/legacy runs/pending slots, cascade keys/retention index/OceanBase/PostgreSQL types, repeated migration");
  }
}
