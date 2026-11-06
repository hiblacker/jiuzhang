#!/usr/bin/env python3
"""Real API/MySQL/Doris: append batches, scheduling, version isolation and replacement."""
from importlib import import_module
from pathlib import Path
import json
import os
import time
import uuid

Client = import_module('test-identity').Client
sql = import_module('test-execution-safety').sql


def main():
    client = Client()
    client.call('POST', '/auth/login', {
        'username': os.environ['JIUZHANG_BOOTSTRAP_USER'],
        'password': os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    source = json.loads(Path('.local/source-test.json').read_text())
    suffix = uuid.uuid4().hex[:10]
    definition = {
        'sourceId': source['id'], 'objectId': '', 'upstreamDatasetId': '', 'mode': 'sql',
        'sql': "SELECT CAST(9007199254740993 AS SIGNED) AS id, CAST('12345.6700' AS DECIMAL(20,4)) AS amount",
        'fields': [], 'nodes': [{'id': 'input', 'type': 'input', 'label': '', 'x': 0, 'y': 0, 'config': ''}],
        'edges': [], 'cleaning': [], 'qualityRuleIds': [], 'maskPolicyIds': [],
        'deliveryMode': 'warehouse',
        'schedule': {'mode': 'manual', 'cron': '* * * * *', 'intervalMinutes': 1,
                     'timezone': 'Asia/Shanghai', 'retries': 0, 'timeoutSeconds': 60,
                     'concurrency': 1, 'dependencies': []},
        'output': {'table': 'append_' + suffix, 'layer': 'DWS', 'keys': ['id'], 'writeMode': 'append'}}
    body = {'name': 'append_' + suffix, 'description': 'synthetic append acceptance',
            'owner': 'verification', 'tags': [], 'definition': definition}
    preview = client.call('POST', '/datasets/preview', body)[0]['data']
    definition['fields'] = preview['fields']
    for field in definition['fields']:
        field['type'] = 'integer' if field['name'] == 'id' else 'decimal(20,4)'
    dataset = client.call('POST', '/datasets', body, expected=201)[0]['data']['id']

    def key():
        return {'Idempotency-Key': uuid.uuid4().hex}

    def publish():
        return client.call('POST', '/datasets/' + dataset + '/publish', extra_headers=key())[0]['data']

    def start(headers=None):
        return client.call('POST', '/datasets/' + dataset + '/runs', {}, expected=201,
                           extra_headers=headers or key())[0]['data']

    def wait(run, expected='succeeded'):
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            value = client.call('GET', '/runs/' + run['id'])[0]['data']
            if value['status'] in ('succeeded', 'failed', 'blocked', 'canceled'):
                assert value['status'] == expected, value['errorCode']
                return value
            time.sleep(.1)
        raise AssertionError('Run did not reach a terminal state')

    def table():
        return client.call('GET', '/warehouse/tables/' + dataset)[0]['data']

    def save():
        client.call('PATCH', '/datasets/' + dataset, body)

    publish()
    first_key = key()
    first = start(first_key)
    assert start(first_key)['id'] == first['id']
    assert wait(first)['writeMode'] == 'append'
    assert table()['rowCount'] == '1'
    assert start(first_key)['id'] == first['id']
    assert table()['rowCount'] == '1'
    assert wait(start())['rowCount'] == '1'
    assert table()['rowCount'] == '2', 'Business keys must not silently deduplicate append results'
    assert all(row['id'] == '9007199254740993' and row['amount'] == '12345.6700'
               for row in table()['sample'])

    # Make exactly this synthetic task eligible without waiting for a wall-clock minute.
    schedule = {**definition['schedule'], 'mode': 'interval'}
    client.call('PATCH', '/tasks/' + dataset, {'schedule': schedule})
    task = client.call('GET', '/tasks/' + dataset)[0]['data']
    previous = task['lastSuccessRunId']
    assert task['writeMode'] == 'append' and task['datasetVersion'] == 1
    client.call('POST', '/tasks/' + dataset + '/resume')
    try:
        sql('metadata', "UPDATE dataset_schedule SET next_run_at=clock_timestamp()-interval '1 second' WHERE dataset_id=" + dataset)
        deadline = time.monotonic() + 40
        scheduled = None
        while time.monotonic() < deadline:
            task = client.call('GET', '/tasks/' + dataset)[0]['data']
            if task['lastSuccessRunId'] != previous:
                scheduled = client.call('GET', '/runs/' + task['lastSuccessRunId'])[0]['data']
                break
            time.sleep(.1)
        assert scheduled and scheduled['writeMode'] == 'append' and scheduled['trigger'] == 'schedule'
        assert table()['rowCount'] == '3'
    finally:
        client.call('POST', '/tasks/' + dataset + '/pause')

    # A saved draft must not alter manual/scheduled execution of the published version.
    definition['output']['writeMode'] = 'replace'
    definition['sql'] = definition['sql'].replace('12345.6700', '80.0000')
    save()
    draft = client.call('GET', '/datasets/' + dataset)[0]['data']
    assert draft['definition']['output']['writeMode'] == 'replace' and draft['publishedWriteMode'] == 'append'
    assert client.call('GET', '/tasks/' + dataset)[0]['data']['writeMode'] == 'append'
    assert wait(start())['writeMode'] == 'append' and table()['rowCount'] == '4'
    publish()
    replacement = wait(start())
    assert replacement['writeMode'] == 'replace' and replacement['datasetVersion'] == 2
    assert table()['rowCount'] == '1' and table()['sample'][0]['amount'] == '80.0000'
    assert client.call('GET', '/runs/' + first['id'])[0]['data']['writeMode'] == 'append'

    definition['output']['writeMode'] = 'append'
    definition['sql'] += ' WHERE 1=0'
    save()
    publish()
    empty = wait(start())
    assert empty['writeMode'] == 'append' and empty['rowCount'] == '0'
    assert table()['rowCount'] == '1' and table()['sample'][0]['amount'] == '80.0000'

    definition['fields'][1]['target'] = 'renamed_amount'
    save()
    publish()
    mismatch = wait(start(), 'blocked')
    assert mismatch['errorCode'] == 'APPEND_SCHEMA_MISMATCH' and table()['rowCount'] == '1'
    Path('.local/append-test.json').write_text(json.dumps({
        'datasetId': dataset, 'firstRunId': first['id'], 'emptyRunId': empty['id'],
        'blockedRunId': mismatch['id'], 'scheduledRunId': scheduled['id']}))
    print('PASS real append: duplicate business keys, exact values, request idempotency, scheduled append, '
          'draft/published/history isolation, full replacement, empty append and incompatible-schema protection')


if __name__ == '__main__':
    main()
