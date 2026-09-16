"""Opt-in: configure a new file channel through the API and let the running v2 container discover it."""
import argparse
import json
from pathlib import Path
import time
import urllib.request
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser()
parser.add_argument('--settings', required=True)
args = parser.parse_args()
settings = json.loads(Path(args.settings).read_text())
root = Path(settings['PRODUCT_CONFIG_ROOT']).parent
registry_file = Path(settings['PRODUCT_CONFIG_ROOT']) / 'lake-runtime.json'
original_registry = registry_file.read_bytes()
registry = json.loads(original_registry)
assert registry['version'] == 2 and 'daily-files' in registry['resources'], 'Use the isolated product-config.py fixture'
base = 'http://127.0.0.1:' + settings['PRODUCT_API_PORT']
def api(route, body=None):
    request = urllib.request.Request(base + '/api/v1/' + route, data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + settings['CONTROL_API_ADMIN_TOKEN'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)
def wait(route, predicate):
    until = time.monotonic() + 60
    while time.monotonic() < until:
        result = api(route)
        if predicate(result): return result
        time.sleep(.3)
    raise AssertionError('MANAGED_CONTAINER_TIMEOUT: ' + route)
code = 'managed_' + uuid.uuid4().hex[:12]
project = api('warehouse/projects', {'code': code, 'name': 'Synthetic managed container'})['id']
prefix = f'warehouse/projects/{project}'
if not any(e['code'] == registry['environment'] for e in api('warehouse/environments')):
    api('warehouse/environments', {'code': registry['environment'], 'name': 'Synthetic approved environment', 'workerIds': ['lake-worker'], 'maxParallel': 2})
resource = api('warehouse/resources', {'code': 'daily-files', 'name': 'Approved inbox', 'kind': 'FILE_SCAN', 'environment': registry['environment'], 'resourceGroup': registry['resources']['daily-files']['resourceGroup'], 'maxParallel': 1, 'maxBytes': 1048576, 'requestsPerSecond': 5})
api(f"warehouse/resources/{resource['id']}/grant", {'projectId': project})
system = api(prefix + '/systems', {'code': code, 'name': 'Synthetic ERP', 'businessOwner': 'Synthetic', 'technicalOwner': 'Synthetic'})
instance = api(prefix + f"/systems/{system['id']}/instances", {'code': 'test', 'name': 'Synthetic test', 'environment': 'TEST'})
connection = api(prefix + f"/instances/{instance['id']}/connections", {'code': 'files', 'name': 'Approved daily files', 'resourceId': resource['id'], 'config': {}})
folder = Path(settings['PRODUCT_INBOX_ROOT']) / code
folder.mkdir(); (folder / 'orders.csv').write_text('id,amount\n001,12345678901234567.89\n'); (folder / 'orders.csv.done').write_text('')
channel = api(prefix + f"/connections/{connection['id']}/channels", {'code': code, 'name': 'Daily orders', 'config': {'relativeDirectory': code, 'datePartitioned': False, 'delivery': {'version': 1, 'mode': 'DAILY_SET', 'readiness': 'DONE', 'expectedFiles': ['orders.csv'], 'allowEmpty': False}}})
route = prefix + f"/channels/{channel['source_id']}"
plan = None
try:
    probe = api(route + '/probes', {'requestKey': 'container-probe'})
    wait(route + '/probes', lambda rows: any(r['id'] == probe['id'] and r['state'] == 'COMPLETE' for r in rows))
    today = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
    plan = api(route + '/activate', {'probeId': probe['id'], 'expectedPlanVersion': 0, 'timezone': 'Asia/Shanghai', 'triggerTime': '23:59', 'startDate': today, 'historicalRead': True, 'timeoutSeconds': 300})
    api(route + '/trigger', {'day': today, 'reason': 'Synthetic dynamic container acceptance'})
    assets = wait(prefix + '/assets', lambda rows: len(rows) == 1 and rows[0]['state'] == 'PARSED')
    assert assets[0]['row_count'] == 1 and registry_file.read_bytes() == original_registry
    evidence = {'state': 'PASS', 'projectId': project, 'sourceId': channel['source_id'], 'assetId': assets[0]['id'], 'profilesEdited': False, 'workerRestartedForChannel': False}
    (root / 'managed-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence))
finally:
    if plan is not None: api(f"lake/plans/{plan['id']}/state", {'state': 'PAUSED'})
