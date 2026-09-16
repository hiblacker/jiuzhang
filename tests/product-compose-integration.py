"""Opt-in product Compose acceptance using only synthetic file/model inputs."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import urllib.request
import urllib.error
from datetime import datetime
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser()
parser.add_argument('--settings', required=True)
parser.add_argument('--env-file', required=True)
parser.add_argument('--project-name', required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
settings = json.loads(Path(args.settings).read_text())
base = 'http://127.0.0.1:' + settings['PRODUCT_API_PORT']
root = Path(settings['PRODUCT_CONFIG_ROOT']).parent
spec = importlib.util.spec_from_file_location('model_worker', repo / 'apps/model-worker/worker.py')
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
compose = ['docker', 'compose', '--env-file', args.env_file, '-p', args.project_name, '-f', str(repo / 'deploy/compose.product.yaml')]

def api(route, body=None, token=None):
    request = urllib.request.Request(base + '/api/v1/' + route, data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + (token or settings['CONTROL_API_ADMIN_TOKEN']), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def wait_for(route, predicate, seconds=240):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        result = api(route)
        if predicate(result): return result
        if result and isinstance(result, list) and result[0].get('state') in ['FAILED', 'REJECTED']:
            raise AssertionError('PIPELINE_FAILED: ' + str(result[0].get('error_code')))
        time.sleep(1)
    raise AssertionError('PIPELINE_TIMEOUT: ' + route)

suffix = uuid.uuid4().hex[:10]
source = 'compose-' + suffix
runtime_ref = source
config_root = Path(settings['PRODUCT_CONFIG_ROOT'])
inbox = Path(settings['PRODUCT_INBOX_ROOT']) / source
inbox.mkdir()
lake_registry = json.loads((config_root / 'lake-runtime.json').read_text())
lake_registry['profiles'][runtime_ref] = {'kind': 'FILE_SCAN', 'sourceCode': source, 'inboxRoot': '/data/inbox/' + source,
    'assumeReady': False, 'parserPython': '/usr/local/bin/python'}
(config_root / 'lake-runtime.json').write_text(json.dumps(lake_registry, indent=2))
with (root / 'lake-start.log').open('w') as log:
    subprocess.run([*compose, 'restart', 'lake-worker'], check=True, stdout=log, stderr=subprocess.STDOUT)
project = api('warehouse/projects', {'code': source, 'name': 'Compose synthetic commerce'})['id']
api('sources', {'code': source, 'sourceType': 'FILE', 'credentialRef': 'env://SYNTHETIC', 'config': {}})
api(f'warehouse/projects/{project}/sources', {'sourceCode': source})
(inbox / 'orders.csv').write_text('id,team,amount\n001,east,12345678901234567.89\n002,west,8.20\n')
(inbox / 'orders.csv.done').write_text('')
day = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
plan = api('lake/plans', {'sourceCode': source, 'expectedVersion': 0, 'kind': 'FILE_SCAN', 'runtimeRef': runtime_ref, 'timezone': 'Asia/Shanghai',
    'triggerTime': '00:00:00', 'startDate': day, 'historicalRead': True, 'maxAttempts': 3, 'timeoutSeconds': 300, 'contract': {}})['id']
try:
    first = api(f'lake/plans/{plan}/trigger', {'day': day, 'reason': 'Container acceptance'})
    repeated = api(f'lake/plans/{plan}/trigger', {'day': day, 'reason': 'Container replay'})
    assert first == repeated
    wait_for(f'lake/executions?planId={plan}', lambda rows: any(r['state'] == 'COMPLETE' for r in rows))
    assets = wait_for(f'warehouse/projects/{project}/assets', lambda rows: len(rows) == 1)
    assert assets[0]['row_count'] == 2
    profile = {'repository': '/models.git', 'projectPath': 'models/commerce', 'projectId': project, 'sources': {'orders': source}}
    registry = json.loads((config_root / 'model-runtime.json').read_text())
    registry['profiles'][runtime_ref] = profile
    (config_root / 'model-runtime.json').write_text(json.dumps(registry, indent=2))
    revision = json.loads((repo / 'deploy/artifacts/build.json').read_text())['gitRevision']
    sha, files = worker.bundle(repo, 'models/commerce', revision)
    contract = worker.bound_contract(files, profile)
    dataset = api(f'warehouse/projects/{project}/models', {'code': 'orders', 'name': 'Synthetic orders', 'expectedVersion': 0,
        'runtimeRef': runtime_ref, 'gitRevision': revision, 'bundleSha256': sha, 'contract': contract})['id']
    prefix = f'warehouse/projects/{project}/datasets/{dataset}'
    build = api(prefix + '/builds', {'requestKey': 'container-first', 'modelVersion': 1, 'inputs': {'orders': assets[0]['id']}})['id']
    with (root / 'model-start.log').open('w') as log:
        subprocess.run([*compose, 'up', '-d', 'model-worker'], check=True, stdout=log, stderr=subprocess.STDOUT)
        subprocess.run([*compose, 'restart', 'model-worker'], check=True, stdout=log, stderr=subprocess.STDOUT)
    wait_for(prefix + '/builds', lambda rows: rows[0]['state'] == 'READY')
    release = api(prefix + f'/builds/{build}/publish', {'reason': 'Container acceptance'})['releaseId']
    rows = api(prefix + '/query', {'releaseId': release})['rows']
    assert rows == [{'order_id': '001', 'team': 'east', 'amount': '12345678901234567.89'}, {'order_id': '002', 'team': 'west', 'amount': '8.20'}]
    identity = api('warehouse/identities', {'id': source + '-reader'})
    api(f'warehouse/projects/{project}/members', {'identity': identity['id'], 'role': 'VIEWER'})
    api(prefix + '/policy', {'identity': identity['id'], 'columns': ['order_id', 'amount'], 'rowEquals': {'team': 'east'}})
    restricted = api(prefix + '/query', {}, identity['token'])
    assert restricted['rows'] == [{'order_id': '001', 'amount': '12345678901234567.89'}]
    with (root / 'restart.log').open('w') as log:
        subprocess.run([*compose, 'restart', 'lake-worker', 'model-worker'], check=True, stdout=log, stderr=subprocess.STDOUT)
    assert api(prefix + '/query', {'releaseId': release})['rows'] == rows
    evidence = {'state': 'PASS', 'gitRevision': revision, 'projectId': project, 'datasetId': dataset, 'releaseId': release, 'rows': len(rows),
        'checks': ['psql migrations and restricted roles', 'container file worker', 'container dbt SQL worker', 'atomic publication',
                   'exact decimal and leading zero', 'viewer row/column policy', 'idempotent window', 'worker restart preserves release']}
    (root / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence))
finally:
    api(f'lake/plans/{plan}/state', {'state': 'PAUSED'})
