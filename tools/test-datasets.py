#!/usr/bin/env python3
"""Actual PostgreSQL/MySQL/API: draft, frozen rules/source contracts and publication idempotency."""
from importlib import import_module
from pathlib import Path
import json
import os
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
 body['definition']['output']['table']='test_'+suffix
 dataset,_=c.call('POST','/datasets',body,expected=201);did=dataset['data']['id']
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
 changed_delivery=json.loads(json.dumps(sql_body));changed_delivery['definition']['deliveryMode']='warehouse'
 c.call('PATCH','/datasets/'+direct_id,changed_delivery,expected=409)
 # Restore referenced policies for the next full execution acceptance.
 c.call('PATCH','/governance/masking/'+mask['data']['id'],{'parameter':'3,4','enabled':True});c.call('PATCH','/governance/quality/'+quality['data']['id'],{'parameter':'0,20000','enabled':True})
 Path('.local/dataset-test.json').write_text(json.dumps({'id':did,'body':body,'version':1}))
 print('PASS real dataset: preview without target, exact visual/SQL results, direct SQL publication/query, masking, immutable snapshots, idempotency and restore')
if __name__=='__main__':main()
