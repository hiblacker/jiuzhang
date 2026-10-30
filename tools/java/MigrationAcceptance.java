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
      for(boolean upgrade:new boolean[]{false,true}) {
        String database="jz_migration_"+UUID.randomUUID().toString().replace("-","").substring(0,12);
        String url=prefix+database+query;
        execute(admin,"CREATE DATABASE "+database);
        try {
          if(upgrade) {
            migration(url,"9").migrate();
            try(var c=DriverManager.getConnection(url,USER,PASSWORD)) {
              execute(c,"INSERT INTO account(username,display_name,password_hash,role) VALUES('upgrade_probe','synthetic','not-a-login-hash','viewer')");
              execute(c,"INSERT INTO source_connection(name,owner_label,created_by,settings,connection_username) SELECT 'upgrade_mysql','test',id,'{}','reader' FROM account WHERE username='upgrade_probe'");
              execute(c,"INSERT INTO source_secret(source_id,ciphertext) SELECT id,'synthetic-ciphertext' FROM source_connection");
            }
          }
          migration(url,null).migrate();
          try(var c=DriverManager.getConnection(url,USER,PASSWORD)) {
            require(scalar(c,"SELECT count(*) FROM flyway_schema_history WHERE success").equals("11"),"Expected V001-V011");
            if(upgrade) {
              require(scalar(c,"SELECT source_type||':'||connection_username FROM source_connection WHERE name='upgrade_mysql'").equals("MySQL:reader"),"Upgrade changed MySQL source");
              require(scalar(c,"SELECT ciphertext FROM source_secret").equals("synthetic-ciphertext"),"Upgrade changed credentials");
            }
            String before=scalar(c,"SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace");
            migration(url,null).migrate();
            require(scalar(c,"SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace").equals(before),"Repeated migration changed constraints");
          }
        } finally { execute(admin,"DROP DATABASE "+database); }
      }
    }
    System.out.println("PASS PostgreSQL empty V001-V011, V009 upgrade preserving MySQL and secrets, repeated migration");
  }
}
