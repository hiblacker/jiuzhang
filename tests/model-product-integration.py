"""Real local HTTP -> file worker -> Git/dbt -> publication -> scoped query."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
import psycopg2
from psycopg2 import sql

repo = Path(__file__).resolve().parent.parent
root = Path(tempfile.mkdtemp(prefix='warehouse-model-test-'))
spec = importlib.util.spec_from_file_location('model_worker', repo / 'apps/model-worker/worker.py')
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
base = os.environ['MODEL_TEST_API']
admin = os.environ['MODEL_TEST_ADMIN']
worker_token = os.environ['CONTROL_API_WORKER_TOKEN']
suffix = uuid.uuid4().hex
today = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
lake = root / 'lake'; inbox = root / 'inbox'; inbox.mkdir()
plans = []


def api(route, body=None, token=admin, status=200):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + '/api/v1/' + route, data=data,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            actual = response.status; result = json.load(response)
    except urllib.error.HTTPError as error:
        actual = error.code; result = json.load(error)
    assert actual == status, (route, actual, result.get('code') if isinstance(result, dict) else 'INVALID_RESPONSE')
    return result


def invoke(command, env=None, expected=0):
    completed = subprocess.run(command, env=env, capture_output=True, text=True, timeout=90)
    if completed.returncode != expected:
        (root / 'last-command.log').write_text(completed.stdout + completed.stderr)
        raise AssertionError('COMMAND_FAILED: inspect ' + str(root / 'last-command.log'))
    return completed.stdout


def receive(source, plan, registry, revision=False):
    api(f'lake/plans/{plan}/trigger', {'day': today, 'revision': revision, 'reason': 'synthetic product acceptance'})
    invoke(['node', str(repo / 'apps/ingestion-worker/lake-runtime.mjs'), '--registry', str(registry), '--control-api', base, '--instance', source, '--once'])


try:
    git_repo = root / 'git'; git_repo.mkdir()
    shutil.copytree(repo / 'models', git_repo / 'models')
    invoke(['git', '-C', str(git_repo), 'init', '-q'])
    invoke(['git', '-C', str(git_repo), 'add', 'models'])
    invoke(['git', '-C', str(git_repo), '-c', 'user.name=Synthetic test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'test: pin synthetic SQL contracts'])
    revision = invoke(['git', '-C', str(git_repo), 'rev-parse', 'HEAD']).strip()
    profiles = {}; datasets = []
    for domain, filename, content in [
        ('commerce', 'orders.csv', 'id,team,amount\n001,east,12345678901234567.89\n002,west,8.20\n003,east,0.00\n'),
        ('service_inventory', 'services.jsonl', '{"id":"svc-1","team":"ops","observed_at":"2026-09-16T00:00:00+08:00"}\n')]:
        source = domain + '_' + suffix
        project = api('warehouse/projects', {'code': source, 'name': 'Synthetic ' + domain})['id']
        api('sources', {'code': source, 'sourceType': 'FILE', 'credentialRef': 'env://SYNTHETIC_MODEL_INPUT', 'config': {}}, status=201)
        api(f'warehouse/projects/{project}/sources', {'sourceCode': source})
        folder = inbox / domain; folder.mkdir(); (folder / filename).write_text(content); (folder / (filename + '.done')).write_text('')
        plan = api('lake/plans', {'sourceCode': source, 'expectedVersion': 0, 'kind': 'FILE_SCAN', 'runtimeRef': source,
            'timezone': 'Asia/Shanghai', 'triggerTime': '00:00:00', 'startDate': today, 'historicalRead': True,
            'maxAttempts': 3, 'timeoutSeconds': 300, 'contract': {}})['id']; plans.append(plan)
        ingest_registry = root / (domain + '-ingest.json')
        ingest_registry.write_text(json.dumps({'version': 1, 'lakeRoot': str(lake), 'profiles': {source: {'kind': 'FILE_SCAN', 'sourceCode': source, 'inboxRoot': str(folder)}}}))
        receive(source, plan, ingest_registry)
        asset = api(f'warehouse/projects/{project}/assets')[0]['id']
        sha, files = worker.bundle(git_repo, 'models/' + domain, revision)
        alias = 'orders' if domain == 'commerce' else 'services'
        profile = {'repository': str(git_repo), 'projectPath': 'models/' + domain, 'projectId': project, 'sources': {alias: source}}
        profiles[source] = profile
        contract = worker.bound_contract(files, profile)
        dataset = api(f'warehouse/projects/{project}/models', {'code': domain.replace('_', '-'), 'name': domain, 'expectedVersion': 0,
            'runtimeRef': source, 'gitRevision': revision, 'bundleSha256': sha, 'contract': contract})['id']
        build = api(f'warehouse/projects/{project}/datasets/{dataset}/builds', {'requestKey': 'first', 'modelVersion': 1, 'inputs': {alias: asset}})['id']
        datasets.append(dict(project=project, dataset=dataset, build=build, alias=alias, asset=asset, source=source, plan=plan, registry=ingest_registry, folder=folder, filename=filename))
    port = int(os.environ['LAKE_REVIEW_JDBC_URL'].split(':')[-1].split('/')[0])
    db = {'host': '127.0.0.1', 'port': port, 'dbname': 'lake_review', 'user': 'bydw_model_worker_login', 'passwordEnv': 'LAKE_REVIEW_MODEL_PASSWORD'}
    runtime = root / 'model-runtime.json'; runtime.write_text(json.dumps({'version': 1, 'lakeRoot': str(lake), 'workRoot': str(root / 'builds'), 'database': db, 'profiles': profiles}))
    command = [sys.executable, str(repo / 'apps/model-worker/worker.py'), '--registry', str(runtime), '--api', base, '--instance', 'model-' + suffix, '--once']
    for dataset in datasets:
        invoke(command)
        prefix = f"warehouse/projects/{dataset['project']}/datasets/{dataset['dataset']}"
        builds = api(prefix + '/builds'); assert builds[0]['state'] == 'READY', builds[0].get('error_code')
        assert builds[0]['result']['qualityPassed'] is True
        published = api(prefix + f"/builds/{dataset['build']}/publish", {'reason': 'Synthetic acceptance'})
        dataset['release'] = published['releaseId']
        assert api(prefix + '/query', {})['releaseId'] == dataset['release']
    commerce = datasets[0]; prefix = f"warehouse/projects/{commerce['project']}/datasets/{commerce['dataset']}"
    reader_id = 'reader-' + suffix
    token = api('warehouse/identities', {'id': reader_id})['token']
    api(f"warehouse/projects/{commerce['project']}/members", {'identity': reader_id, 'role': 'VIEWER'})
    api(prefix + '/query', {}, token, 403)
    api(prefix + '/policy', {'identity': reader_id, 'columns': ['order_id', 'amount'], 'rowEquals': {'team': 'east'}})
    result = api(prefix + '/query', {'releaseId': commerce['release']}, token)
    assert result['rows'] == [{'order_id': '001', 'amount': '12345678901234567.89'}, {'order_id': '003', 'amount': '0.00'}]
    api(prefix + '/query', {'columns': ['team']}, token, 400)
    assert api(prefix + '/query', {'equals': {'order_id': "' OR TRUE --"}}, token)['rows'] == []
    api(f"warehouse/projects/{datasets[1]['project']}/datasets/{datasets[1]['dataset']}/query", {}, token, 403)
    api('warehouse/builds/claim', {'runtimeRefs': list(profiles)}, token, 401)
    export_request = urllib.request.Request(base + '/api/v1/' + prefix + '/export', data=json.dumps({'releaseId': commerce['release']}).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(export_request) as exported:
        assert exported.headers['X-Release-Id'] == str(commerce['release'])
        assert exported.headers['X-Row-Count'] == '2'
        csv = exported.read().decode(); assert '12345678901234567.89' in csv and 'west' not in csv and 'team' not in csv
    # The execution account cannot mutate the frozen SQL relation.
    actual_db = {k: v for k, v in db.items() if k != 'passwordEnv'}; actual_db['password'] = os.environ['LAKE_REVIEW_MODEL_PASSWORD']
    with psycopg2.connect(**actual_db) as connection, connection.cursor() as cursor:
        try:
            cursor.execute(sql.SQL('UPDATE {} SET amount = 0').format(sql.Identifier('build_' + str(commerce['build']), 'orders')))
            raise AssertionError('FROZEN_TABLE_MUTABLE')
        except psycopg2.errors.InsufficientPrivilege:
            connection.rollback()
    # Competing validated candidates share an expected release; only one may publish.
    (commerce['folder'] / commerce['filename']).write_text('id,team,amount\n001,east,10.25\n002,west,9.00\n')
    receive(commerce['source'], commerce['plan'], commerce['registry'], revision=True)
    new_asset = api(f"warehouse/projects/{commerce['project']}/assets")[0]['id']
    candidates = [api(prefix + '/builds', {'requestKey': 'competing-' + str(i), 'modelVersion': 1, 'inputs': {commerce['alias']: new_asset}})['id'] for i in range(2)]
    invoke(command); invoke(command)
    new_release = api(prefix + f'/builds/{candidates[0]}/publish', {'reason': 'Synthetic revision'})['releaseId']
    assert api(prefix + f'/builds/{candidates[1]}/publish', {'reason': 'Stale contender'}, status=409)['code'] == 'ACTIVE_RELEASE_CHANGED'
    assert api(prefix + '/query', {'releaseId': commerce['release']}, token)['rows'] == result['rows']
    current_rows = api(prefix + '/query', {}, token)['rows']; assert current_rows == [{'order_id': '001', 'amount': '10.25'}]
    stale_build = api(prefix + '/builds', {'requestKey': 'old-input', 'modelVersion': 1, 'inputs': {commerce['alias']: commerce['asset']}})['id']
    invoke(command)
    assert api(prefix + f'/builds/{stale_build}/publish', {'reason': 'Older input'}, status=409)['code'] == 'STALE_INPUT_WATERMARK'
    # A changed delivery with duplicate keys fails dbt quality and preserves the old release.
    (commerce['folder'] / commerce['filename']).write_text('id,team,amount\n001,east,1\n001,east,2\n')
    receive(commerce['source'], commerce['plan'], commerce['registry'], revision=True)
    asset = api(f"warehouse/projects/{commerce['project']}/assets")[0]['id']
    bad_build = api(prefix + '/builds', {'requestKey': 'duplicates', 'modelVersion': 1, 'inputs': {commerce['alias']: asset}})['id']
    invoke(command, expected=1)
    assert api(prefix + '/builds')[0]['state'] == 'REJECTED'
    api(prefix + f'/builds/{bad_build}/publish', {'reason': 'Must reject'}, status=409)
    assert api(prefix + '/query', {}, token)['rows'] == current_rows
    # SQL that changes a declared numeric output into text must fail the server-side gate.
    sql_file = git_repo / 'models/commerce/models/orders.sql'
    sql_file.write_text("select id as order_id, team, cast(amount as text) as amount from {{ source('lake', 'orders') }}\n")
    invoke(['git', '-C', str(git_repo), 'add', 'models'])
    invoke(['git', '-C', str(git_repo), '-c', 'user.name=Synthetic test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'test: output type mismatch'])
    wrong_revision = invoke(['git', '-C', str(git_repo), 'rev-parse', 'HEAD']).strip()
    wrong_sha, wrong_files = worker.bundle(git_repo, 'models/commerce', wrong_revision)
    api(f"warehouse/projects/{commerce['project']}/models", {'code': 'commerce', 'name': 'commerce', 'expectedVersion': 1,
        'runtimeRef': commerce['source'], 'gitRevision': wrong_revision, 'bundleSha256': wrong_sha,
        'contract': worker.bound_contract(wrong_files, profiles[commerce['source']])})
    wrong_build = api(prefix + '/builds', {'requestKey': 'wrong-output-type', 'modelVersion': 2, 'inputs': {commerce['alias']: new_asset}})['id']
    invoke(command, expected=1)
    mismatch = api(prefix + '/builds')[0]
    assert mismatch['state'] == 'REJECTED' and mismatch['result']['schemaPassed'] is False
    api(prefix + f'/builds/{wrong_build}/publish', {'reason': 'Must reject output type'}, status=409)
    assert api(prefix + '/query', {}, token)['rows'] == current_rows
    evidence = {'state': 'PASS', 'themes': 2, 'checks': ['real dbt SQL', 'Git-pinned bundle', 'quality gate', 'immutable SQL tables', 'row-and-column policies', 'fixed release query and CSV export', 'exact decimal', 'leading zero', 'project isolation', 'competing publication', 'stale input rejection', 'failed build keeps release', 'declared output type gate'],
        'runtime': {'core': '1.11.15', 'postgresAdapter': '1.11.0'}, 'fixtureRoot': str(root),
        'ui': {'projectId': commerce['project'], 'datasetId': commerce['dataset']}}
    (repo / 'work/lake-review/model-product-evidence.json').write_text(json.dumps(evidence, indent=2))
    print(json.dumps({k: v for k, v in evidence.items() if k != 'fixtureRoot'}))
finally:
    for plan in plans:
        api(f'lake/plans/{plan}/state', {'state': 'PAUSED'})
    # Keep this private isolated evidence directory for failed-build diagnosis.
