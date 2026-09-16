"""Opt-in upgrade acceptance on a verified, separately restored phase-one backup.

Only the supplied restored copy is started/migrated. Original services and business
sources are never changed. Credentials are read from the private local stack config.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlparse
import psycopg2
from psycopg2 import sql as sql_builder

parser = argparse.ArgumentParser()
parser.add_argument('--config', required=True)
parser.add_argument('--restored-root', required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
config = json.loads(Path(args.config).read_text())
restored = Path(args.restored_root).resolve(strict=True)
data = restored / 'postgres'
assert data.resolve() != Path(config['postgres']['data']).resolve() and not (data / 'postmaster.pid').exists()
assert (restored / 'manifest.json').is_file(), 'Use local-stack.py restore first'
os.umask(0o077)
output = restored / ('upgrade-evidence-' + str(time.time_ns()))
output.mkdir(exist_ok=False)
service = config['services']['control-api']
env = dict(os.environ, **service['env'])
for key, ref in service.get('envRefs', {}).items():
    env[key] = str(json.loads(Path(ref['file']).read_text())[ref['key']])
db_url = urlparse(env['WAREHOUSE_DB_URL'].removeprefix('jdbc:'))
owner_ref = next(ref['file'] for key, ref in service['envRefs'].items() if key == 'CONTROL_API_DB_PASSWORD')
credentials = json.loads(Path(owner_ref).read_text())
def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]
pg_port, api_port = port(), port()
assert pg_port != config['postgres']['port'] and api_port != int(env['SERVER_PORT'])
socket_directory = tempfile.TemporaryDirectory(prefix='jz-upgrade-', dir='/tmp')
socket_root = Path(socket_directory.name)
pgctl = [str(Path(config['postgres']['bin']) / 'pg_ctl'), '-D', str(data)]
def run(command):
    with (output / 'commands.log').open('ab') as log:
        subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)
run([*pgctl, '-l', str(output / 'postgres.log'), '-o', f'-h 127.0.0.1 -p {pg_port} -k {socket_root}', '-w', 'start'])
connection = psycopg2.connect(host='127.0.0.1', port=pg_port, dbname=db_url.path[1:], user=credentials['owner'], password=credentials['ownerPassword'])
connection.autocommit = True
def sql(query, params=()):
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        return cursor.fetchall() if cursor.description else []
tables = ['control.source_connection', 'lake.inventory', 'lake.source_object', 'lake.system_run', 'lake.object_run',
          'lake.raw_object', 'lake.ingestion_plan', 'lake.plan_version', 'lake.execution_window', 'lake.execution_attempt',
          'warehouse.project_source', 'warehouse.external_asset', 'warehouse.dataset', 'warehouse.model_version',
          'warehouse.model_build', 'warehouse.dataset_release']
table_columns = {table: ','.join('"' + row[0].replace('"', '""') + '"' for row in sql(
    'SELECT attname FROM pg_attribute WHERE attrelid=%s::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum', (table,))) for table in tables}
def fingerprints():
    result = {}
    for table in tables:
        # Identifiers come only from the constant list above; no arbitrary user SQL.
        rows = sql('SELECT row_to_json(t)::text FROM (SELECT ' + table_columns[table] + ' FROM ' + table + ') t ORDER BY row_to_json(t)::text')
        result[table] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(row[0] for row in rows).encode()).hexdigest()}
    return result
def http(base, route, body=None):
    request = urllib.request.Request(base + route, data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + env['CONTROL_API_ADMIN_TOKEN'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)
process = None
try:
    before = fingerprints()
    ledger = dict(sql('SELECT version,checksum FROM control.schema_migration ORDER BY version'))
    assert len(ledger) in [16, 17], 'Expected a phase-one backup; the recorded cold backup predates V017'
    for migration in sorted((repo / 'migrations').glob('V*.sql'))[:17]:
        historical = subprocess.check_output(['git', 'show', '11322a050a524d0d20b719509210ba3f3d21eba6:migrations/' + migration.name], cwd=repo)
        assert historical == migration.read_bytes(), 'Phase-one migration was modified'
    sources = sql("SELECT ps.project_id,s.id,s.code FROM control.source_connection s JOIN warehouse.project_source ps ON ps.source_id=s.id WHERE s.source_type='MYSQL' AND EXISTS(SELECT 1 FROM lake.inventory i WHERE i.source_id=s.id AND i.object_count=157)")
    assert sources, 'Phase-one 157-table source missing'
    release_rows = sql('SELECT id,project_id,active_release_id FROM warehouse.dataset WHERE active_release_id IS NOT NULL ORDER BY id')
    assert release_rows
    baseline = {}
    for dataset, project, release in release_rows:
        schema, contract, version = sql('SELECT b.schema_name,v.contract,r.model_version FROM warehouse.dataset_release r JOIN warehouse.model_build b ON b.id=r.build_id JOIN warehouse.model_version v ON v.dataset_id=r.dataset_id AND v.version=r.model_version WHERE r.id=%s', (release,))[0]
        columns = [f['name'] for f in contract['fields']]
        query = sql_builder.SQL('SELECT {} FROM {}.{} ORDER BY {} LIMIT 1000').format(
            sql_builder.SQL(',').join(sql_builder.SQL('{}::text').format(sql_builder.Identifier(name)) for name in columns),
            sql_builder.Identifier(schema), sql_builder.Identifier(contract['output']),
            sql_builder.SQL(',').join(map(sql_builder.Identifier, contract['uniqueKey'])))
        values = sql(query)
        baseline[dataset] = {'releaseId': release, 'modelVersion': version, 'columns': columns, 'rows': [dict(zip(columns, row)) for row in values]}
    for migration in sorted((repo / 'migrations').glob('V*.sql')):
        content = migration.read_bytes(); checksum = hashlib.sha256(content).hexdigest()
        if migration.name in ledger:
            assert ledger[migration.name].strip() == checksum, 'Executed migration changed'
            continue
        connection.autocommit = False
        try:
            sql('SELECT pg_advisory_xact_lock(74123,1)')
            sql(content.decode())
            sql('INSERT INTO control.schema_migration(version,checksum) VALUES (%s,%s)', (migration.name, checksum))
            connection.commit()
        except Exception:
            connection.rollback(); raise
        finally:
            connection.autocommit = True
    assert fingerprints() == before, 'Migration changed phase-one metadata or immutable releases'
    env['WAREHOUSE_DB_URL'] = f'jdbc:postgresql://127.0.0.1:{pg_port}{db_url.path}'
    env['SERVER_PORT'] = str(api_port); env['LAKE_CALENDAR_DRIVER'] = 'external'
    base = f'http://127.0.0.1:{api_port}'
    with (output / 'api.log').open('wb') as log:
        process = subprocess.Popen(service['command'], cwd=repo, env=env, stdout=log, stderr=log)
    for _ in range(150):
        try:
            if http(base, '/actuator/health')['status'] == 'UP': break
        except OSError: pass
        assert process.poll() is None, 'Upgraded API stopped; inspect private log'
        time.sleep(.2)
    else: raise RuntimeError('UPGRADED_API_HEALTH_TIMEOUT')
    with urllib.request.urlopen(base, timeout=10) as response:
        assert b'/assets/' in response.read(), 'New same-origin workbench was not packaged'
    for dataset, project, release in release_rows:
        result = http(base, f'/api/v1/warehouse/projects/{project}/datasets/{dataset}/query', {'releaseId': release, 'limit': 1000})
        assert {k: result[k] for k in baseline[dataset]} == baseline[dataset], 'Restored release query differs'
    for project, source, code in sources:
        prefix = f'/api/v1/warehouse/projects/{project}'
        system = http(base, prefix + '/systems', {'code': 'upgrade_' + str(source), 'name': 'Phase-one mapped source', 'businessOwner': 'Development acceptance', 'technicalOwner': 'Development acceptance'})
        instance = http(base, prefix + f"/systems/{system['id']}/instances", {'code': 'test', 'name': 'Approved test source', 'environment': 'TEST'})
        http(base, '/api/v1/warehouse/environments', {'code': 'upgrade_' + str(source), 'name': 'Upgrade verification; no worker connected', 'workerIds': ['upgrade-no-worker'], 'maxParallel': 1})
        resource = http(base, '/api/v1/warehouse/resources', {'code': 'upgrade_' + str(source), 'name': 'Approved test MySQL reference', 'kind': 'MYSQL_SNAPSHOT', 'environment': 'upgrade_' + str(source), 'resourceGroup': 'upgrade_' + str(source), 'maxParallel': 1, 'maxBytes': 1073741824, 'requestsPerSecond': 1})
        http(base, f"/api/v1/warehouse/resources/{resource['id']}/grant", {'projectId': project})
        conn = http(base, prefix + f"/instances/{instance['id']}/connections", {'code': 'legacy', 'name': 'Phase-one MySQL', 'resourceId': resource['id'], 'config': {'database': 'devopsv1'}})
        channel = http(base, prefix + f"/connections/{conn['id']}/channels", {'existingSourceId': source, 'code': code, 'name': 'Existing whole-database channel', 'config': {}})
        assert channel['source_id'] == source
    assert fingerprints() == before, 'Backfill changed existing source, plan, batch, asset or release identities'
    # Hash only references/metadata, never persist query rows or business payloads in evidence.
    evidence = {'state': 'PASS', 'backupMigrationCount': len(ledger), 'phaseOneMigrationsUnchanged': 17, 'currentMigrations': len(sql('SELECT version FROM control.schema_migration')),
                'mappedSources': len(sources), 'expectedWholeDatabaseObjects': 157, 'verifiedReleases': len(release_rows),
                'queryRowsCompared': sum(len(v['rows']) for v in baseline.values()), 'sameOriginWorkbench': True,
                'sourceContacted': False, 'phaseOneFingerprints': before}
    (output / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({k: v for k, v in evidence.items() if k != 'phaseOneFingerprints'}))
finally:
    if process is not None:
        process.terminate(); process.wait(timeout=30)
    connection.close()
    run([*pgctl, '-m', 'fast', '-w', 'stop'])
    socket_directory.cleanup()
