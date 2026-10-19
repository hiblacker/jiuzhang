#!/usr/bin/env python3
"""Real Doris read/query/export acceptance, including exact values and private ownership."""
from importlib import import_module
from pathlib import Path
import json,os,time,uuid
Client=import_module('test-identity').Client
sql=import_module('test-execution-safety').sql

def main():
 c=Client();c.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
 did=json.loads(Path('.local/dataset-test.json').read_text())['id']
 table,_=c.call('GET','/warehouse/tables/'+did);t=table['data'];assert t['rowCount']=='3';assert any(x['id']=='9007199254740993' and x['amount']=='12345.6700' for x in t['sample']);assert all(x['phone'] is None or '*' in x['phone'] for x in t['sample'])
 key={'Idempotency-Key':str(uuid.uuid4())};query_sql='SELECT id, amount, phone FROM '+t['name']+' LIMIT 2 OFFSET 1'
 query,_=c.call('POST','/queries',{'sql':query_sql},expected=201,extra_headers=key);q=query['data'];assert len(q['rows'])==2
 again,_=c.call('POST','/queries',{'sql':query_sql},expected=201,extra_headers=key);assert again['data']['id']==q['id']
 c.call('POST','/queries',{'sql':query_sql+' '},expected=409,extra_headers=key)
 for invalid_sql in ['DELETE FROM '+t['name'],'SELECT sleep(5) FROM '+t['name'],'SELECT * FROM jz_s_1','SELECT * FROM '+t['name']+';SELECT 1','SELECT * FROM '+t['name']+' LIMIT 9999','SELECT * FROM '+t['name']+' JOIN '+t['name']+' b ON 1=1']:
  c.call('POST','/queries',{'sql':invalid_sql},expected=422,extra_headers={'Idempotency-Key':str(uuid.uuid4())})
 export_key=str(uuid.uuid4());export_body={'queryId':q['id'],'format':'csv'}
 export,_=c.call('POST','/exports',export_body,expected=201,extra_headers={'Idempotency-Key':export_key});assert export['data']['status']=='ready' and 'phone' in export['data']['content'];assert '13800138000' not in export['data']['content']
 username='warehouse_'+uuid.uuid4().hex[:8];password=uuid.uuid4().hex;user,_=c.call('POST','/system/users',{'username':username,'password':password,'name':'warehouse test','role':'viewer','enabled':True},expected=201)
 viewer=Client();viewer.call('POST','/auth/login',{'username':username,'password':password});viewer.call('GET','/queries/'+q['id'],expected=403);viewer.call('GET','/exports/'+export['data']['id'],expected=403)
 own,_=viewer.call('POST','/queries',{'sql':'SELECT * FROM '+t['name']+' LIMIT 1'},expected=201,extra_headers={'Idempotency-Key':str(uuid.uuid4())});assert all(row.get('phone') is None or '*' in row['phone'] for row in own['data']['rows'])
 c.call('PATCH','/system/users/'+user['data']['id'],{'enabled':False})
 sql('metadata',"UPDATE warehouse_export SET body=jsonb_set(body,'{expiresAt}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE id="+export['data']['id'])
 deadline=time.monotonic()+90
 while time.monotonic()<deadline:
  if sql('metadata',"SELECT body->>'content' FROM warehouse_export WHERE id="+export['data']['id'])=='':break
  time.sleep(1)
 assert sql('metadata',"SELECT body->>'content' FROM warehouse_export WHERE id="+export['data']['id'])=='','Worker did not scrub the expired CSV payload'
 expired,_=c.call('GET','/exports/'+export['data']['id']);assert expired['data']['status']=='expired' and expired['data']['content']==''
 replay,_=c.call('POST','/exports',export_body,expected=201,extra_headers={'Idempotency-Key':export_key});assert replay['data']['id']==export['data']['id'] and replay['data']['status']=='expired' and replay['data']['content']==''
 Path('.local/warehouse-test.json').write_text(json.dumps({'tableId':did,'queryId':q['id'],'exportId':export['data']['id']}))
 print('PASS actual Doris: table/precision/null/masked data, SELECT pagination, SQL rejection, query/export idempotency, CSV/private ownership and scheduled expired-content cleanup')
if __name__=='__main__':main()
