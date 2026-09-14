import { createHash } from 'node:crypto';
import { unescapeBatch } from './mysql-metadata.mjs';

// This is a bounded DevOps investigation, not a generic platform adapter.
const TABLES = {
  STORY: ['ID','PROJECT_ID','TYPE','STATUS','STATUS_CODE','CREATE_TIME','UPDATE_TIME','ACTUAL_BEGIN_TIME','ACTUAL_END_TIME','DELETE_FLAG'],
  DEFECT: ['ID','PROJECT_ID','TYPE','STATUS','STATUS_CODE','CREATE_TIME','UPDATE_TIME','ACTUAL_BEGIN_TIME','ACTUAL_END_TIME','DELETE_FLAG'],
  STORY_LOG: ['ID','PROJECT_ID','STORY_ID','STORY_TYPE','OPERATE_TYPE','CONTENT','CREATE_TIME','DELETE_FLAG'],
  PROJECT_DYNAMICS: ['ID','PROJECT_ID','EVENT_TYPE','OPERATE_TYPE','FIELD_TYPE','SOURCE_VALUE','TARGET_VALUE','CREATE_TIME'],
};
export const STATUS_TOKENS = ['未开始','处理中','已完成','待处理','待验证','已拒绝','已关闭','重新打开'];
const STATUS_DICTIONARY_LIMIT = 201;
const STATUS_OBJECT_SAMPLE_LIMIT = 200;
const hex = value => `CONVERT(X'${Buffer.from(value,'utf8').toString('hex')}' USING utf8mb4)`;
const name = value => {
  if (typeof value !== 'string' || !value.length || [...value].length > 64 || /[\x00-\x1f\x7f]/u.test(value)) throw new Error('INVALID_IDENTIFIER');
  return '`' + value.replaceAll('`','``') + '`';
};
export const sourceFingerprint = schema => createHash('sha256').update(schema).digest('hex');
function bound(template, values = []) {
  return [...values.map((v,i) => `SET @p${i} = ${hex(v)};`), `SET @template = ${hex(template)};`,
    'PREPARE sample_query FROM @template;', `EXECUTE sample_query${values.length ? ' USING ' + values.map((_,i)=>`@p${i}`).join(', ') : ''};`,
    'DEALLOCATE PREPARE sample_query;'].join('\n');
}
function validateMetadata(schema, records) {
  name(schema);
  if (!Array.isArray(records)) throw new Error('MISSING_METADATA');
  for (const [table, columns] of Object.entries(TABLES)) {
    for (const column of columns) if (!records.some(r => r.kind === 'column' && r.schema === schema && r.table === table && r.name === column)) throw new Error('UNVERIFIED_COLUMN');
    if (!records.some(r => r.kind === 'index' && r.schema === schema && r.table === table && r.name === 'PRIMARY' && r.position === 1 && r.column === 'ID')) throw new Error('UNVERIFIED_PRIMARY_KEY');
  }
  for (const [table,index,columns] of [['STORY_LOG','STORY_LOG_PROJECT_ID_IDX',['PROJECT_ID','STORY_ID']], ['PROJECT_DYNAMICS','idx_projectid_createtime',['PROJECT_ID','CREATE_TIME']]]) {
    for (const [i,column] of columns.entries()) if (!records.some(r => r.kind === 'index' && r.schema === schema && r.table === table && r.name === index && r.position === i+1 && r.column === column)) throw new Error('UNVERIFIED_ACCESS_INDEX');
  }
}
export function validateSeedReference(pointer, schema, configHash) {
  if (!pointer || pointer.status !== 'ready' || pointer.config_fingerprint !== configHash || pointer.source_fingerprint !== sourceFingerprint(schema) || !/^mysql-sample-[a-f0-9-]+\.json$/.test(pointer.file) || !/^[a-f0-9]{64}$/.test(pointer.sha256)) throw new Error('INVALID_SEED_REFERENCE');
  return pointer.file;
}
export function validateSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length > 5) throw new Error('INVALID_SEEDS');
  const counts = { STORY:0, DEFECT:0 }; const keys = new Set();
  for (const row of seeds) {
    if (!row || row.kind !== 'object' || !Object.hasOwn(counts,row.object_kind) || typeof row.id !== 'string' || !row.id.length || row.id.length > 100 || typeof row.project_id !== 'string' || !row.project_id.length || row.project_id.length > 100) throw new Error('INVALID_SEED');
    const key = JSON.stringify([row.object_kind,row.id]);
    if (keys.has(key)) throw new Error('DUPLICATE_SEED');
    keys.add(key); counts[row.object_kind]++;
  }
  if (counts.STORY > 2 || counts.DEFECT > 3) throw new Error('SEED_LIMIT');
}
function code(column) {
  // Enum columns only, never content or identity fields.
  return `IF(REGEXP_LIKE(${column},'^[A-Za-z][A-Za-z0-9_]{0,63}$|^[0-9]{1,4}$','c'),${column},NULL)`;
}
function shape(column) {
  return `JSON_OBJECT('is_null',${column} IS NULL,'characters',CHAR_LENGTH(${column}),'json_valid',JSON_VALID(${column}),'json_type',IF(JSON_VALID(${column}),JSON_TYPE(${column}),NULL))`;
}
export function buildSamplingSql({schema,records,phase,seeds,authorized=false,timeoutMs=15000}) {
  if (authorized !== true) throw new Error('BUSINESS_SAMPLE_AUTHORIZATION_REQUIRED');
  if (!['seeds','history'].includes(phase) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new Error('INVALID_SAMPLE_PHASE_OR_LIMIT');
  validateMetadata(schema,records);
  const table = t => `${name(schema)}.${name(t)}`;
  const sql = ['SET SESSION transaction_read_only = ON;',`SET SESSION max_execution_time = ${timeoutMs};`,'START TRANSACTION READ ONLY;',
    "SHOW SESSION STATUS LIKE 'Ssl_cipher';", "SHOW SESSION STATUS LIKE 'Ssl_version';",
    'SELECT @@SESSION.transaction_read_only AS session_read_only, @@SESSION.max_execution_time AS select_timeout_ms;'];
  if (phase === 'seeds') {
    for (const [t,limit] of [['STORY',2],['DEFECT',3]]) {
      sql.push(bound(`SELECT JSON_OBJECT('kind','object','object_kind','${t}','id',ID,'project_id',PROJECT_ID,'object_type',TYPE,'status',STATUS,'status_code',STATUS_CODE,'created_at',CREATE_TIME,'updated_at',UPDATE_TIME,'started_at',ACTUAL_BEGIN_TIME,'ended_at',ACTUAL_END_TIME,'delete_flag',DELETE_FLAG) AS sample_json FROM ${table(t)} FORCE INDEX (PRIMARY) ORDER BY ID LIMIT ${limit}`));
    }
  } else {
    validateSeeds(seeds);
    for (const row of seeds) {
      // Fixed keyword flags are evidence only. No free text or identities are selected.
      const tokens = STATUS_TOKENS.flatMap((token,i)=>[`'token_${i}'`,`COALESCE(LOCATE(${hex(token)},CONTENT)>0,0)`]).join(',');
      const exactTokens = STATUS_TOKENS.flatMap((token,i)=>[`'token_${i}'`,`COALESCE(BINARY CONTENT=BINARY ${hex(token)},0)`]).join(',');
      const jsonPaths = ['$.oldValue','$.newValue','$.oldStatus','$.newStatus','$.before','$.after'].flatMap((p,i)=>[`'path_${i}'`,`IF(JSON_VALID(CONTENT),JSON_CONTAINS_PATH(CONTENT,'one','${p}'),NULL)`]).join(',');
      sql.push(bound(`SELECT JSON_OBJECT('kind','history','sample_object_kind',?,'sample_object_id',?,'log_id',ID,'object_type',STORY_TYPE,'created_at',CREATE_TIME,'delete_flag',DELETE_FLAG,'operation_code',${code('OPERATE_TYPE')},'operation_shape',${shape('OPERATE_TYPE')},'content_shape',${shape('CONTENT')},'has_status_word',COALESCE(LOCATE(${hex('状态')},CONTENT)>0,0),'status_tokens',JSON_OBJECT(${tokens}),'exact_status_tokens',JSON_OBJECT(${exactTokens}),'json_paths',JSON_OBJECT(${jsonPaths})) AS sample_json FROM ${table('STORY_LOG')} FORCE INDEX (STORY_LOG_PROJECT_ID_IDX) WHERE PROJECT_ID = ? AND STORY_ID = ? LIMIT 20`,[row.object_kind,row.id,row.project_id,row.id]));
    }
    if (seeds.length) sql.push(bound(`SELECT JSON_OBJECT('kind','project_history','log_id',ID,'event_code',${code('EVENT_TYPE')},'operation_code',${code('OPERATE_TYPE')},'field_code',${code('FIELD_TYPE')},'event_shape',${shape('EVENT_TYPE')},'field_shape',${shape('FIELD_TYPE')},'operation_shape',${shape('OPERATE_TYPE')},'created_at',CREATE_TIME,'source_shape',${shape('SOURCE_VALUE')},'target_shape',${shape('TARGET_VALUE')}) AS sample_json FROM ${table('PROJECT_DYNAMICS')} FORCE INDEX (idx_projectid_createtime) WHERE PROJECT_ID = ? ORDER BY CREATE_TIME LIMIT 20`,[seeds[0].project_id]));
  }
  return [...sql,'COMMIT;',''].join('\n');
}
export function buildStatusSamplingSql({schema,records,authorized=false,timeoutMs=15000}) {
  if (authorized !== true) throw new Error('BUSINESS_SAMPLE_AUTHORIZATION_REQUIRED');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new Error('INVALID_STATUS_SAMPLE_LIMIT');
  name(schema);
  const required = {
    NODE_STATUS: ['ID','NODE_TYPE','STATUS_NAME','STATUS_CODE','STATUS','BEGIN','PROJECT_ID','DELETE_FLAG'],
    STORY: ['ID','TYPE','STATUS','STATUS_CODE','STATUS_NAME','DELETE_FLAG'],
    DEFECT: ['ID','TYPE','STATUS','STATUS_CODE','STATUS_NAME','DELETE_FLAG'],
  };
  for (const [table, columns] of Object.entries(required)) {
    for (const column of columns) if (!records?.some(r => r.kind === 'column' && r.schema === schema && r.table === table && r.name === column)) throw new Error('UNVERIFIED_STATUS_COLUMN');
    if (!records.some(r => r.kind === 'index' && r.schema === schema && r.table === table && r.name === 'PRIMARY' && r.position === 1 && r.column === 'ID')) throw new Error('UNVERIFIED_STATUS_INDEX');
  }
  const estimate = records.find(r => r.kind === 'table' && r.schema === schema && r.table === 'NODE_STATUS')?.estimated_rows;
  if (!Number.isInteger(estimate) || estimate < 0 || estimate > 10000) throw new Error('STATUS_DICTIONARY_TOO_LARGE');
  const table = value => `${name(schema)}.${name(value)}`;
  const sql = ['SET SESSION transaction_read_only = ON;',`SET SESSION max_execution_time = ${timeoutMs};`,'START TRANSACTION READ ONLY;',
    "SHOW SESSION STATUS LIKE 'Ssl_cipher';", "SHOW SESSION STATUS LIKE 'Ssl_version';",
    'SELECT @@SESSION.transaction_read_only AS session_read_only, @@SESSION.max_execution_time AS select_timeout_ms;'];
  sql.push(bound(`SELECT JSON_OBJECT('kind','status_dictionary','node_type',NODE_TYPE,'status_name',STATUS_NAME,'status_code',STATUS_CODE,'coarse_status',STATUS,'is_begin',BEGIN,'project_scoped',CASE WHEN PROJECT_ID IS NULL THEN 0 ELSE 1 END,'delete_flag',DELETE_FLAG) AS sample_json FROM (SELECT NODE_TYPE,STATUS_NAME,STATUS_CODE,STATUS,BEGIN,PROJECT_ID,DELETE_FLAG FROM ${table('NODE_STATUS')} WHERE DELETE_FLAG = 0 LIMIT ${STATUS_DICTIONARY_LIMIT}) sampled LIMIT ${STATUS_DICTIONARY_LIMIT}`));
  for (const objectTable of ['STORY','DEFECT']) {
    sql.push(bound(`SELECT JSON_OBJECT('kind','status_sample','object_kind','${objectTable}','object_type',TYPE,'coarse_status',STATUS,'status_code',STATUS_CODE,'status_name',STATUS_NAME,'delete_flag',DELETE_FLAG,'sample_count',COUNT(*)) AS sample_json FROM (SELECT TYPE,STATUS,STATUS_CODE,STATUS_NAME,DELETE_FLAG FROM ${table(objectTable)} FORCE INDEX (PRIMARY) LIMIT ${STATUS_OBJECT_SAMPLE_LIMIT}) sampled GROUP BY TYPE,STATUS,STATUS_CODE,STATUS_NAME,DELETE_FLAG LIMIT 51`));
  }
  return [...sql,'COMMIT;',''].join('\n');
}
export function parseSamplingOutput(text) {
  return text.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(unescapeBatch(line)));
}
export function summarizeStatusSamples(rows) {
  const dictionary = rows.filter(row => row.kind === 'status_dictionary');
  const samples = rows.filter(row => row.kind === 'status_sample');
  return {
    dictionary_group_count: dictionary.length,
    dictionary_at_limit: dictionary.length === STATUS_DICTIONARY_LIMIT,
    story_status_group_count: samples.filter(row => row.object_kind === 'STORY').length,
    defect_status_group_count: samples.filter(row => row.object_kind === 'DEFECT').length,
    completeness: 'bounded-status-dictionary-and-first-200-object-samples',
  };
}
const yes = value => value === true || value === 1;
export function summarizeSamples(rows) {
  const objects=rows.filter(r=>r.kind==='object'); const logs=rows.filter(r=>r.kind==='history'); const events=rows.filter(r=>r.kind==='project_history');
  const perObject = new Map();
  for (const row of logs) { const key=JSON.stringify([row.sample_object_kind,row.sample_object_id]); perObject.set(key,(perObject.get(key)??0)+1); }
  return { object_count:objects.length, history_count:logs.length, history_objects:perObject.size,
    story_history_count:logs.filter(r=>r.sample_object_kind==='STORY').length, defect_history_count:logs.filter(r=>r.sample_object_kind==='DEFECT').length,
    history_groups_at_limit:[...perObject.values()].filter(n=>n===20).length,
    content_json_valid_count:logs.filter(r=>yes(r.content_shape.json_valid)).length,
    status_word_count:logs.filter(r=>yes(r.has_status_word)).length,
    status_token_counts:STATUS_TOKENS.map((_,i)=>logs.filter(r=>yes(r.status_tokens[`token_${i}`])).length),
    content_null_count:logs.filter(r=>yes(r.content_shape.is_null)).length,
    exact_status_token_counts:STATUS_TOKENS.map((_,i)=>logs.filter(r=>yes(r.exact_status_tokens?.[`token_${i}`])).length),
    project_history_count:events.length, project_history_at_limit:events.length===20,
    member_candidate_count:events.filter(r=>['projectMember','member'].includes(r.event_code)).length,
    completeness:'bounded-convenience-sample-not-full-history',
  };
}
