# POC-01 ingest engine: pinned SeaTunnel image plus pinned JDBC drivers.
# Drivers are not redistributed in Git; ADD fetches them at build time with
# checksums recorded in dependencies.lock.json.
FROM apache/seatunnel:2.3.13
ADD --checksum=sha256:d77962877d010777cff997015da90ee689f0f4bb76848340e1488f2b83332af5 https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar /opt/seatunnel/lib/mysql-connector-j-8.4.0.jar
ADD --checksum=sha256:188976721ead8e8627eb6d8389d500dccc0c9bebd885268a3047180274a6031e https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar /opt/seatunnel/lib/postgresql-42.7.4.jar
