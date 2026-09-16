"""Register the exact model contract sealed in a configured Git repository."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
from worker import bundle, bound_contract, request

parser = argparse.ArgumentParser()
parser.add_argument('--registry', required=True)
parser.add_argument('--ref', required=True)
parser.add_argument('--code', required=True)
parser.add_argument('--name', required=True)
parser.add_argument('--expected-version', type=int, default=0)
parser.add_argument('--revision', default='HEAD')
parser.add_argument('--api')
parser.add_argument('--describe', action='store_true')
args = parser.parse_args()
registry = json.loads(Path(args.registry).read_text())
profile = registry['profiles'][args.ref]
revision = subprocess.check_output(['git', '-C', profile['repository'], 'rev-parse', '--verify', args.revision + '^{commit}'], text=True, timeout=10).strip()
sha, files = bundle(profile['repository'], profile['projectPath'], revision)
body = {'code': args.code, 'name': args.name, 'expectedVersion': args.expected_version, 'runtimeRef': args.ref,
    'gitRevision': revision, 'bundleSha256': sha, 'contract': bound_contract(files, profile)}
if args.describe:
    print(json.dumps(body, indent=2, ensure_ascii=False))
else:
    if not args.api:
        parser.error('--api is required for registration')
    from urllib.parse import urlparse
    url = urlparse(args.api)
    if (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ['127.0.0.1', 'localhost'])) or url.username or url.password or url.query or url.fragment:
        parser.error('API must use HTTPS or loopback HTTP')
    token = os.environ.get('WAREHOUSE_EDITOR_TOKEN') or os.environ['CONTROL_API_ADMIN_TOKEN']
    options = SimpleNamespace(api=args.api.rstrip('/'), token=token, instance='model-register')
    print(json.dumps(request(options, 'projects/' + str(profile['projectId']) + '/models', body)))
