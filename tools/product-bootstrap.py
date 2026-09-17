"""Create one browser administrator invitation using a local admin credential reference."""
import argparse
import json
import os
import re
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--api', required=True)
parser.add_argument('--settings', help='Private JSON containing CONTROL_API_ADMIN_TOKEN; otherwise use the environment')
parser.add_argument('--identity', required=True)
parser.add_argument('--display-name', required=True)
parser.add_argument('--output', required=True, help='New private file for the single-use invitation')
parser.add_argument('--reset', action='store_true', help='Explicitly invalidate the existing account password and sessions')
args = parser.parse_args()
if not re.fullmatch(r'[a-z][a-z0-9_-]{2,63}', args.identity):
    raise SystemExit('INVALID_ACCOUNT_IDENTITY')
target = urlparse(args.api)
if target.scheme != 'http' or target.hostname not in ['127.0.0.1', 'localhost'] or target.username or target.password or target.query or target.fragment or target.path not in ['', '/']:
    raise SystemExit('LOCAL_BOOTSTRAP_URL_REQUIRED')
token = json.loads(Path(args.settings).read_text())['CONTROL_API_ADMIN_TOKEN'] if args.settings else os.environ['CONTROL_API_ADMIN_TOKEN']
output = Path(args.output).resolve()
output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    route = '/api/v1/warehouse/accounts/' + args.identity + '/reset' if args.reset else '/api/v1/warehouse/accounts/invite'
    body = {} if args.reset else {'identity': args.identity, 'displayName': args.display_name, 'platformAdmin': True}
    request = urllib.request.Request(args.api.rstrip('/') + route, data=json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.load(response)
    with os.fdopen(fd, 'w') as stream:
        fd = None
        json.dump(result, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
except urllib.error.HTTPError as error:
    try: code = json.load(error).get('code', 'BOOTSTRAP_FAILED')
    except (ValueError, AttributeError): code = 'BOOTSTRAP_FAILED'
    raise SystemExit(f'Bootstrap failed: HTTP {error.code}, {code}. The output path is reserved; inspect before retrying.')
finally:
    if fd is not None: os.close(fd)
print(json.dumps({'state': 'INVITATION_SAVED', 'identity': args.identity, 'output': str(output), 'expiresInSeconds': 86400}))
