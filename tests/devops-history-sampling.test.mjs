import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSamplingSql, validateSeeds, parseSamplingOutput, summarizeSamples, sourceFingerprint, validateSeedReference } from '../tools/devops-history-sampling.mjs';
const schema='synthetic_source';
const fields={STORY:['ID','PROJECT_ID','TYPE','STATUS','STATUS_CODE','CREATE_TIME','UPDATE_TIME','ACTUAL_BEGIN_TIME','ACTUAL_END_TIME','DELETE_FLAG'],DEFECT:['ID','PROJECT_ID','TYPE','STATUS','STATUS_CODE','CREATE_TIME','UPDATE_TIME','ACTUAL_BEGIN_TIME','ACTUAL_END_TIME','DELETE_FLAG'],STORY_LOG:['ID','PROJECT_ID','STORY_ID','STORY_TYPE','OPERATE_TYPE','CONTENT','CREATE_TIME','DELETE_FLAG'],PROJECT_DYNAMICS:['ID','PROJECT_ID','EVENT_TYPE','OPERATE_TYPE','FIELD_TYPE','SOURCE_VALUE','TARGET_VALUE','CREATE_TIME']};
const records=Object.entries(fields).flatMap(([table,names])=>[...names.map(name=>({kind:'column',schema,table,name})),{kind:'index',schema,table,name:'PRIMARY',position:1,column:'ID'}]);
for(const [table,name,columns] of [['STORY_LOG','STORY_LOG_PROJECT_ID_IDX',['PROJECT_ID','STORY_ID']],['PROJECT_DYNAMICS','idx_projectid_createtime',['PROJECT_ID','CREATE_TIME']]]) columns.forEach((column,i)=>records.push({kind:'index',schema,table,name,position:i+1,column}));
const seed=(object_kind='STORY',id='synthetic-id')=>({kind:'object',object_kind,id,project_id:'synthetic-project'});
const options=(phase='seeds')=>({schema,records,phase,authorized:true});
const templates=sql=>[...sql.matchAll(/SET @template = CONVERT\(X'([a-f0-9]+)' USING utf8mb4\);/g)].map(m=>Buffer.from(m[1],'hex').toString('utf8'));
test('sampling requires separate authorization and known phase/time limit',()=>{
  for(const authorized of [false,undefined,'true']) assert.throws(()=>buildSamplingSql({...options(),authorized}));
  for(const phase of ['details','query',null]) assert.throws(()=>buildSamplingSql({...options(),phase}));
  for(const timeoutMs of [0,15001,1.5,'1000']) assert.throws(()=>buildSamplingSql({...options(),timeoutMs}));
});
test('metadata verifies source, fields and index prefixes before SQL construction',()=>{
  assert.throws(()=>buildSamplingSql({...options(),schema:'other_source'}));
  assert.throws(()=>buildSamplingSql({...options(),records:records.filter(r=>r.name!=='CONTENT')}));
  assert.throws(()=>buildSamplingSql({...options(),records:records.filter(r=>r.name!=='STORY_LOG_PROJECT_ID_IDX')}));
});
test('seed SQL caps 2+3 rows on primary index, returns no titles or arbitrary statements',()=>{
  const sql=buildSamplingSql(options()); const qs=templates(sql);
  assert.equal(qs.length,2); assert.match(qs[0],/LIMIT 2$/);assert.match(qs[1],/LIMIT 3$/);
  assert.match(sql,/START TRANSACTION READ ONLY/); assert.match(sql,/max_execution_time = 15000/);
  for(const q of qs){assert.match(q,/FORCE INDEX \(PRIMARY\) ORDER BY ID/);assert.doesNotMatch(q,/SELECT \*|TITLE|DESCRIPTION|USER|PASSWORD|\b(?:UPDATE|DELETE|INSERT|ALTER|DROP)\b/);}
});
test('history validates object quotas, uniqueness and IDs',()=>{
  validateSeeds([seed(),seed('DEFECT','d')]);
  for(const seeds of [[seed(),seed()],[seed(),seed('STORY','b'),seed('STORY','c')],[seed('OTHER')],[{...seed(),project_id:null}],new Array(6).fill(seed())]) assert.throws(()=>validateSeeds(seeds));
});
test('history values are bound, not interpolated, and free text only has shape projections',()=>{
  const evil="x' OR 1=1; --";const sql=buildSamplingSql({...options('history'),seeds:[seed('STORY',evil),seed('DEFECT','d')]});const qs=templates(sql);
  assert.equal(qs.length,3);assert.equal(qs.filter(q=>q.includes('LIMIT 20')).length,3);
  assert.doesNotMatch(sql,new RegExp(evil.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(qs[0],/WHERE PROJECT_ID = \? AND STORY_ID = \?/); assert.match(sql,/EXECUTE sample_query USING @p0, @p1, @p2, @p3/);
  assert.doesNotMatch(qs.join('\n'),/'content',CONTENT|'source',SOURCE_VALUE|'target',TARGET_VALUE|EVENT_NAME|OPERATE_USER|SELECT \*/);
  assert.match(qs[0],/IF\(JSON_VALID\(CONTENT\),JSON_CONTAINS_PATH/);
});
test('empty seed set does not scan any history table',()=>{
 assert.equal(templates(buildSamplingSql({...options('history'),seeds:[]})).length,0);
});
test('batch JSON is unescaped once and summaries exclude source identifiers',()=>{
 const row={kind:'history',sample_object_kind:'DEFECT',sample_object_id:'private-object',log_id:'private-log',content_shape:{json_valid:0},has_status_word:1,status_tokens:{token_2:1}};
 const encoded=JSON.stringify(row).replaceAll('\\','\\\\');
 assert.deepEqual(parseSamplingOutput('sample_json\n'+encoded+'\n'),[row]);
 const summary=summarizeSamples(Array(20).fill(row));assert.equal(summary.defect_history_count,20);assert.equal(summary.history_groups_at_limit,1);assert.equal(summary.status_token_counts[2],20);
 assert.doesNotMatch(JSON.stringify(summary),/private-object|private-log/);
 assert.match(sourceFingerprint(schema),/^[a-f0-9]{64}$/);
});
test('actual MySQL JSON booleans and numeric flags have the same aggregation semantics',()=>{
 const row={kind:'history',sample_object_kind:'STORY',sample_object_id:'synthetic',content_shape:{json_valid:true,is_null:false},has_status_word:true,status_tokens:{token_0:true},exact_status_tokens:{token_0:1}};
 const s=summarizeSamples([row,{...row,content_shape:{json_valid:null,is_null:true},has_status_word:0,status_tokens:{},exact_status_tokens:{}}]);
 assert.equal(s.content_json_valid_count,1);assert.equal(s.content_null_count,1);assert.equal(s.status_word_count,1);assert.equal(s.status_token_counts[0],1);assert.equal(s.exact_status_token_counts[0],1);
});

test('seed provenance refuses pending, changed config/source, path traversal and invalid hashes',()=>{
 const configHash='b'.repeat(64);const pointer={status:'ready',config_fingerprint:configHash,source_fingerprint:sourceFingerprint(schema),file:'mysql-sample-1234-abcd.json',sha256:'a'.repeat(64)};
 assert.equal(validateSeedReference(pointer,schema,configHash),pointer.file);
 for(const bad of [{...pointer,status:'pending'},{...pointer,config_fingerprint:'other'},{...pointer,file:'../secrets/test.json'},{...pointer,sha256:'invalid'}])assert.throws(()=>validateSeedReference(bad,schema,configHash));
 assert.throws(()=>validateSeedReference(pointer,'different_source',configHash));
});
test('member candidates use observed event code, not the unverified comment literal alone',()=>{
 const summary=summarizeSamples([{kind:'project_history',event_code:'projectMember'},{kind:'project_history',event_code:'projectBaseInfo'}]);
 assert.equal(summary.member_candidate_count,1);
});
