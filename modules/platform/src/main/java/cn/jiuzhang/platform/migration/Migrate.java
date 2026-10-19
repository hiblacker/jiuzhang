package cn.jiuzhang.platform.migration;

import org.flywaydb.core.Flyway;

/** Explicit schema migration entrypoint; ordinary API and Worker startup never migrates. */
public final class Migrate {
    public static void main(String[] args) {
        String password = System.getenv("METADATA_PASSWORD");
        if (password == null || password.isBlank()) throw new IllegalStateException("METADATA_PASSWORD required");
        Flyway.configure().dataSource(
                System.getenv().getOrDefault("METADATA_URL", "jdbc:postgresql://127.0.0.1:15432/jiuzhang"),
                System.getenv().getOrDefault("METADATA_USER", "jiuzhang"), password)
            .locations("classpath:db/migration").load().migrate();
    }
}
