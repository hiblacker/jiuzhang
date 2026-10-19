#!/usr/bin/env python3
"""Real Doris streaming rejection for oversized results and subsequent recovery."""
from importlib import import_module
from pathlib import Path
import copy
import json
import os
import time
import uuid


def main():
    local = import_module('local-stack')
    sql = import_module('test-execution-safety').sql
    Client = import_module('test-identity').Client
    os.chdir(local.ROOT)
    env = local.environment()
    client = Client()
    client.call('POST', '/auth/login', {'username': env['JIUZHANG_BOOTSTRAP_USER'],
                                      'password': env['JIUZHANG_BOOTSTRAP_PASSWORD']})
    suffix = uuid.uuid4().hex[:10]
    table = 'budget_' + suffix
    sql('source', 'CREATE TABLE ' + table + ' (id BIGINT NOT NULL PRIMARY KEY, payload TEXT NOT NULL);'
        + ' INSERT INTO ' + table + ' SELECT n,REPEAT(CHAR(120),60000) FROM ('
        + ' UNION ALL '.join('SELECT ' + str(i) + ' AS n' for i in range(1, 191)) + ') numbers;')
    source = json.loads(Path('.local/source-test.json').read_text())
    objects = client.call('GET', '/sources/' + source['id'] + '/objects')[0]['data']
    obj = next(item for item in objects if item['name'] == table)
    body = copy.deepcopy(json.loads(Path('.local/dataset-test.json').read_text())['body'])
    body['name'] = table
    definition = body['definition']
    definition['objectId'] = obj['id']
    definition['qualityRuleIds'] = []
    definition['maskPolicyIds'] = []
    definition['fields'] = [dict(name=name, target=name, type=kind, nullable=False, output=True,
                                 sensitive=False, maskPolicyId='', description='')
                            for name, kind in [('id', 'integer'), ('payload', 'string')]]
    definition['output']['table'] = table
    dataset = client.call('POST', '/datasets', body, expected=201)[0]['data']['id']
    key = lambda: {'Idempotency-Key': str(uuid.uuid4())}
    client.call('POST', '/datasets/' + dataset + '/publish', extra_headers=key())
    run = client.call('POST', '/datasets/' + dataset + '/runs', {}, expected=201, extra_headers=key())[0]['data']
    end = time.monotonic() + 120
    while time.monotonic() < end:
        state = client.call('GET', '/runs/' + run['id'])[0]['data']
        if state['status'] in ['succeeded', 'failed', 'blocked', 'canceled']:
            break
        time.sleep(.25)
    assert state['status'] == 'succeeded' and state['rowCount'] == '190', state
    sample = client.call('GET', '/warehouse/tables/' + dataset)[0]['data']
    assert len(sample['sample']) == 100 and all(len(row['payload']) == 60000 for row in sample['sample'])
    before = sql('metadata', 'SELECT count(*) FROM warehouse_query WHERE dataset_id=' + dataset)
    result = client.call('POST', '/queries', {'sql': 'SELECT * FROM ' + table + ' LIMIT 1000'},
                         expected=422, extra_headers=key())[0]
    assert result['error']['code'] == 'QUERY_RESULT_LIMIT', result
    assert sql('metadata', 'SELECT count(*) FROM warehouse_query WHERE dataset_id=' + dataset) == before
    assert 'payload' not in json.dumps(result), 'Error leaked row data'
    small = client.call('POST', '/queries', {'sql': 'SELECT * FROM ' + table + ' LIMIT 2'},
                        expected=201, extra_headers=key())[0]['data']
    assert len(small['rows']) == 2 and all(len(row['payload']) == 60000 for row in small['rows'])
    assert sql('metadata', 'SELECT current_run_id FROM warehouse_target WHERE dataset_id=' + dataset) == run['id']
    print('PASS actual Doris result budget: 190x60000-byte rows, bounded sample, oversized SELECT rejected without persisted result, next query succeeds')


if __name__ == '__main__':
    main()
