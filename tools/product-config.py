"""Create a new private local Compose configuration without replacing existing data."""
import argparse
import json
import os
from pathlib import Path
import secrets

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, help='New persistent local runtime directory')
parser.add_argument('--env-file', required=True, help='New private env file under secrets/')
parser.add_argument('--api-port', type=int, default=60283)
parser.add_argument('--console-port', type=int, default=60284)
parser.add_argument('--db-port', type=int, default=57224)
args = parser.parse_args()
root, env = Path(args.root).resolve(), Path(args.env_file).resolve()
settings_file = env.with_suffix('.json')
if root.exists() or env.exists() or settings_file.exists():
    raise SystemExit('DESTINATION_EXISTS: use new paths; no files were replaced')
if len({args.api_port, args.console_port, args.db_port}) != 3 or not all(1024 <= p <= 65535 for p in [args.api_port, args.console_port, args.db_port]):
    raise SystemExit('INVALID_PORTS')
os.umask(0o077)
for directory in ['lake', 'inbox', 'config']:
    (root / directory).mkdir(parents=True)
env.parent.mkdir(parents=True, exist_ok=True)
settings = {key: secrets.token_hex(32) for key in ['WAREHOUSE_DB_PASSWORD', 'CONTROL_API_DB_PASSWORD', 'INGESTION_WORKER_DB_PASSWORD',
    'MODEL_WORKER_DB_PASSWORD', 'CONTROL_API_ADMIN_TOKEN', 'CONTROL_API_WORKER_TOKEN']}
if hasattr(os, 'getuid') and hasattr(os, 'getgid'):
    product_uid, product_gid = str(os.getuid()), str(os.getgid())
else:
    # Docker Desktop bind mounts do not expose a Windows host uid/gid. Keep the
    # product worker's image-defined, non-root identity on Windows.
    product_uid, product_gid = '10001', '10001'
settings.update({'PRODUCT_UID': product_uid, 'PRODUCT_GID': product_gid, 'PRODUCT_LAKE_ROOT': str(root / 'lake'),
    'PRODUCT_INBOX_ROOT': str(root / 'inbox'), 'PRODUCT_CONFIG_ROOT': str(root / 'config'),
    'PRODUCT_API_PORT': str(args.api_port), 'PRODUCT_CONSOLE_PORT': str(args.console_port), 'PRODUCT_DB_PORT': str(args.db_port)})
if any("'" in value or '\n' in value for value in settings.values()):
    raise SystemExit('UNSUPPORTED_PATH_CHARACTER')
env.write_text(''.join(key + "='" + value + "'\n" for key, value in settings.items()))
settings_file.write_text(json.dumps(settings, indent=2) + '\n')
(root / 'config/source.env').write_text('# Optional source authentication environment variables. Keep private.\n')
lake = {'version': 1, 'lakeRoot': '/data/lake', 'profiles': {'daily-files': {'kind': 'FILE_SCAN', 'sourceCode': 'folder-source',
    'inboxRoot': '/data/inbox', 'datePartitioned': True, 'assumeReady': False, 'parserPython': '/usr/local/bin/python'}}}
model = {'version': 1, 'lakeRoot': '/data/lake', 'workRoot': '/data/lake/model-work',
    'database': {'host': 'warehouse-db', 'port': 5432, 'dbname': 'warehouse', 'user': 'bydw_model_worker_login', 'passwordEnv': 'MODEL_DATABASE_PASSWORD'},
    'profiles': {'commerce': {'projectId': 1, 'repository': '/models.git', 'projectPath': 'models/commerce', 'sources': {'orders': 'folder-source'}}}}
for name, value in [('lake-runtime.json', lake), ('model-runtime.json', model)]:
    (root / 'config' / name).write_text(json.dumps(value, indent=2) + '\n')
print(json.dumps({'root': str(root), 'envFile': str(env), 'settingsFile': str(settings_file), 'state': 'CONFIGURED'}))
