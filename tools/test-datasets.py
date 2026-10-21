#!/usr/bin/env python3
"""Actual PostgreSQL/MySQL/API: draft, frozen rules/source contracts and publication idempotency."""
from importlib import import_module
from pathlib import Path
import json
import os
import time
import uuid
Client=import_module('test-identity').Client

def main():
 c=Client();c.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
 source=json.loads(Path('.local/source-test.json').read_text())
 suffix=uuid.uuid4().hex[:10]
 mask,_=c.call('POST','/governance/masking',{'name':'mask_'+suffix,'description':'','owner':'test','tags':[],'kind':'mask','parameter':'3,4','enabled':True},expected=201)
 quality,_=c.call('POST','/governance/quality',{'name':'quality_'+suffix,'description':'','owner':'test','tags':[],'kind':'range','field':'amount','parameter':'0,20000','severity':'BLOCK','enabled':True},expected=201)
 fields,_=c.call('GET','/sources/'+source['id']+'/objects/'+source['objectId']+'/fields')
 selected=[]
 for f in fields['data']:
  if f['name'] not in ['id','amount','phone']:continue
  f['type']={'id':'integer','amount':'decimal(20,4)','phone':'string'}[f['name']]
  if f['name']=='phone':f['maskPolicyId']=mask['data']['id'];f['sensitive']=True
  selected.append(f)
 body={'name':'dataset_'+suffix,'description':'','owner':'test','tags':[],'definition':{'sourceId':source['id'],'objectId':source['objectId'],'upstreamDatasetId':'','mode':'visual','sql':'','fields':selected,'nodes':[{'id':'input','type':'input','label':'input','x':0,'y':0,'config':''}],'edges':[],'cleaning':[],'qualityRuleIds':[quality['data']['id']],'maskPolicyIds':[mask['data']['id']],'schedule':{'mode':'manual','cron':'0 9 * * *','intervalMinutes':60,'timezone':'Asia/Shanghai','retries':0,'timeoutSeconds':600,'concurrency':1,'dependencies':[]},'output':{'table':'','layer':'DWD','keys':[],'writeMode':'replace'}}}
 preview_without_target,_=c.call('POST','/datasets/preview',body)
 assert any(r['id']=='9007199254740993' and r['amount']=='12345.6700' for r in preview_without_target['data']['rows'])
 # Blank-target drafts can be saved and edited before their first publication.
 dataset,_=c.call('POST','/datasets',body,expected=201);did=dataset['data']['id']
 c.call('POST','/datasets/'+did+'/publish',expected=422,extra_headers={'Idempotency-Key':str(uuid.uuid4())})
 for mode in [None,'','invalid',False]:
  invalid=json.loads(json.dumps(body));invalid['definition']['deliveryMode']=mode
  c.call('PATCH','/datasets/'+did,invalid,expected=422)
 body['definition']['output']['table']='test_'+suffix
 c.call('PATCH','/datasets/'+did,body)
 preview,_=c.call('POST','/datasets/'+did+'/preview');rows=preview['data']['rows'];assert any(r['id']=='9007199254740993' and r['amount']=='12345.6700' for r in rows);assert all(r['phone'] is None or '*' in r['phone'] for r in rows)
 key={'Idempotency-Key':str(uuid.uuid4())};v,_=c.call('POST','/datasets/'+did+'/publish',extra_headers=key);again,_=c.call('POST','/datasets/'+did+'/publish',extra_headers=key);assert again['data']==v['data'];assert v['data']['version']==1
 c.call('PATCH','/governance/masking/'+mask['data']['id'],{'parameter':'0,0','enabled':False})
 c.call('PATCH','/governance/quality/'+quality['data']['id'],{'parameter':'0,1','enabled':False})
 frozen,_=c.call('GET','/datasets/'+did+'/versions/1');assert frozen['data']['maskingSnapshot'][0]['parameter']=='3,4';assert frozen['data']['qualitySnapshot'][0]['parameter']=='0,20000';assert frozen['data']['sourceSnapshots'][0]['object']['name']=='orders'
 c.call('PATCH','/governance/masking/'+mask['data']['id'],{'parameter':'3,4','enabled':True})
 c.call('PATCH','/datasets/'+did,{'description':'','tags':[]});c.call('POST','/datasets/'+did+'/versions/1/restore')
 bad=json.loads(json.dumps(body));bad['name']='bad_'+suffix;bad['definition']['schedule']['retries']=2;c.call('POST','/datasets',bad,expected=422)
 sql_body=json.loads(json.dumps(body));sql_body['name']='direct_sql_'+suffix
 sql_body['definition'].update({'mode':'sql','deliveryMode':'direct','objectId':'','sql':'SELECT id, amount, phone FROM orders','fields':[]})
 sql_preview,_=c.call('POST','/datasets/preview',sql_body)
 assert any(r['id']=='9007199254740993' and r['amount']=='12345.6700' for r in sql_preview['data']['rows'])
 sql_fields=sql_preview['data']['fields']
 for field in sql_fields:
  field['type']={'id':'integer','amount':'decimal(20,4)','phone':'string'}[field['name']]
  if field['name']=='phone':field.update({'sensitive':True,'maskPolicyId':mask['data']['id']})
 sql_body['definition']['fields']=sql_fields
 sql_body['definition']['output']['table']=''
 direct,_=c.call('POST','/datasets',sql_body,expected=201)
 direct_id=direct['data']['id']
 direct_preview,_=c.call('POST','/datasets/'+direct_id+'/preview')
 assert any(r['id']=='9007199254740993' and r['amount']=='12345.6700' and '*' in r['phone'] for r in direct_preview['data']['rows'])
 c.call('POST','/datasets/'+direct_id+'/publish',extra_headers={'Idempotency-Key':str(uuid.uuid4())})
 direct_query,_=c.call('POST','/datasets/'+direct_id+'/query',{'limit':100})
 assert any(r['id']=='9007199254740993' and r['amount']=='12345.6700' and '*' in r['phone'] for r in direct_query['data']['rows'])
 for limit in [0,-1,1001,4294967297,1.5,None,'100']:
  c.call('POST','/datasets/'+direct_id+'/query',{'limit':limit},expected=422)
 changed_delivery=json.loads(json.dumps(sql_body));changed_delivery['definition']['deliveryMode']='warehouse'
 c.call('PATCH','/datasets/'+direct_id,changed_delivery,expected=409)
 c.call('POST','/datasets/'+direct_id+'/runs',{},expected=409,extra_headers={'Idempotency-Key':str(uuid.uuid4())})
 # Verify actual MySQL query forms, not just parser acceptance.
 probe=json.loads(json.dumps(sql_body))
 probe['definition'].update(fields=[],qualityRuleIds=[],maskPolicyIds=[])
 queries=[
  ('WITH chosen AS (SELECT id, amount FROM orders) SELECT * FROM chosen',3),
  ('SELECT a.id, b.amount FROM orders a JOIN orders b ON a.id=b.id',3),
  ('SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS position FROM orders',3),
  ('SELECT id FROM orders WHERE id IN (SELECT id FROM orders)',3),
  ('SELECT COUNT(*) AS total, SUM(amount) AS amount FROM orders',1),
  ('SELECT id FROM orders UNION ALL SELECT id FROM orders',6),
  ("SELECT 'INTO' AS label, 'SLEEP(5)' AS description FROM orders LIMIT 1",1),
 ]
 for sql,count in queries:
  probe['definition']['sql']=sql
  result,_=c.call('POST','/datasets/preview',probe)
  assert len(result['data']['rows'])==count,sql
 for sql in ['UPDATE orders SET amount=0','SELECT 1; DELETE FROM orders','SELECT SLEEP/**/(30)',
             "SELECT GET_LOCK('jz_test',10)",'SELECT id FROM orders FOR/**/UPDATE',
             "SELECT id FROM orders INTO OUTFILE '/tmp/jz-test.csv'",
             "SELECT 1 /*!50000 INTO OUTFILE '/tmp/jz-test.csv' */",
             'SELECT @id := id FROM orders']:
  probe['definition']['sql']=sql
  rejected,_=c.call('POST','/datasets/preview',probe,expected=422)
  assert rejected['error']['code']=='UNSUPPORTED_SQL',sql
 # SQL mappings are applied during full Doris snapshot execution, including masking.
 warehouse_sql=json.loads(json.dumps(sql_body));warehouse_sql['name']='warehouse_sql_'+suffix
 warehouse_sql['definition']['deliveryMode']='warehouse'
 warehouse_sql['definition']['output']['table']='sql_'+suffix
 next(f for f in warehouse_sql['definition']['fields'] if f['name']=='amount')['target']='revenue'
 warehouse_sql['definition']['qualityRuleIds']=[]
 saved,_=c.call('POST','/datasets',warehouse_sql,expected=201);sql_id=saved['data']['id']
 c.call('POST','/datasets/'+sql_id+'/publish',extra_headers={'Idempotency-Key':str(uuid.uuid4())})
 run,_=c.call('POST','/datasets/'+sql_id+'/runs',{},expected=201,extra_headers={'Idempotency-Key':str(uuid.uuid4())})
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  finished,_=c.call('GET','/runs/'+run['data']['id'])
  if finished['data']['status'] in ['succeeded','failed','blocked','canceled']:break
  time.sleep(.2)
 assert finished['data']['status']=='succeeded',finished['data']['errorCode']
 table,_=c.call('GET','/warehouse/tables/'+sql_id)
 assert any(r['id']=='9007199254740993' and r['revenue']=='12345.6700' and '*' in r['phone'] for r in table['data']['sample'])
 changed_target=json.loads(json.dumps(warehouse_sql));changed_target['definition']['output']['table']='changed_'+suffix
 c.call('PATCH','/datasets/'+sql_id,changed_target,expected=409)
 # Restore referenced policies for the next full execution acceptance.
 c.call('PATCH','/governance/masking/'+mask['data']['id'],{'parameter':'3,4','enabled':True});c.call('PATCH','/governance/quality/'+quality['data']['id'],{'parameter':'0,20000','enabled':True})
 Path('.local/dataset-test.json').write_text(json.dumps({'id':did,'body':body,'version':1,'directId':direct_id,'sqlWarehouseId':sql_id}))
 print('PASS real dataset: blank-target draft/edit, missing delivery compatibility, visual/SQL preview, CTE/JOIN/window/subquery/aggregate/UNION/literals, write rejection, direct query, SQL Doris snapshot/renaming/masking, immutable publication and restore')
if __name__=='__main__':main()
