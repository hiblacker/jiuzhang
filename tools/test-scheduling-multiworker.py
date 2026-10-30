#!/usr/bin/env python3
"""Four real one-minute slots, two owned Workers, deterministic SIGKILL during admission."""
from datetime import datetime, timedelta, timezone
from importlib import import_module
from pathlib import Path
import json
import os
import shutil
import subprocess
import time
import uuid
import urllib.request

local = import_module('local-stack')
build = import_module('backend-build')
Session = import_module('acceptance-db').Session
Client = import_module('test-identity').Client
TERMINAL = {'succeeded', 'failed', 'blocked', 'canceled'}


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def worker_pids():
    found = set()
    for process in Path('/proc').glob('[0-9]*'):
        try:
            arguments = (process/'cmdline').read_bytes().split(b'\0')
            if len(arguments) >= 3 and arguments[1] == b'-jar' and b'.local/runtime/worker-' in arguments[2]:
                found.add(int(process.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    return found


def main():
    os.chdir(local.ROOT)
    build.check('worker')
    original = local.managed('worker')
    expected_pids = {original['pid']} if original else set()
    assert worker_pids() == expected_pids, 'Unowned Worker detected; no process was stopped'
    client = Client()
    statuses = {}
    class StatusRecorder(urllib.request.BaseHandler):
        def http_response(self, request, response):
            statuses[str(response.code)] = statuses.get(str(response.code), 0)+1
            return response
        https_response = http_response
    client.http.add_handler(StatusRecorder())
    client.call('POST', '/auth/login', {'username': os.environ['JIUZHANG_BOOTSTRAP_USER'],
                                      'password': os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    active, _ = client.call('GET', '/runs?pageSize=100')
    assert not any(row['status'] not in TERMINAL for row in active['data']), 'Existing runs are active; no process was stopped'
    source = json.loads((local.LOCAL/'source-test.json').read_text())
    suffix = uuid.uuid4().hex[:10]
    log_dir = local.LOCAL/('scheduling-multiworker-'+suffix)
    log_dir.mkdir()
    names = ['jz_schedule_'+suffix+'_a', 'jz_schedule_'+suffix+'_b']
    workers, logs = {}, []
    task_id = None
    trigger = 'jz_schedule_gate_'+suffix
    gate_key = int(suffix[:7], 16)
    gate_locked = False
    report = {'cycles': 4, 'periodSeconds': 60, 'workers': names}
    if original:
        local.stop('worker')
    try:
        with Session() as db, Session() as gate:
            body = {'name': 'multiworker_'+suffix, 'description': 'synthetic scheduling acceptance',
                    'owner': 'test', 'tags': ['scheduling-multiworker'], 'definition': {
                        'sourceId': source['id'], 'objectId': '', 'upstreamDatasetId': '',
                        'mode': 'sql', 'deliveryMode': 'warehouse',
                        'sql': 'SELECT 1 AS id, CAST(123.45 AS DECIMAL(10,2)) AS amount',
                        'fields': [], 'nodes': [], 'edges': [], 'cleaning': [],
                        'qualityRuleIds': [], 'maskPolicyIds': [], 'schedule': {
                            'mode': 'manual', 'cron': '* * * * *', 'intervalMinutes': 1,
                            'timezone': 'Asia/Shanghai', 'retries': 0, 'timeoutSeconds': 30,
                            'concurrency': 1, 'dependencies': []},
                        'output': {'table': 'multiworker_'+suffix, 'layer': 'DWD', 'keys': [], 'writeMode': 'replace'}}}
            preview, _ = client.call('POST', '/datasets/preview', body)
            body['definition']['fields'] = preview['data']['fields']
            for field in body['definition']['fields']:
                field['type'] = 'integer' if field['name'] == 'id' else 'decimal(10,2)'
            dataset, _ = client.call('POST', '/datasets', body, expected=201)
            task_id = dataset['data']['id']
            report['datasetId'] = task_id
            client.call('POST', '/datasets/'+task_id+'/publish', extra_headers={'Idempotency-Key': str(uuid.uuid4())})
            client.call('GET', '/tasks/'+task_id)
            client.call('POST', '/tasks/'+task_id+'/pause')
            schedule = {**body['definition']['schedule'], 'mode': 'interval'}
            client.call('PATCH', '/tasks/'+task_id, {'schedule': schedule})
            runtime = local.LOCAL/'runtime'
            runtime.mkdir(exist_ok=True)
            for name in names:
                jar = runtime/('worker-'+name+'.jar')
                shutil.copyfile(build.artifact('worker'), jar)
                assert build.checksum(jar) == build.check('worker'), 'Worker copy does not match verified build'
                env = local.environment()
                url = env.get('METADATA_URL', 'jdbc:postgresql://127.0.0.1:15432/jiuzhang')
                env['METADATA_URL'] = url+('&' if '?' in url else '?')+'ApplicationName='+name
                env['JIUZHANG_SCHEDULER_INTERVAL_MS'] = '1000'
                log = (log_dir/(name+'.log')).open('w')
                logs.append(log)
                workers[name] = subprocess.Popen(['java', '-jar', str(jar)], cwd=local.ROOT,
                    env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            started = client.call('POST', '/tasks/'+task_id+'/resume')[0]['data']
            first = instant(started['nextRunAt'])
            slots = [first+timedelta(minutes=index) for index in range(4)]
            crash_slot = slots[1]
            gate.execute('SELECT pg_advisory_lock(?)', [gate_key])
            gate_locked = True
            db.execute('CREATE FUNCTION '+trigger+"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.dataset_id="+task_id+
                       " AND NEW.trigger='schedule' AND NEW.scheduled_at='"+crash_slot.isoformat()+
                       "'::timestamptz THEN PERFORM pg_advisory_xact_lock("+str(gate_key)+
                       '); END IF; RETURN NEW; END $$')
            db.execute('CREATE TRIGGER '+trigger+' BEFORE INSERT ON dataset_run FOR EACH ROW EXECUTE FUNCTION '+trigger+'()')
            killed = None
            kill_time = None
            previous_next = first
            observed = set()
            deadline = time.monotonic()+360
            last_api = 0
            paused = False
            while time.monotonic() < deadline:
                waiting = db.query("SELECT pid,application_name FROM pg_stat_activity WHERE datname=current_database() AND application_name IN (?,?) AND wait_event='advisory'", names)
                if waiting and killed is None:
                    name = waiting[0]['application_name']
                    assert len(waiting) == 1 and workers[name].poll() is None, 'Expected one live admission owner at the gate'
                    killed = name
                    report['killedWorker'] = name
                    report['killedBackendPid'] = waiting[0]['pid']
                    report['crashScheduledAt'] = crash_slot.isoformat()
                    kill_time = time.monotonic()
                    workers[name].kill()
                    workers[name].wait(timeout=10)
                    gate.execute('SELECT pg_advisory_unlock(?)', [gate_key])
                    gate_locked = False
                    print('SIGKILL at real INSERT gate; survivor owns subsequent admission.', flush=True)
                for name, process in workers.items():
                    if name != killed:
                        assert process.poll() is None, 'A surviving Worker exited'
                records = db.query('SELECT scheduled_at,state,reason,run_id,advanced_to FROM dataset_schedule_slot WHERE dataset_id=? ORDER BY scheduled_at', [int(task_id)])
                cursor = db.query("SELECT s.next_run_at,(SELECT max(advanced_to) FROM dataset_schedule_slot WHERE dataset_id=s.dataset_id AND state IN ('enqueued','skipped')) AS ledger_next FROM dataset_schedule s WHERE s.dataset_id=?", [int(task_id)])[0]
                next_value = cursor['next_run_at']
                if next_value is not None:
                    next_at = instant(next_value)
                    assert next_at >= previous_next, 'next_run_at moved backwards under a stable plan'
                    assert next_at == (instant(cursor['ledger_next']) if cursor['ledger_next'] else first), 'next_run_at does not match the committed slot outcome'
                    previous_next = next_at
                else:
                    assert paused, 'A live interval plan lost its next_run_at'
                assert int(db.scalar("SELECT count(*) FROM dataset_run WHERE dataset_id=? AND status IN ('queued','running','validating','publishing')", [int(task_id)])) <= 1, 'concurrency=1 was violated'
                completed = {instant(row['scheduled_at']): row for row in records if row['state'] != 'pending'}
                for at, row in completed.items():
                    if at not in slots:
                        raise AssertionError('Unexpected historical/catch-up slot')
                    count = int(db.scalar("SELECT count(*) FROM dataset_run WHERE dataset_id=? AND scheduled_at=?::timestamptz AND trigger='schedule'", [int(task_id), at.isoformat()]))
                    if row['state'] == 'enqueued':
                        assert count == 1 and row['run_id'], 'A slot did not have exactly one scheduled run'
                        assert instant(row['advanced_to']) == instant(db.next(schedule, row['scheduled_at'])), 'Cursor disagrees with ScheduleCalculator.next'
                    else:
                        assert at == crash_slot and count == 0 and row['reason'], 'Unexpected or unrecorded skipped slot'
                    if at not in observed:
                        observed.add(at)
                        print('Recorded slot '+at.isoformat()+' -> '+row['state'], flush=True)
                if killed and crash_slot in completed and 'takeoverSeconds' not in report:
                    report['takeoverSeconds'] = round(time.monotonic()-kill_time, 3)
                    assert report['takeoverSeconds'] <= 120, 'Survivor exceeded two periods'
                if time.monotonic()-last_api >= 1:
                    client.call('GET', '/tasks/'+task_id)
                    client.call('GET', '/runs?datasetId='+task_id+'&pageSize=100')
                    last_api = time.monotonic()
                if all(at in completed for at in slots):
                    if not paused:
                        client.call('POST', '/tasks/'+task_id+'/pause')
                        paused = True
                    remaining = db.scalar("SELECT count(*) FROM dataset_run WHERE dataset_id=? AND status NOT IN ('succeeded','failed','blocked','canceled')", [int(task_id)])
                    if int(remaining) == 0:
                        report['slots'] = records
                        break
                time.sleep(0.1)
            else:
                raise AssertionError('Timed out before four slots became observable')
            assert killed and 'takeoverSeconds' in report, 'Deterministic crash was not exercised'
            runs = db.query("SELECT scheduled_at,status FROM dataset_run WHERE dataset_id=? AND trigger='schedule'", [int(task_id)])
            assert runs and all(row['status'] == 'succeeded' for row in runs), 'Scheduled dataset did not really succeed'
            for log in logs:
                log.flush()
            for name in names:
                content = (log_dir/(name+'.log')).read_text()
                assert 'DuplicateKeyException' not in content and 'one_scheduled_run_per_slot' not in content, 'Unique conflict escaped normal admission'
            db.execute('DROP TRIGGER '+trigger+' ON dataset_run; DROP FUNCTION '+trigger+'()')
            report['status'] = 'passed'
            report['httpStatuses'] = statuses
            report['http500'] = statuses.get('500', 0)
            assert report['http500'] == 0, 'A user-visible HTTP 500 occurred'
            (local.LOCAL/'scheduling-multiworker-test.json').write_text(json.dumps(report, indent=2))
            print('PASS two real Workers / four one-minute slots: no duplicate runs or HTTP 500, monotonic calculator-aligned time, SIGKILL takeover in '+str(report['takeoverSeconds'])+'s, observable outcomes.', flush=True)
    finally:
        if task_id:
            try: client.call('POST', '/tasks/'+task_id+'/pause')
            except Exception: pass
        if gate_locked:
            # Closing the owned session releases the gate even on an assertion failure.
            gate.close()
        for process in workers.values():
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)
        for log in logs:
            log.close()
        if task_id:
            with Session() as cleanup:
                cleanup.execute('DROP TRIGGER IF EXISTS '+trigger+' ON dataset_run; DROP FUNCTION IF EXISTS '+trigger+'()')
        if original:
            local.start('worker')


if __name__ == '__main__':
    main()
