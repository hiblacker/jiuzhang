"""Run synthetic product checks against an explicitly isolated loopback PostgreSQL server.

The integration harness creates only lake_review; this command never reads secrets/,
connects to a business source, installs dependencies, or manages an existing service.
"""
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

repo = Path(__file__).resolve().parents[1]
required = ['LAKE_REVIEW_JDBC_URL', 'LAKE_REVIEW_DB_OWNER', 'LAKE_REVIEW_DB_OWNER_PASSWORD',
            'LAKE_REVIEW_DBT_PYTHON', 'LAKE_PYTHON']
if os.environ.get('LAKE_REVIEW_ALLOW_MIGRATIONS') != 'isolated' or any(not os.environ.get(k) for k in required):
    raise SystemExit('Explicit isolated PostgreSQL and installed Python runtimes are required; see docs/41-product-workbench-runbook.md')
if not re.fullmatch(r'jdbc:postgresql://127\.0\.0\.1:[0-9]+/lake_review', os.environ['LAKE_REVIEW_JDBC_URL']):
    raise SystemExit('ISOLATED_LOOPBACK_DATABASE_REQUIRED')
os.umask(0o077)
output = repo / 'work/product-review/verification'
output.mkdir(parents=True, exist_ok=True)
env = dict(os.environ, LAKE_REVIEW_REPO=str(repo), LAKE_REVIEW_BROWSER='true', LAKE_REVIEW_SCALE='true')
for key in ['LAKE_REVIEW_CONTROL_PASSWORD', 'LAKE_REVIEW_WORKER_PASSWORD', 'LAKE_REVIEW_MODEL_PASSWORD']:
    env.setdefault(key, secrets.token_urlsafe(32))
# Some legacy test helpers write only synthetic diagnostics in this directory.
(repo / 'work/lake-review').mkdir(parents=True, exist_ok=True)
checks = [
    ('frontend', ['npm', 'run', 'build', '--prefix', 'apps/console']),
    ('node', ['node', '--import', './tests/helpers/console-alias.mjs', '--test', *map(str, sorted((repo / 'tests').glob('*.test.mjs')))]),
    ('python', [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']),
    ('api-browser-scale', ['mvn', '-q', *(['-o'] if env.get('LAKE_REVIEW_MAVEN_OFFLINE') == 'true' else []),
                           '-s', 'deploy/maven-settings.xml', '-f', 'apps/control-api/pom.xml', 'verify']),
    ('docs', ['node', 'tools/check-docs.mjs']),
    ('whitespace', ['git', 'diff', '--check']),
]
evidence = []
for name, command in checks:
    started = time.monotonic()
    with (output / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
    evidence.append({'check': name, 'exitCode': result.returncode, 'seconds': round(time.monotonic() - started, 2)})
    (output / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(f'{name}: {"PASS" if result.returncode == 0 else "FAIL"}', flush=True)
    if result.returncode:
        print(f'Inspect private log: {output / (name + ".log")}')
        raise SystemExit(result.returncode)
