"""Opt-in: verify registered-SQL ingestion end to end against a prepared synthetic source.

Requires a running product stack (secrets/product-next.json) plus a synthetic MySQL source
reachable from the worker on the compose network, and a credential file the worker can read:
    ${PRODUCT_CONFIG_ROOT}/datasources/<credential-ref>.json  -> {"user": "...", "password": "..."}

The source fixture is deploy/fixtures/synthetic-source-mysql.sql. Every object this script
creates carries a random suffix, so it can run repeatedly without collisions.
"""
import argparse
import json
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser()
parser.add_argument('--settings', required=True)
parser.add_argument('--project', type=int, default=1)
parser.add_argument('--source-host', default='jiuzhang-source-mysql')
parser.add_argument('--source-database', default='erp')
parser.add_argument('--credential-ref', default='erp-readonly')
parser.add_argument('--timeout', type=int, default=180)
args = parser.parse_args()

settings = json.loads(Path(args.settings).read_text())
base = 'http://127.0.0.1:' + settings['PRODUCT_API_PORT']
token = settings['CONTROL_API_ADMIN_TOKEN']
suffix = uuid.uuid4().hex[:8]
evidence = {'steps': []}


def api(route, body=None, method=None):
    request = urllib.request.Request(
        base + '/api/v1/' + route, method=method or ('GET' if body is None else 'POST'),
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
        except ValueError:
            payload = {'code': 'HTTP_%d' % error.code}
        raise AssertionError(f'{route} -> HTTP {error.code} {payload}')


def step(name, value=None):
    evidence['steps'].append({'step': name, 'at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'), 'value': value})
    print(f'[ok] {name}' + (f' :: {json.dumps(value, ensure_ascii=False)[:200]}' if value is not None else ''), flush=True)


def wait(route, predicate, description, seconds=None):
    until = time.monotonic() + (seconds or args.timeout)
    last = None
    while time.monotonic() < until:
        last = api(route)
        if predicate(last):
            return last
        time.sleep(1.5)
    raise AssertionError(f'TIMEOUT waiting for {description}; last={json.dumps(last, ensure_ascii=False)[:400]}')


# ---------------------------------------------------------------- resource and datasource
environment = next(e['code'] for e in api('warehouse/environments') if e['enabled'])
resource_code = f'sqldemo_{suffix}'
resource = api('warehouse/resources', {
    'code': resource_code, 'name': f'合成 ERP 只读数据源 {suffix}', 'kind': 'MYSQL_SNAPSHOT',
    'environment': environment, 'resourceGroup': resource_code,
    'maxParallel': 1, 'maxBytes': 1073741824, 'requestsPerSecond': 5})
api(f"warehouse/resources/{resource['id']}/grant", {'projectId': args.project})
api(f"warehouse/resources/{resource['id']}/datasource", {
    'datasourceType': 'MYSQL',
    'config': {'host': args.source_host, 'port': 3306, 'database': args.source_database,
               'charset': 'utf8mb4', 'timezone': 'Asia/Shanghai'},
    'credentialRef': args.credential_ref, 'statementTimeoutMs': 600000,
    'allowedTables': ['biz_order', 'customer'], 'allowedSchemas': [args.source_database]})
step('resource + datasource registered', {'resourceId': resource['id'], 'code': resource_code})

test_request = api(f"warehouse/resources/{resource['id']}/tests", {'requestKey': f'test-{suffix}'})
result = wait(f"warehouse/resources/{resource['id']}/tests",
              lambda rows: any(row['id'] == test_request['id'] and row['state'] in ('PASSED', 'FAILED') for row in rows),
              'connection test')
row = next(item for item in result if item['id'] == test_request['id'])
assert row['state'] == 'PASSED', f"connection test failed: {row}"
assert row['read_only_verified'] is True, 'the read-only proof is mandatory'
step('connection test passed with read-only proof',
     {'serverVersion': row['server_version'], 'timezone': row['server_timezone'],
      'readableSchemaCount': row['readable_schema_count'], 'latencyMs': row['latency_ms']})

# ------------------------------------------------------------- system, instance, connection
system = api(f'warehouse/projects/{args.project}/systems',
             {'code': resource_code, 'name': f'合成 ERP {suffix}', 'businessOwner': '合成业务', 'technicalOwner': '合成技术'})
instance = api(f"warehouse/projects/{args.project}/systems/{system['id']}/instances",
               {'code': 'test', 'name': '合成测试实例', 'environment': 'TEST'})
connection = api(f"warehouse/projects/{args.project}/instances/{instance['id']}/connections",
                 {'code': 'erp', 'name': 'ERP 只读连接', 'resourceId': resource['id'], 'config': {'database': args.source_database}})
channel = api(f"warehouse/projects/{args.project}/connections/{connection['id']}/channels",
              {'code': resource_code, 'name': f'ERP 登记式 SQL {suffix}', 'config': {'sourceMode': 'REGISTERED_SQL'}})
source = channel['source_id']
step('channel created in registered-SQL mode', {'sourceId': source})

sql_text = ('SELECT o.id AS order_id, o.`订单编号` AS order_no, o.`金额` AS amount, '
            'o.`更新时间` AS updated_at, c.name AS customer_name '
            'FROM biz_order o LEFT JOIN customer c ON c.id = o.id ORDER BY o.id')
table_route = f'warehouse/projects/{args.project}/channels/{source}'

validation = api(f'{table_route}/sql/validate', {'sqlText': sql_text})
assert validation['blocked'] is False, f"validator blocked the query: {validation['issues']}"
step('SQL validation accepts JOIN with non-ASCII identifiers',
     {'tables': validation['referencedTables'], 'placeholders': validation['placeholders']})

draft = api(f'{table_route}/sql/draft', {'sqlText': sql_text, 'grain': '一行一个订单',
                                         'uniqueKey': ['order_id'], 'maskedColumns': ['customer_name']})
assert draft['saved'] is True, f"draft rejected: {draft['issues']}"
step('draft saved')

queued = api(f'{table_route}/sql/previews', {'requestKey': f'preview-{suffix}'})
assert queued['queued'] is True, f"preview rejected: {queued}"
preview_id = queued['preview']['id']
preview = wait(f'{table_route}/sql/previews/{preview_id}',
               lambda p: p['state'] in ('COMPLETED', 'FAILED'), 'SQL preview')
assert preview['state'] == 'COMPLETED', f"preview failed: {preview.get('error_code')}"
names = [column['name'] for column in preview['columns']]
assert names == ['order_id', 'order_no', 'amount', 'updated_at', 'customer_name'], names
assert preview['row_count'] == 3, preview['row_count']
amounts = [r[names.index('amount')] for r in preview['rows']]
assert '12345678901234567.89' in [str(value) for value in amounts], amounts
masked_values = [r[names.index('customer_name')] for r in preview['rows']]
assert all(value == '***' for value in masked_values), masked_values
step('preview completed, decimals exact, masked column hidden',
     {'columns': names, 'rowCount': preview['row_count'], 'truncated': preview['truncated'],
      'elapsedMs': preview['elapsed_ms'], 'amounts': amounts})

version = api(f'{table_route}/sql/versions', {'extractionMode': 'FULL'})
assert version['state'] == 'VALIDATED', version
enabled = api(f"{table_route}/sql/versions/{version['id']}/enable", {'reason': 'P0-b 验收'})
assert enabled['state'] == 'ENABLED', enabled
step('SQL version validated and enabled', {'versionId': version['id'], 'version': version['version']})

# ------------------------------------------------------------------- activate and collect
today = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
plan = api(f'{table_route}/activate', {
    'probeId': None, 'expectedPlanVersion': 0, 'timezone': 'Asia/Shanghai', 'triggerTime': '23:59',
    'startDate': today, 'lateDays': 7, 'historicalRead': False, 'maxAttempts': 2, 'timeoutSeconds': 900})
step('plan activated', {'planId': plan.get('id'), 'version': plan.get('version')})
api(f'{table_route}/trigger', {'day': today, 'reason': 'P0-b 端到端验收', 'revision': True})

assets = wait(f'warehouse/projects/{args.project}/assets',
              lambda rows: any(a['source_code'] == resource_code and a['state'] in ('RAW_COMMITTED', 'PARSED') for a in rows),
              'ingested asset')
asset = next(a for a in assets if a['source_code'] == resource_code)
assert asset['row_count'] == 3, asset
step('asset registered from the raw batch', {'assetId': asset['id'], 'state': asset['state'], 'rowCount': asset['row_count']})

jobs = api(f'{table_route}/seatunnel-jobs')
assert jobs and any(job['state'] == 'FINISHED' for job in jobs), jobs
step('SeaTunnel job mapping recorded', {'jobs': [{'jobId': job['job_id'], 'state': job['state']} for job in jobs][:3]})

evidence['resourceCode'] = resource_code
evidence['sourceId'] = source
evidence['result'] = 'PASS'
Path('work/diagnostics/sql-ingestion-evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'state': 'PASS', 'resourceCode': resource_code, 'sourceId': source, 'assetId': asset['id']}, ensure_ascii=False))
