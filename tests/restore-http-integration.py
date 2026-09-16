"""Opt-in: exercise a separately restored local DB through the real HTTP API."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--config', required=True)
parser.add_argument('--postgres-port', required=True, type=int)
parser.add_argument('--project', required=True, type=int)
parser.add_argument('--dataset', required=True, type=int)
parser.add_argument('--run', required=True, type=int)
parser.add_argument('--output', required=True)
args = parser.parse_args()
config = json.loads(Path(args.config).read_text())
assert args.postgres_port != config['postgres']['port'], 'Use a separate restored database'
service = config['services']['control-api']
env = dict(os.environ, **service['env'])
for key, ref in service['envRefs'].items():
    env[key] = str(json.loads(Path(ref['file']).read_text())[ref['key']])
original = 'http://127.0.0.1:' + env['SERVER_PORT']
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
env['WAREHOUSE_DB_URL'] = env['WAREHOUSE_DB_URL'].replace(':' + str(config['postgres']['port']) + '/', ':' + str(args.postgres_port) + '/')
env['SERVER_PORT'] = str(port); env['LAKE_CALENDAR_DRIVER'] = 'external'
output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
base = f'http://127.0.0.1:{port}'


def request(url, body=None, auth=True):
    headers = {'Authorization': 'Bearer ' + env['CONTROL_API_ADMIN_TOKEN']} if auth else {}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, headers=headers, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)


with output.with_suffix('.log').open('wb') as log:
    process = subprocess.Popen(service['command'], cwd=config['repository'], env=env, stdout=log, stderr=log)
    try:
        for _ in range(150):
            try:
                if request(base + '/actuator/health', auth=False)['status'] == 'UP':
                    break
            except OSError:
                pass
            assert process.poll() is None, 'RESTORED_API_START_FAILED'
            time.sleep(.2)
        else:
            raise RuntimeError('RESTORED_API_HEALTH_TIMEOUT')
        prefix = f'/api/v1/warehouse/projects/{args.project}'
        routes = [prefix + f'/coverage/{args.run}', prefix + '/datasets', prefix + f'/datasets/{args.dataset}/releases']
        for route in routes:
            assert request(base + route) == request(original + route)
        route = prefix + f'/datasets/{args.dataset}/query'
        body = {'limit': 1000}
        restored = request(base + route, body)
        assert restored == request(original + route, body)
        try:
            request(base + route, body, auth=False)
            raise AssertionError('Unprotected restored query')
        except urllib.error.HTTPError as error:
            assert error.code == 401
        evidence = {'state': 'PASS', 'metadataEqualsOriginal': True, 'queryEqualsOriginal': True,
                    'rows': len(restored['rows']), 'releaseId': restored['releaseId'], 'unauthorizedRejected': True}
        output.write_text(json.dumps(evidence, indent=2) + '\n')
        print(json.dumps(evidence))
    finally:
        process.terminate(); process.wait(timeout=30)
