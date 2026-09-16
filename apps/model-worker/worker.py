"""Git-pinned dbt execution. Runtime paths and database credentials stay local."""
import argparse
import csv
import datetime as dt
import decimal
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from urllib.parse import urlparse

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json
import yaml


def fail(code):
    raise RuntimeError(code)


def atomic(file, value):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    part = file.with_suffix('.part')
    with part.open('w', encoding='utf-8') as handle:
        os.chmod(part, 0o600)
        json.dump(value, handle, ensure_ascii=False, default=str)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(part, file)
    descriptor = os.open(file.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def inside(root, relative):
    root = Path(root).resolve(strict=True)
    file = (root / relative).resolve(strict=True)
    if file == root or root not in file.parents:
        fail('MODEL_PATH_OUTSIDE_ROOT')
    return file


def file_hash(file):
    digest = hashlib.sha256()
    size = 0
    with file.open('rb') as handle:
        while chunk := handle.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size


def bundle(repo, directory, revision):
    if not re.fullmatch('[0-9a-f]{40}', revision) or Path(directory).is_absolute() or '..' in Path(directory).parts:
        fail('INVALID_MODEL_BUNDLE')
    listing = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', '-z', revision, '--', directory], timeout=15)
    files = {}
    for entry in listing.split(b'\0'):
        if not entry:
            continue
        meta, name = entry.split(b'\t', 1)
        mode, kind, oid = meta.decode().split(' ')
        if mode not in ['100644', '100755'] or kind != 'blob':
            fail('MODEL_BUNDLE_SYMLINK_FORBIDDEN')
        relative = str(Path(name.decode()).relative_to(directory))
        content = subprocess.check_output(['git', '-C', str(repo), 'cat-file', 'blob', oid], timeout=15)
        if len(content) > 2 * 1024 * 1024:
            fail('MODEL_BUNDLE_FILE_TOO_LARGE')
        files[relative] = content
    if not files or len(files) > 500 or sum(len(v) for v in files.values()) > 20 * 1024 * 1024:
        fail('MODEL_BUNDLE_LIMIT')
    identity = ''.join(name + '\0' + hashlib.sha256(files[name]).hexdigest() + '\n' for name in sorted(files))
    return hashlib.sha256(identity.encode()).hexdigest(), files


def bound_contract(files, profile):
    contract = json.loads(files['contract.json'])
    for source in contract['inputs']:
        source['sourceCode'] = profile['sources'][source['alias']]
    return contract


def request(options, route, body):
    req = urllib.request.Request(options.api + '/api/v1/warehouse/' + route,
        data=json.dumps(body, default=str).encode(), headers={'Authorization': 'Bearer ' + options.token,
            'Content-Type': 'application/json', 'X-Worker-Instance': options.instance})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            code = json.load(error).get('code', 'MODEL_CONTROL_HTTP_ERROR')
        except Exception:
            code = 'MODEL_CONTROL_HTTP_ERROR'
        fail(code if re.fullmatch('[A-Z0-9_:-]{1,120}', code) else 'MODEL_CONTROL_HTTP_ERROR')
    except (OSError, ValueError):
        fail('MODEL_CONTROL_UNAVAILABLE')


def verify_input(root, item):
    file = inside(root, item['path'])
    if file_hash(file) != (item['sha256'], item['bytes']):
        fail('MODEL_INPUT_INTEGRITY_MISMATCH')
    return file


def load_input(connection, schema, root, item, maximum, stop):
    file = verify_input(root, item)
    names = [field['name'] for field in item['columns']]
    for field in item['columns']:
        if not re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}', field['name']) or not re.fullmatch(r'text|bigint|integer|boolean|date|timestamp|timestamptz|jsonb|numeric\([1-9][0-9]?,[0-9]{1,2}\)', field['type']):
            fail('INVALID_MODEL_INPUT_TYPE')
    relation = sql.Identifier(schema, 'raw_' + item['alias'])
    columns = sql.SQL(',').join(sql.SQL('{} {}').format(sql.Identifier(f['name']), sql.SQL(f['type'])) for f in item['columns'])
    count = 0
    mysql_schema = None
    if item['format'] == 'mysql-jsonl':
        schema_file = inside(root, item['schemaPath'])
        if file_hash(schema_file)[0] != item['schemaSha256']:
            fail('MODEL_SCHEMA_INTEGRITY_MISMATCH')
        mysql_schema = json.loads(schema_file.read_text())
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL('CREATE TABLE {} ({})').format(relation, columns))
        copy = sql.SQL("COPY {} ({}) FROM STDIN WITH (FORMAT CSV, NULL '\\N')").format(relation, sql.SQL(',').join(map(sql.Identifier, names)))
        buffer = io.StringIO()
        with file.open(encoding='utf-8') as source:
            for line in source:
                if stop.is_set():
                    fail('MODEL_EXECUTION_ABORTED')
                if len(line) > 16 * 1024 * 1024 or count >= maximum:
                    fail('MODEL_INPUT_LIMIT')
                row = json.loads(line, parse_float=decimal.Decimal)
                if mysql_schema is not None:
                    order = [c['column'] for c in mysql_schema['columns']]
                    if not isinstance(row, list) or len(row) != len(order):
                        fail('MODEL_SOURCE_SCHEMA_MISMATCH')
                    if mysql_schema.get('scalarEncoding', 'json-quoted-v1') == 'json-quoted-v1':
                        row = [None if v is None else json.loads(v, parse_float=decimal.Decimal) for v in row]
                    elif mysql_schema['scalarEncoding'] != 'mysql-char-v2':
                        fail('MODEL_SOURCE_ENCODING_UNKNOWN')
                    row = dict(zip(order, row))
                if not isinstance(row, dict) or any(name not in row for name in names):
                    fail('MODEL_INPUT_FIELD_MISSING')
                values = []
                for name in names:
                    value = row[name]
                    if value is None:
                        values.append('\\N')
                    else:
                        if isinstance(value, (dict, list)):
                            value = json.dumps(value, ensure_ascii=False, default=str)
                        elif isinstance(value, bool):
                            value = 'true' if value else 'false'
                        values.append('"' + str(value).replace('"', '""') + '"')
                buffer.write(','.join(values) + '\n')
                count += 1
                if count % 1000 == 0:
                    buffer.seek(0); cursor.copy_expert(copy, buffer); buffer = io.StringIO()
        if buffer.tell():
            buffer.seek(0); cursor.copy_expert(copy, buffer)
    if count != item['rows']:
        fail('MODEL_INPUT_ROW_COUNT_MISMATCH')
    verify_input(root, item)
    return count


def execute(registry, task, stop):
    profile = registry['profiles'].get(task['runtime_ref'])
    if not profile or profile['projectId'] != task['project_id']:
        fail('MODEL_RUNTIME_SCOPE_MISMATCH')
    sha, files = bundle(profile['repository'], profile['projectPath'], task['git_revision'])
    if sha != task['bundle_sha256'] or bound_contract(files, profile) != task['contract']:
        fail('MODEL_BUNDLE_CONTRACT_MISMATCH')
    root = Path(registry['workRoot']) / str(task['id'])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    project = root / 'project'; project.mkdir(exist_ok=True, mode=0o700)
    for relative, content in files.items():
        destination = project / relative
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination.write_bytes(content)
    db = registry['database'].copy()
    password = os.environ.get(db.pop('passwordEnv'), '')
    if not password:
        fail('MODEL_DATABASE_SECRET_MISSING')
    db['password'] = password
    with psycopg2.connect(**db, connect_timeout=10) as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT warehouse.allocate_build(%s,%s::uuid)', (task['id'], task['leaseToken']))
            schema = cursor.fetchone()[0]
        connection.commit()
        for item in task['inputs']:
            load_input(connection, schema, registry['lakeRoot'], item, task['contract']['maxInputRows'], stop)
        connection.commit()
    profiles = {'jiuzhang': {'target': 'local', 'outputs': {'local': {'type': 'postgres', 'host': db['host'],
        'port': db['port'], 'dbname': db['dbname'], 'user': db['user'], 'password': "{{ env_var('DBT_PASSWORD') }}",
        'schema': schema, 'threads': 1, 'retries': 0, 'connect_timeout': 10}}}}
    (root / 'profiles.yml').write_text(yaml.safe_dump(profiles))
    env = dict(os.environ, DBT_PASSWORD=password, DBT_SCHEMA=schema, DBT_SEND_ANONYMOUS_USAGE_STATS='false', DO_NOT_TRACK='1')
    log = root / 'dbt-output.log'
    with log.open('w') as output:
        os.chmod(log, 0o600)
        command = [str(Path(sys.executable).with_name('dbt')), 'build', '--project-dir', str(project), '--profiles-dir', str(root),
            '--target-path', str(root / 'target'), '--log-path', str(root / 'logs'), '--no-use-colors', '--no-partial-parse']
        child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        while child.poll() is None:
            if stop.wait(0.2):
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL); child.wait()
                fail('MODEL_EXECUTION_ABORTED')
    run_results = json.loads((root / 'target/run_results.json').read_text()) if (root / 'target/run_results.json').exists() else {}
    statuses = [{'id': r['unique_id'], 'status': r['status']} for r in run_results.get('results', [])]
    passed = child.returncode == 0 and bool(statuses) and all(r['status'] in ['success', 'pass'] for r in statuses)
    manifest = json.loads((root / 'target/manifest.json').read_text()) if (root / 'target/manifest.json').exists() else {}
    lineage = [{'id': key, 'dependsOn': node.get('depends_on', {}).get('nodes', [])} for key, node in manifest.get('nodes', {}).items() if node.get('resource_type') == 'model']
    if stop.is_set():
        fail('MODEL_EXECUTION_ABORTED')
    with psycopg2.connect(**db, connect_timeout=10) as connection, connection.cursor() as cursor:
        cursor.execute('SELECT warehouse.freeze_build(%s,%s::uuid)', (task['id'], task['leaseToken']))
    return {'state': 'READY' if passed else 'REJECTED', 'errorCode': None if passed else 'DBT_BUILD_REJECTED',
        'result': {'dbtPassed': passed, 'nodes': statuses, 'lineage': lineage, 'bundleSha256': sha, 'gitRevision': task['git_revision']}}


def flush(options, directory):
    for file in sorted(directory.glob('*.json')):
        receipt = json.loads(file.read_text())
        if receipt.get('acknowledged') or receipt.get('abandoned'):
            continue
        try:
            receipt['response'] = request(options, 'builds/' + str(receipt['id']) + '/finish', receipt['completion'])
            receipt['acknowledged'] = True
        except RuntimeError as error:
            if str(error) in ['MODEL_LEASE_LOST', 'MODEL_COMPLETION_IMMUTABLE']:
                receipt['abandoned'] = str(error)
            else:
                return False
        atomic(file, receipt)
    return True


def once(options, registry):
    outbox = Path(registry['workRoot']) / 'outbox' / options.instance
    outbox.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not flush(options, outbox):
        return {'state': 'OUTBOX_PENDING'}
    task = request(options, 'builds/claim', {'runtimeRefs': list(registry['profiles'])})
    if task['state'] == 'IDLE':
        return task
    stop = threading.Event(); finished = threading.Event()
    def beat():
        while not finished.wait(10):
            try:
                response = request(options, 'builds/' + str(task['id']) + '/heartbeat', {'leaseToken': task['leaseToken']})
                if response['state'] != 'RUNNING':
                    stop.set()
            except Exception:
                stop.set()
    thread = threading.Thread(target=beat, daemon=True); thread.start()
    timer = threading.Timer(task['contract']['timeoutSeconds'], stop.set); timer.start()
    old = {s: signal.signal(s, lambda *_: stop.set()) for s in [signal.SIGTERM, signal.SIGINT]}
    try:
        completion = execute(registry, task, stop)
    except Exception as error:
        code = str(error) if re.fullmatch('[A-Z0-9_:-]{1,120}', str(error)) else 'MODEL_BUILD_FAILED'
        atomic(Path(registry['workRoot']) / str(task['id']) / 'error.json', {'code': code,
            'type': type(error).__name__, 'sqlState': getattr(error, 'pgcode', None),
            'frames': [{'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name} for frame in traceback.extract_tb(error.__traceback__)]})
        completion = {'state': 'FAILED', 'errorCode': code, 'result': {}}
    finally:
        finished.set(); timer.cancel(); thread.join(timeout=16)
        for s, handler in old.items():
            signal.signal(s, handler)
    completion['leaseToken'] = task['leaseToken']
    file = outbox / (str(task['id']) + '.json')
    atomic(file, {'id': task['id'], 'completion': completion, 'acknowledged': False})
    flush(options, outbox)
    receipt = json.loads(file.read_text())
    return {'buildId': task['id'], 'state': receipt.get('response', {}).get('state', 'OUTBOX_PENDING')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--registry', required=True)
    parser.add_argument('--api', required=True)
    parser.add_argument('--instance', default='model-worker')
    parser.add_argument('--once', action='store_true')
    options = parser.parse_args()
    url = urlparse(options.api)
    if (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ['127.0.0.1', 'localhost'])) or url.username or url.password or url.query or url.fragment:
        fail('UNSAFE_CONTROL_API_URL')
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,99}', options.instance):
        fail('INVALID_WORKER_INSTANCE')
    options.api = options.api.rstrip('/')
    options.token = os.environ['CONTROL_API_WORKER_TOKEN']
    registry = json.loads(Path(options.registry).read_text())
    if registry.get('version') != 1 or not Path(registry['lakeRoot']).is_absolute() or not Path(registry['workRoot']).is_absolute() or not registry['profiles']:
        fail('INVALID_MODEL_REGISTRY')
    last = None
    while True:
        try:
            result = once(options, registry)
        except RuntimeError as error:
            if options.once:
                raise
            result = {'state': str(error) if re.fullmatch('[A-Z0-9_:-]{1,120}', str(error)) else 'MODEL_WORKER_FAILED'}
        if result != last and result['state'] != 'IDLE':
            print(json.dumps(result), flush=True)
        last = result
        if options.once:
            return 0 if result['state'] in ['READY', 'IDLE'] else 1
        time.sleep(2)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'state': 'FAILED', 'errorCode': str(error) if re.fullmatch('[A-Z0-9_:-]{1,120}', str(error)) else 'MODEL_WORKER_FAILED'}), file=sys.stderr)
        sys.exit(1)
