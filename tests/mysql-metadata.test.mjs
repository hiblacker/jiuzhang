import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDetailsSql, parseDetailsOutput } from '../tools/mysql-metadata.mjs';
const selection = { schemas:['synthetic'], targets:[{schema:'synthetic',table:'ITEM'}] };
test('metadata templates bind values and retain bounded read-only session', () => {
  const sql = buildDetailsSql(selection);
  assert.match(sql, /SET SESSION transaction_read_only = ON/);
  assert.match(sql, /START TRANSACTION READ ONLY/);
  assert.match(sql, /max_execution_time = 15000/);
  assert.equal((sql.match(/PREPARE metadata_query FROM/g)??[]).length,6);
  assert.match(sql, /EXECUTE metadata_query USING @p0, @p1/);
  assert.doesNotMatch(sql, /synthetic/);
  assert.ok(sql.endsWith('COMMIT;\n'));
});
test('untrusted names cannot break out of bound values', () => {
  const name="a'; DROP TABLE x; --";
  const sql = buildDetailsSql({ schemas:[name], targets:[{schema:name,table:'`quoted`'}] });
  assert.doesNotMatch(sql, /DROP TABLE|quoted/);
  assert.ok(sql.includes(Buffer.from(name).toString('hex')));
});
test('selection count, scope, names and timeout fail closed', () => {
  for (const bad of [null, {...selection,schemas:[]}, {...selection,targets:Array(21).fill(selection.targets[0])}, {...selection,targets:[{schema:'other',table:'ITEM'}]}, {...selection,schemas:['a\n']}, {...selection,targets:[{schema:'synthetic',table:'x'.repeat(65)}]}]) assert.throws(()=>buildDetailsSql(bad));
  for (const bad of [0,-1,15001,'15000']) assert.throws(()=>buildDetailsSql(selection,bad));
  assert.match(buildDetailsSql(selection,2000),/max_execution_time = 2000/);
});
test('duplicate targets are queried once', () => {
  const sql=buildDetailsSql({...selection,targets:[selection.targets[0],selection.targets[0]]});
  assert.equal((sql.match(/PREPARE metadata_query FROM/g)??[]).length,6);
});
test('batch JSON escapes round trip and headers are ignored', () => {
  const row={kind:'column',schema:'synthetic',table:'ITEM',comment:'a\nb\tc\\d"'};
  const text=JSON.stringify(row).replace(/\\/g,'\\\\');
  assert.deepEqual(parseDetailsOutput('metadata_json\n'+text+'\n').records,[row]);
  assert.throws(()=>parseDetailsOutput('{broken'));
});
test('cap detection groups related catalog by schema rather than each table', () => {
  const text=Array.from({length:200},(_,i)=>JSON.stringify({kind:'related_table',schema:'synthetic',table:'T'+i})).join('\n');
  assert.deepEqual(parseDetailsOutput(text).capped_groups,[['related_table','synthetic',null]]);
  assert.equal(parseDetailsOutput(text.split('\n').slice(0,199).join('\n')).capped_groups.length,0);
});

test('catalog-only discovery requires explicit intent and remains bounded', () => {
  assert.throws(()=>buildDetailsSql({schemas:['synthetic'],targets:[]}));
  const sql=buildDetailsSql({schemas:['synthetic'],targets:[],catalog_only:true});
  assert.equal((sql.match(/PREPARE metadata_query FROM/g)??[]).length,2);
});
