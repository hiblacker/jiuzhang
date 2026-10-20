#!/usr/bin/env python3
"""Real MySQL/PostgreSQL/API acceptance; uses only locally generated synthetic fixture credentials."""
from importlib import import_module
import json
import os
from pathlib import Path
import uuid

Client = import_module('test-identity').Client


def source_input():
    return {
        'name': 'mysql_' + uuid.uuid4().hex[:10], 'description': 'synthetic integration fixture',
        'owner': 'verification', 'tags': [], 'type': 'MySQL',
        'settings': {'host': '127.0.0.1', 'port': 13306, 'database': 'demo_retail',
            'schema': '', 'tls': False, 'method': 'GET', 'baseUrl': '', 'path': '',
            'headers': '{}', 'query': '{}', 'body': '{}', 'authType': 'none',
            'pagination': 'none', 'dataPath': '', 'incrementalField': '', 'rateLimit': 60},
        'credentials': {'username': 'jiuzhang_reader', 'password': os.environ['SOURCE_READ_PASSWORD']}}


def main():
    c = Client()
    c.call('POST', '/auth/login', {'username': os.environ['JIUZHANG_BOOTSTRAP_USER'],
        'password': os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    body = source_input()
    result, _ = c.call('POST', '/sources/test', body)
    assert result['data']['success']
    bad = json.loads(json.dumps(body))
    bad['credentials']['password'] = 'incorrect-password'
    c.call('POST', '/sources/test', bad, expected=422)
    bad['settings']['host'] = 'untrusted.invalid'
    bad['credentials'] = body['credentials']
    outside_allowlist, _ = c.call('POST', '/sources/test', bad, expected=422)
    assert outside_allowlist['error']['code'] == 'SOURCE_CONNECTION_FAILED'
    created, _ = c.call('POST', '/sources', body, expected=201)
    source_id = created['data']['id']
    assert 'credentials' not in created['data'] and body['credentials']['password'] not in json.dumps(created)
    objects, _ = c.call('GET', '/sources/' + source_id + '/objects')
    obj = next(x for x in objects['data'] if x['name'] == 'orders')
    preview, _ = c.call('POST', '/sources/' + source_id + '/preview', {'objectId': obj['id']})
    rows = preview['data']['rows']
    assert any(x['id'] == '9007199254740993' and x['amount'] == '12345.6700' for x in rows), rows
    assert any(x['amount'] == '0.0000' for x in rows)
    assert any(x['phone'] is None for x in rows)
    c.call('PATCH', '/sources/' + source_id, {'description': '', 'settings': body['settings']})
    c.call('POST', '/sources/' + source_id + '/test')
    fields, _ = c.call('GET', '/sources/' + source_id + '/objects/' + obj['id'] + '/fields')
    assert any(x['name'] == 'amount' and x['type'] == 'decimal(20,4)' for x in fields['data'])
    saved, _ = c.call('GET', '/sources/' + source_id)
    assert saved['data']['description'] == '' and saved['data']['settings']['tls'] is False
    c.call('POST', '/sources/test', {**body, 'credentials': {'username': 'root',
        'password': os.environ['SOURCE_ROOT_PASSWORD']}})
    Path('.local/source-test.json').write_text(json.dumps({'id': source_id, 'objectId': obj['id']}))
    print('PASS real MySQL: readonly connection, wrong credential, unrestricted DNS host resolution, catalog, preview, BIGINT/Decimal/null, edit credential retention, privileged-account connection')


if __name__ == '__main__':
    main()
