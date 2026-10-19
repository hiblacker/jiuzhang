#!/usr/bin/env python3
from importlib import import_module
from pathlib import Path
import json,os,time,uuid
Client=import_module('test-identity').Client

def main():
 c=Client();c.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
 d=json.loads(Path('.local/dataset-test.json').read_text());did=d['id'];key={'Idempotency-Key':str(uuid.uuid4())}
 run,_=c.call('POST','/datasets/'+did+'/runs',{},expected=201,extra_headers=key);rid=run['data']['id']
 for i in range(120):
  r,_=c.call('GET','/runs/'+rid)
  if r['data']['status'] in ['succeeded','failed','blocked','canceled']:break
  time.sleep(.5)
 # Only state/log codes are returned; no raw source values are printed.
 print('run='+rid+' status='+r['data']['status']+' rows='+r['data']['rowCount'])
 assert r['data']['status']=='succeeded',r
 again,_=c.call('POST','/datasets/'+did+'/runs',{},expected=201,extra_headers=key);assert again['data']['id']==rid
 Path('.local/run-test.json').write_text(json.dumps({'id':rid,'datasetId':did}))
 print('PASS actual full execution, terminal status and idempotent admission')
if __name__=='__main__':main()
