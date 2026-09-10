-- Fixed initial metadata discovery. Not used by the unauthenticated preflight.
-- Existing test account explicitly authorized; production requires least privilege.
-- User authorized metadata discovery across all account-visible databases.
-- System schemas are not searched for application history tables.
-- Results may be sensitive: keep them in ignored work/, not in Git.
-- Each result is capped; hitting a cap requires bounded pagination, not completeness claims.
SET SESSION transaction_read_only = ON;
SET SESSION max_execution_time = 15000;
START TRANSACTION READ ONLY;

SHOW SESSION STATUS LIKE 'Ssl_cipher';
SHOW SESSION STATUS LIKE 'Ssl_version';
SELECT @@SESSION.transaction_read_only AS session_read_only,
       @@SESSION.max_execution_time AS select_timeout_ms;

SELECT /*+ MAX_EXECUTION_TIME(15000) */ VERSION() AS server_version;

SELECT /*+ MAX_EXECUTION_TIME(15000) */ SCHEMA_NAME
FROM information_schema.SCHEMATA
ORDER BY SCHEMA_NAME
LIMIT 200;

SELECT /*+ MAX_EXECUTION_TIME(15000) */ TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
  AND UPPER(TABLE_NAME) IN ('STORY', 'DEFECT')
ORDER BY TABLE_SCHEMA, TABLE_NAME
LIMIT 200;

SELECT /*+ MAX_EXECUTION_TIME(15000) */ TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
  AND (
    UPPER(TABLE_NAME) LIKE '%HISTORY%'
    OR UPPER(TABLE_NAME) LIKE '%AUDIT%'
    OR UPPER(TABLE_NAME) LIKE '%ACTION%'
    OR UPPER(TABLE_NAME) LIKE '%CHANGE%'
    OR UPPER(TABLE_NAME) LIKE '%LOG%'
  )
ORDER BY TABLE_SCHEMA, TABLE_NAME
LIMIT 200;

COMMIT;
-- Do not append arbitrary business-table SELECTs here. Column/index/constraint lookup
-- should follow after resolving exact schema/table names, using bound value parameters.
