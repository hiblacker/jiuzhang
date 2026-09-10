// Investigation-only information_schema templates. No application rows or user SQL.
const LIMIT = 200;
const QUERIES = {
  table: `SELECT JSON_OBJECT('kind','table','schema',TABLE_SCHEMA,'table',TABLE_NAME,'engine',ENGINE,'estimated_rows',TABLE_ROWS,'comment',TABLE_COMMENT) AS metadata_json FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT ${LIMIT}`,
  column: `SELECT JSON_OBJECT('kind','column','schema',TABLE_SCHEMA,'table',TABLE_NAME,'position',ORDINAL_POSITION,'name',COLUMN_NAME,'type',COLUMN_TYPE,'nullable',IS_NULLABLE,'key',COLUMN_KEY,'extra',EXTRA,'comment',COLUMN_COMMENT) AS metadata_json FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION LIMIT ${LIMIT}`,
  index: `SELECT JSON_OBJECT('kind','index','schema',TABLE_SCHEMA,'table',TABLE_NAME,'name',INDEX_NAME,'non_unique',NON_UNIQUE,'position',SEQ_IN_INDEX,'column',COLUMN_NAME) AS metadata_json FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT ${LIMIT}`,
  foreign_key: `SELECT JSON_OBJECT('kind','foreign_key','schema',TABLE_SCHEMA,'table',TABLE_NAME,'name',CONSTRAINT_NAME,'column',COLUMN_NAME,'ref_schema',REFERENCED_TABLE_SCHEMA,'ref_table',REFERENCED_TABLE_NAME,'ref_column',REFERENCED_COLUMN_NAME) AS metadata_json FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME,ORDINAL_POSITION LIMIT ${LIMIT}`,
  related: `SELECT JSON_OBJECT('kind','related_table','schema',TABLE_SCHEMA,'table',TABLE_NAME,'comment',TABLE_COMMENT) AS metadata_json FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND UPPER(TABLE_NAME) REGEXP 'PROJECT|TEAM|GROUP|MEMBER|STATUS|STATE|WORKFLOW|TRANSITION|TYPE|DEPARTMENT|ITERATION|SPRINT|DICT|HISTORY|AUDIT|EVENT|DYNAMICS|OPERATION|RECORD|LOG' ORDER BY TABLE_NAME LIMIT ${LIMIT}`,
  history_column: `SELECT JSON_OBJECT('kind','history_column','schema',TABLE_SCHEMA,'table',TABLE_NAME,'name',COLUMN_NAME,'type',COLUMN_TYPE) AS metadata_json FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND UPPER(COLUMN_NAME) REGEXP '(^|_)(OLD|NEW|BEFORE|AFTER|PREVIOUS|PREV|SOURCE|TARGET)_(VALUE|STATUS|STATE|CONTENT|DATA)$|^VALID_(FROM|TO)$|^EFFECTIVE_(FROM|TO)$' ORDER BY TABLE_NAME,ORDINAL_POSITION LIMIT ${LIMIT}`,
};
function hex(value) { return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`; }
function validName(value) { return typeof value === 'string' && value.length > 0 && [...value].length <= 64 && !/[\0-\x1f\x7f]/u.test(value); }
function bound(template, values) {
  // Parameter values are never interpolated into the SQL template. Hex encoding
  // safely transports SET values without dependence on NO_BACKSLASH_ESCAPES.
  return [...values.map((v, i) => `SET @p${i} = ${hex(v)};`),
    `SET @template = ${hex(template)};`, 'PREPARE metadata_query FROM @template;',
    `EXECUTE metadata_query USING ${values.map((_, i) => `@p${i}`).join(', ')};`,
    'DEALLOCATE PREPARE metadata_query;'].join('\n');
}
export function buildDetailsSql(selection, timeoutMs = 15000) {
  if (!selection || !Array.isArray(selection.schemas) || selection.schemas.length < 1 || selection.schemas.length > 10 ||
      !selection.schemas.every(validName) || !Array.isArray(selection.targets) || (selection.targets.length < 1 && selection.catalog_only !== true) || selection.targets.length > 20 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new Error('INVALID_METADATA_SELECTION');
  if (!selection.targets.every(t => t && validName(t.schema) && validName(t.table) && selection.schemas.includes(t.schema))) throw new Error('INVALID_METADATA_TARGET');
  const statements = [
    'SET SESSION transaction_read_only = ON;', `SET SESSION max_execution_time = ${timeoutMs};`,
    'START TRANSACTION READ ONLY;', "SHOW SESSION STATUS LIKE 'Ssl_cipher';", "SHOW SESSION STATUS LIKE 'Ssl_version';",
    'SELECT @@SESSION.transaction_read_only AS session_read_only, @@SESSION.max_execution_time AS select_timeout_ms;',
  ];
  const targets = [...new Map(selection.targets.map(t => [JSON.stringify([t.schema,t.table]),t])).values()];
  for (const t of targets) for (const kind of ['table','column','index','foreign_key']) statements.push(bound(QUERIES[kind], [t.schema,t.table]));
  for (const schema of new Set(selection.schemas)) {
    statements.push(bound(QUERIES.related, [schema]));
    statements.push(bound(QUERIES.history_column, [schema]));
  }
  return [...statements, 'COMMIT;', ''].join('\n');
}

// mysql --batch escapes backslashes/tabs/newlines even inside JSON string values.
export function unescapeBatch(value) {
  return value.replace(/\\([0ntr\\])/g, (_, c) => ({ '0':'\0', n:'\n', t:'\t', r:'\r', '\\':'\\' }[c]));
}
export function parseDetailsOutput(text) {
  const records = [];
  for (const line of text.split(/\r?\n/)) if (line.startsWith('{')) records.push(JSON.parse(unescapeBatch(line)));
  const counts = new Map();
  for (const row of records) {
    const key = JSON.stringify([row.kind,row.schema,['related_table','history_column'].includes(row.kind) ? null : row.table]);
    counts.set(key,(counts.get(key) ?? 0)+1);
  }
  return { records, capped_groups: [...counts].filter(([,n]) => n >= LIMIT).map(([key]) => JSON.parse(key)) };
}
