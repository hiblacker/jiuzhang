#!/usr/bin/env python3
"""Local-only service outages and aged snapshot cleanup on synthetic test data."""
from importlib import import_module
from pathlib import Path
import json
import os
import subprocess
import time
import uuid


def main():
    local = import_module('local-stack')
    sql = import_module('test-execution-safety').sql
    Client = import_module('test-identity').Client
    os.chdir(local.ROOT)
    env = local.environment()
    assert local.managed('worker'), 'Start the managed Worker first'
    assert sql('metadata', "SELECT count(*) FROM dataset_run WHERE status NOT IN ('succeeded','failed','blocked','canceled')") == '0', 'Run this exclusive local test without active jobs'
    dataset = json.loads(Path('.local/safety-test.json').read_text())['id']
    c = Client()
    c.call('POST', '/auth/login', {'username': env['JIUZHANG_BOOTSTRAP_USER'], 'password': env['JIUZHANG_BOOTSTRAP_PASSWORD']})

    def until(check, seconds=120):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            value = check()
            if value:
                return value
            time.sleep(.5)
        raise AssertionError('Timed out waiting for controlled storage recovery')

    def start():
        return c.call('POST', '/datasets/' + dataset + '/runs', {}, expected=201,
                      extra_headers={'Idempotency-Key': str(uuid.uuid4())})[0]['data']

    def wait(run, expected, code=None):
        def terminal():
            row = c.call('GET', '/runs/' + run['id'])[0]['data']
            return row if row['status'] in ['succeeded', 'failed', 'blocked', 'canceled'] else None
        row = until(terminal)
        assert row['status'] == expected, row
        if code:
            assert row['errorCode'] == code, row
        return row

    def current():
        return sql('metadata', 'SELECT current_run_id FROM warehouse_target WHERE dataset_id=' + dataset)

    def warehouse_sql(statement):
        result = subprocess.run(local.COMPOSE + ['exec', '-T', 'warehouse-fe', 'mysql',
                                '-h127.0.0.1', '-P9030', '-uroot', '-N', '-e', statement],
                                capture_output=True, text=True, check=True)
        return result.stdout.strip()

    def warehouse_ready():
        try:
            return warehouse_sql('SELECT 1') == '1'
        except subprocess.CalledProcessError:
            return False

    def object_exists(key):
        status = local.s3_request('HEAD', key)
        assert status in [200, 404], 'Unexpected S3 HEAD response: ' + str(status)
        return status == 200

    wait(start(), 'succeeded')
    for service, code in [('objects', 'OBJECTS_UNAVAILABLE'), ('warehouse-fe', 'WAREHOUSE_UNAVAILABLE')]:
        baseline = current()
        baseline_raw = sql('metadata', 'SELECT raw_object_key FROM dataset_run WHERE id=' + baseline)
        stopped = False
        try:
            local.run(local.COMPOSE + ['stop', service], stdout=subprocess.DEVNULL)
            stopped = True
            failed = wait(start(), 'failed', code)
            assert current() == baseline, 'Failed storage run replaced the current snapshot'
        finally:
            if stopped:
                local.run(local.COMPOSE + ['up', '-d', '--wait', '--wait-timeout', '180', service])
        if service == 'warehouse-fe':
            until(warehouse_ready)
        else:
            local.wait_storage()
            assert object_exists(baseline_raw), 'S3 restart lost the previous snapshot raw object'
        assert c.call('GET', '/warehouse/tables/' + dataset)[0]['data']['rowCount'] == '3'
        retried = c.call('POST', '/runs/' + failed['id'] + '/retry', {}, expected=201,
                         extra_headers={'Idempotency-Key': str(uuid.uuid4())})[0]['data']
        wait(retried, 'succeeded')
        print('PASS actual ' + service + ' outage: failure keeps old snapshot, restored service and new-run retry succeed', flush=True)

    # Expire one owned historical snapshot without aging the current pointer.
    candidate = sql('metadata', 'SELECT s.run_id,s.physical_table,r.raw_object_key FROM warehouse_snapshot s JOIN dataset_run r ON r.id=s.run_id WHERE s.dataset_id=' + dataset + ' AND s.replaced_at IS NOT NULL AND s.deleted_at IS NULL ORDER BY s.replaced_at DESC LIMIT 1').split('|')
    assert len(candidate) == 3
    run_id, physical, raw = candidate
    assert object_exists(raw), 'Historical raw object must exist before cleanup'
    assert warehouse_sql("SHOW TABLES FROM jiuzhang LIKE '" + physical + "'") == physical
    baseline = current()
    sql('metadata', "UPDATE warehouse_snapshot SET replaced_at=now()-interval '8 days' WHERE run_id=" + run_id + ' AND dataset_id=' + dataset + ' AND replaced_at IS NOT NULL')
    until(lambda: sql('metadata', 'SELECT deleted_at IS NOT NULL FROM warehouse_snapshot WHERE run_id=' + run_id) == 't')
    assert not object_exists(raw), 'Expired raw object remains'
    assert warehouse_sql("SHOW TABLES FROM jiuzhang LIKE '" + physical + "'") == ''
    assert current() == baseline
    current_raw = sql('metadata', 'SELECT raw_object_key FROM dataset_run WHERE id=' + baseline)
    assert object_exists(current_raw), 'Cleanup removed the current raw object'
    assert c.call('GET', '/warehouse/tables/' + dataset)[0]['data']['rowCount'] == '3'
    print('PASS actual seven-day retention: historical Doris table and S3 raw object removed; current snapshot and raw object retained')


if __name__ == '__main__':
    main()
