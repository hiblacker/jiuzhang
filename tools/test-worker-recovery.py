#!/usr/bin/env python3
"""Kills owned worker processes at actual read/publication boundaries; uses synthetic data only."""
from importlib import import_module
from pathlib import Path
import json, os, signal, subprocess, time, uuid
Client=import_module('test-identity').Client
sql=import_module('test-execution-safety').sql


def until(check, timeout=120):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        value=check()
        if value:return value
        time.sleep(.25)
    raise AssertionError('Timed out waiting for controlled recovery state')


def main():
    c=Client()
    c.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    fixture=json.loads(Path('.local/safety-test.json').read_text());did=fixture['id'];table=fixture['table']
    # Do not stop arbitrary Java processes. The operator must stop their existing Worker first.
    existing=subprocess.check_output(['pgrep','-af',r'java -jar .local/runtime/worker-'],text=True) if subprocess.run(['pgrep','-f',r'java -jar .local/runtime/worker-'],capture_output=True).returncode==0 else ''
    assert not existing,'Stop the project Worker before running this exclusive recovery test'
    log=Path('.local/worker-recovery.log').open('w')
    worker=None
    def launch():
        return subprocess.Popen(['bash','tools/backend.sh','worker'],stdout=log,stderr=subprocess.STDOUT)
    def kill():
        nonlocal worker
        worker.kill();worker.wait(timeout=10);worker=None
    def start():return c.call('POST','/datasets/'+did+'/runs',{},expected=201,extra_headers={'Idempotency-Key':str(uuid.uuid4())})[0]['data']
    def state(run):return c.call('GET','/runs/'+run['id'])[0]['data']
    def wait(run,status):
        r=until(lambda:(x if (x:=state(run))['status'] in ['succeeded','failed','blocked','canceled'] else None))
        assert r['status']==status,r
        return r
    def current():return sql('metadata','SELECT current_run_id FROM warehouse_target WHERE dataset_id='+did)
    source_lock=None;gate=None
    gate_key=93847021
    trigger='jz_accept_publish_'+did
    try:
        worker=launch()
        baseline=current()
        source_lock=subprocess.Popen(['docker','compose','--env-file','.env','-f','infra/compose.yaml','exec','-T','source','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot demo_retail'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        source_lock.stdin.write('LOCK TABLES '+table+' WRITE; SELECT "LOCKED";\n');source_lock.stdin.flush()
        # The client stays connected holding a real source write lock until stdin is closed.
        run=start()
        until(lambda:state(run)['status']=='running')
        until(lambda:sql('metadata','SELECT staging_table IS NOT NULL FROM dataset_run WHERE id='+run['id'])=='t')
        until(lambda:int(sql('source',"SELECT count(*) FROM information_schema.processlist WHERE USER='jiuzhang_reader' AND STATE LIKE 'Waiting%' AND INFO LIKE '%"+table+"%'").splitlines()[-1])>0)
        kill()
        source_lock.stdin.close();source_lock.wait(timeout=10);source_lock=None
        assert current()==baseline
        print('Worker killed during source read; waiting for real 90-second lease expiry.',flush=True)
        worker=launch()
        failed=wait(run,'failed');assert failed['errorCode']=='WORKER_LOST',failed
        assert current()==baseline
        retry=c.call('POST','/runs/'+run['id']+'/retry',{},expected=201,extra_headers={'Idempotency-Key':str(uuid.uuid4())})[0]['data']
        wait(retry,'succeeded');assert retry['datasetVersion']==run['datasetVersion']
        print('PASS actual read crash: old snapshot kept, lease expiry, new-run retry.',flush=True)
        # A database advisory lock pauses the real success UPDATE after Doris VIEW was changed.
        gate=subprocess.Popen(['docker','compose','--env-file','.env','-f','infra/compose.yaml','exec','-T','metadata','psql','-U','jiuzhang','-At'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        gate.stdin.write('SELECT pg_advisory_lock('+str(gate_key)+');\n');gate.stdin.flush()
        until(lambda:int(sql('metadata','SELECT count(*) FROM pg_locks WHERE locktype=\'advisory\' AND objid='+str(gate_key)+' AND granted'))==1)
        sql('metadata',"CREATE FUNCTION "+trigger+"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.dataset_id="+did+" AND NEW.status='succeeded' THEN PERFORM pg_advisory_xact_lock("+str(gate_key)+"); END IF; RETURN NEW; END $$; CREATE TRIGGER "+trigger+" BEFORE UPDATE ON dataset_run FOR EACH ROW EXECUTE FUNCTION "+trigger+"();")
        baseline=current();run=start()
        until(lambda:int(sql('metadata',"SELECT count(*) FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE 'UPDATE dataset_run SET status=%'"))>0,45)
        assert state(run)['status']=='publishing' and current()==baseline
        physical=sql('metadata','SELECT physical_table FROM warehouse_snapshot WHERE run_id='+run['id'])
        logical=sql('metadata','SELECT target_name FROM dataset WHERE id='+did)
        result=subprocess.run(['docker','compose','-f','infra/doris.compose.yaml','exec','-T','warehouse-fe','mysql','-h127.0.0.1','-P9030','-uroot','-N','-e','SHOW CREATE VIEW jiuzhang.'+logical],capture_output=True,text=True,check=True)
        assert physical in result.stdout,'Gate must be reached after actual Doris view assignment'
        kill()
        gate.stdin.close();gate.wait(timeout=10);gate=None
        sql('metadata','DROP TRIGGER '+trigger+' ON dataset_run; DROP FUNCTION '+trigger+'();')
        print('Worker killed after actual Doris VIEW update, before PostgreSQL success commit; waiting for lease recovery.',flush=True)
        worker=launch();wait(run,'succeeded')
        assert current()==run['id']
        print('PASS actual publication crash: same immutable table reconciled, metadata committed once.',flush=True)
    finally:
        if source_lock:
            source_lock.stdin.close();source_lock.wait(timeout=10)
        if gate:
            gate.stdin.close();gate.wait(timeout=10)
        sql('metadata','DROP TRIGGER IF EXISTS '+trigger+' ON dataset_run; DROP FUNCTION IF EXISTS '+trigger+'();')
        if worker:
            worker.terminate();worker.wait(timeout=15)
        log.close()

if __name__=='__main__':main()
