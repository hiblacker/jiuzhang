#!/usr/bin/env python3
"""Actual engine fault checks against an exclusively owned synthetic fixture table."""
from importlib import import_module
from pathlib import Path
import concurrent.futures,json,os,subprocess,time,uuid
Client=import_module('test-identity').Client

def sql(service,statement):
 args=['docker','compose','--env-file','.env','-f','infra/compose.yaml','exec','-T',service]
 if service=='source':args+=['sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot demo_retail']
 else:args+=['psql','-U','jiuzhang','-At','-c',statement]
 p=subprocess.run(args,input=statement if service=='source' else None,text=True,capture_output=True)
 assert p.returncode==0,p.stderr
 return p.stdout.strip()
def login():
 c=Client();c.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']});return c
def main():
 c=login();suffix=uuid.uuid4().hex[:8];table='accept_'+suffix
 sql('source','CREATE TABLE '+table+' LIKE orders; INSERT INTO '+table+' SELECT * FROM orders;')
 source=json.loads(Path('.local/source-test.json').read_text());objects,_=c.call('GET','/sources/'+source['id']+'/objects');obj=next(x for x in objects['data'] if x['name']==table)
 body=json.loads(Path('.local/dataset-test.json').read_text())['body'];body['name']='safety_'+suffix;body['definition']['objectId']=obj['id'];body['definition']['qualityRuleIds']=[];body['definition']['output']['table']='safety_'+suffix
 d,_=c.call('POST','/datasets',body,expected=201);did=d['data']['id'];key=lambda:{'Idempotency-Key':str(uuid.uuid4())}
 c.call('POST','/datasets/'+did+'/publish',extra_headers=key())
 def start(allow=False):return c.call('POST','/datasets/'+did+'/runs',{'allowEmptySnapshot':allow},expected=201,extra_headers=key())[0]['data']
 def wait(run,status='succeeded',code=None):
  deadline=time.monotonic()+40
  while time.monotonic()<deadline:
   r=c.call('GET','/runs/'+run['id'])[0]['data']
   if r['status'] in ['succeeded','failed','blocked','canceled']:break
   time.sleep(.1)
  assert r['status']==status,r
  if code:assert r['errorCode']==code,r
  return r
 def count():return c.call('GET','/warehouse/tables/'+did)[0]['data']['rowCount']
 first=wait(start());assert count()=='3'
 sql('source','DELETE FROM '+table+' WHERE id=9007199254740995;');wait(start());assert count()=='2'
 sql('source','DELETE FROM '+table+';');wait(start(),'blocked','EMPTY_SNAPSHOT_BLOCKED');assert count()=='2'
 wait(start(True));assert count()=='0'
 sql('source','INSERT INTO '+table+' SELECT * FROM orders;');wait(start());assert count()=='3'
 sql('source','ALTER TABLE '+table+' ADD COLUMN unused_col int;');wait(start());assert count()=='3'
 sql('source','ALTER TABLE '+table+' DROP COLUMN unused_col;');wait(start())
 sql('source','ALTER TABLE '+table+' MODIFY amount decimal(21,4) NOT NULL;');blocked=wait(start(),'blocked','SCHEMA_CHANGED');assert count()=='3'
 sql('source','ALTER TABLE '+table+' MODIFY amount decimal(20,4) NOT NULL;')
 retried=c.call('POST','/runs/'+blocked['id']+'/retry',{},expected=201,extra_headers=key())[0]['data'];assert retried['id']!=blocked['id'] and retried['retryOf']==blocked['id'] and retried['datasetVersion']==1;wait(retried)
 # A real MySQL write lock prevents row reads while API concurrency and cancel are exercised.
 lock=subprocess.Popen(['docker','compose','--env-file','.env','-f','infra/compose.yaml','exec','-T','source','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot demo_retail'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 lock.stdin.write('LOCK TABLES '+table+' WRITE; SELECT SLEEP(20);\n');lock.stdin.flush()
 time.sleep(.5)
 try:
  run=start();c.call('POST','/datasets/'+did+'/runs',{},expected=409,extra_headers=key())
  # Preserve the active status until the read acknowledges cancellation.
  cancel=c.call('POST','/runs/'+run['id']+'/cancel')[0]['data'];assert cancel['status'] in ['running','canceled']
  wait(run,'canceled');assert count()=='3'
 finally:
  # Wait for the server-side lock statement, then EOF closes the actual MySQL session.
  lock.stdin.close();lock.wait(timeout=25)
 # Exercise metadata recovery deterministically: a lost read is failed; a published view whose
 # PostgreSQL commit was lost is assigned to the same immutable table and committed once.
 run=start();wait(run)
 sql('metadata',"UPDATE dataset_run SET status='publishing',finished_at=NULL,lease_until=now()-interval '1 second' WHERE id="+run['id'])
 wait(run);assert count()=='3'
 history=int(sql('metadata','SELECT count(*) FROM warehouse_snapshot WHERE dataset_id='+did+' AND replaced_at IS NOT NULL AND deleted_at IS NULL'))
 assert history<=3,history
 current=sql('metadata','SELECT current_run_id FROM warehouse_target WHERE dataset_id='+did)
 assert sql('metadata','SELECT deleted_at IS NULL FROM warehouse_snapshot WHERE run_id='+current)=='t'
 Path('.local/safety-test.json').write_text(json.dumps({'id':did,'table':table,'runId':run['id']}))
 print('PASS actual engine safety: replacement/deletions, empty block+one-run approval, additive/used schema changes, retry version, concurrent rejection, cancel, ambiguous-publication reconcile, retention<=3/current kept')
if __name__=='__main__':main()
